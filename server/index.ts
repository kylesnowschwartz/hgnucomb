/**
 * WebSocket server for terminal sessions.
 *
 * Listens on PORT env var (default 3001), manages PTY sessions, and routes
 * messages between browser clients and terminal processes.
 *
 * When a built frontend exists in dist/, serves it as static files on the
 * same port. Otherwise runs as WebSocket-only (dev mode with Vite on :5173).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { TerminalSessionManager } from "./manager.js";
import type {
  ClientMessage,
  ServerMessage,
  McpRequest,
  McpResponse,
  McpNotification,
  McpSpawnRequest,
  McpGetGridRequest,
  McpBroadcastRequest,
  McpReportStatusRequest,
  McpReportResultRequest,
  McpGetMessagesRequest,
  McpGetWorkerStatusRequest,
  McpGetWorkerDiffRequest,
  McpListWorkerFilesRequest,
  McpListWorkerCommitsRequest,
  McpCheckMergeConflictsRequest,
  McpMergeWorkerToStagingRequest,
  McpMergeStagingToMainRequest,
  McpCleanupWorkerWorktreeRequest,
  McpCleanupWorkerWorktreeResponse,
  McpKillWorkerRequest,
  McpKillWorkerResponse,
  InboxUpdatedMessage,
  AgentRemovedNotification,
  StoredAgentMetadata,
  DetailedStatus,
} from "@shared/protocol.ts";
import { isClientMessage, isMcpMessage } from "@shared/protocol.ts";
import {
  generateContext,
  writeContextFile,
  cleanupContextFile,
  ORCHESTRATOR_SYSTEM_PROMPT,
  WORKER_SYSTEM_PROMPT,
} from "./context.js";
import {
  createWorktree,
  removeWorktree,
  getGitRoot,
} from "./worktree.js";
import {
  getWorkerDiff,
  listWorkerFiles,
  listWorkerCommits,
  checkMergeConflicts,
  mergeWorkerToStaging,
  mergeStagingToMain,
} from "./git.js";
import { join, resolve, extname } from "path";
import { existsSync, readFileSync } from "fs";
import { saveImageForSession } from "./imageStorage.js";
import { runPreflight } from "./preflight.js";

runPreflight();

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const manager = new TerminalSessionManager();

// ============================================================================
// Static File Serving (production mode)
// ============================================================================

const DIST_DIR = resolve(import.meta.dirname, "..", "dist");
const SERVE_STATIC = existsSync(DIST_DIR);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Handle HTTP requests: serve static files from dist/ in production,
 * or return 404 in dev mode (WebSocket upgrades still work).
 */
function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  if (!SERVE_STATIC) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found (dev mode - use Vite on :5173)");
    return;
  }

  const pathname = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;

  // Root path serves index.html
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(DIST_DIR, relativePath);

  // Path traversal guard: resolved path must stay within dist/
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  // Vite hashes asset filenames - safe to cache forever.
  // index.html references them, so it must revalidate.
  const isHashedAsset = pathname.startsWith("/assets/");
  const cacheControl = isHashedAsset
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
  });
  res.end(readFileSync(filePath));
}

const httpServer = createServer(handleHttpRequest);

// Track which sessions belong to which client for cleanup
const clientSessions = new Map<WebSocket, Set<string>>();

// Track sessionId -> agent metadata for persistence and cleanup
const sessionMetadata = new Map<string, StoredAgentMetadata>();

// Track sessionId -> currently attached browser client
// Updated on session create and on reconnect (sessions.list)
const sessionClient = new Map<string, WebSocket>();

// ============================================================================
// PTY Activity Detection (Inferred Status)
// ============================================================================

const IDLE_THRESHOLD_MS = 5000;  // 5 seconds of silence = idle
const ACTIVITY_CHECK_INTERVAL_MS = 1000;  // Check every second
const WORKING_DEBOUNCE_MS = 1500;  // Require 1.5s of sustained output to trigger 'working'

interface SessionActivityState {
  lastOutputTime: number;  // Date.now() of last PTY output
  inferredStatus: 'working' | 'idle';
  workingDebounceTimer?: ReturnType<typeof setTimeout>;  // Pending idle->working transition
}

// Track sessionId -> activity state for agents
const sessionActivity = new Map<string, SessionActivityState>();

/**
 * Clean up activity tracking for a session (clears pending timers).
 */
function cleanupActivityTracking(sessionId: string): void {
  const activity = sessionActivity.get(sessionId);
  if (activity?.workingDebounceTimer) {
    clearTimeout(activity.workingDebounceTimer);
  }
  sessionActivity.delete(sessionId);
}

/**
 * Check if we should use inferred status (PTY activity) for this agent.
 * Returns false for terminal/sticky states that should not be overridden.
 */
function shouldInferStatus(currentStatus: string): boolean {
  const stickyStates = ['done', 'error', 'cancelled', 'waiting_input', 'waiting_permission', 'stuck'];
  return !stickyStates.includes(currentStatus);
}

/**
 * Broadcast inferred status update to all browser clients.
 */
function broadcastInferredStatus(agentId: string, status: 'working' | 'idle'): void {
  const notification = {
    type: 'mcp.statusUpdate',
    payload: {
      agentId,
      state: status,
      message: 'Inferred from PTY activity',
    },
  };

  const json = JSON.stringify(notification);
  for (const browser of browserClients) {
    if (browser.readyState === WebSocket.OPEN) {
      browser.send(json);
    }
  }

  console.log(`[Activity] ${agentId} -> ${status} (inferred)`);
}

// ============================================================================
// MCP Routing
// ============================================================================

// MCP clients (identified by agentId after registration)
const mcpClients = new Map<string, WebSocket>();

// Browser clients (non-MCP WebSocket connections)
const browserClients = new Set<WebSocket>();

// Pending MCP requests waiting for browser response
interface PendingMcpRequest {
  mcpWs: WebSocket;
  agentId: string;
}
const pendingMcpRequests = new Map<string, PendingMcpRequest>();

/**
 * Route an MCP request from MCP server to browser clients.
 */
function routeMcpToBrowser(msg: McpSpawnRequest | McpGetGridRequest | McpBroadcastRequest | McpReportStatusRequest | McpReportResultRequest | McpGetMessagesRequest | McpGetWorkerStatusRequest): void {
  const json = JSON.stringify(msg);
  for (const browser of browserClients) {
    if (browser.readyState === WebSocket.OPEN) {
      browser.send(json);
    }
  }
}

/**
 * Route an MCP response from browser back to the requesting MCP server.
 */
function routeMcpResponse(msg: McpResponse): void {
  const pending = pendingMcpRequests.get(msg.requestId);
  if (!pending) {
    console.warn(`[MCP] No pending request for: ${msg.requestId}`);
    return;
  }

  if (pending.mcpWs.readyState === WebSocket.OPEN) {
    pending.mcpWs.send(JSON.stringify(msg));
  }
  pendingMcpRequests.delete(msg.requestId);
}

/**
 * Find a session ID by agent ID.
 * Returns undefined if agent not found.
 */
function findSessionByAgentId(agentId: string): string | undefined {
  for (const [sessionId, metadata] of sessionMetadata.entries()) {
    if (metadata.agentId === agentId) {
      return sessionId;
    }
  }
  return undefined;
}

/**
 * Broadcast agent removal to all connected browser clients.
 * Called after successful cleanup or kill operations.
 */
function broadcastAgentRemoval(
  agentId: string,
  reason: 'cleanup' | 'kill',
  sessionId?: string
): void {
  const notification: AgentRemovedNotification = {
    type: 'agent.removed',
    payload: { agentId, reason, sessionId },
  };

  const message = JSON.stringify(notification);
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }

  console.log(`[Server] Broadcasted agent removal: ${agentId} (${reason})`);
}

/**
 * Send inbox notification to an agent's MCP server.
 * This wakes any pending get_messages(wait=true) call.
 */
function notifyAgentInbox(agentId: string, messageCount: number, latestTimestamp: string): void {
  const mcpWs = mcpClients.get(agentId);
  if (!mcpWs || mcpWs.readyState !== WebSocket.OPEN) {
    return;
  }
  mcpWs.send(JSON.stringify({
    type: 'mcp.inbox.notification',
    payload: { agentId, messageCount, latestTimestamp },
  }));
  console.log(`[MCP] Inbox notification sent to ${agentId}`);
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleMessage(ws: WebSocket, msg: ClientMessage): void {
  switch (msg.type) {
    case "terminal.create": {
      const { cols, rows, shell, cwd, env, agentSnapshot, allAgents, initialPrompt, instructions, task, taskDetails, parentId, parentHex } = msg.payload;

      // Determine working directory
      let workingDir = cwd ?? process.cwd();
      let finalEnv = env;

      // For orchestrators and workers: create worktree and set up context
      const isClaudeAgent = agentSnapshot && (agentSnapshot.cellType === "orchestrator" || agentSnapshot.cellType === "worker");
      if (isClaudeAgent) {
        // Try to create a worktree for this agent
        // Pass wsUrl so MCP server connects back to THIS server instance
        const wsUrl = `ws://localhost:${PORT}`;
        const worktreeResult = createWorktree(workingDir, agentSnapshot.agentId, agentSnapshot.cellType, wsUrl);
        if (worktreeResult.success && worktreeResult.worktreePath) {
          workingDir = worktreeResult.worktreePath;
          console.log(`[Worktree] Agent ${agentSnapshot.agentId} (${agentSnapshot.cellType}) using: ${workingDir}`);
        }

        // Build task assignment options if this is a worker with a task
        // parentHex is optional - identity (parentId) is what matters for communication
        const taskAssignment = task && parentId
          ? { task, taskDetails, assignedBy: parentId, parentHex }
          : undefined;

        // Generate context file
        if (allAgents) {
          const context = generateContext(agentSnapshot, allAgents, 3, taskAssignment);
          const contextPath = writeContextFile(agentSnapshot.agentId, context);

          finalEnv = {
            ...env,
            HGNUCOMB_CONTEXT: contextPath,
            HGNUCOMB_WORKTREE: workingDir,
            // Pass parent ID directly so workers know where to report results
            ...(parentId ? { HGNUCOMB_PARENT_ID: parentId } : {}),
          };
        }
      }

      // Build CLI args for Claude agents (pre-approve MCP tools)
      // Pattern: mcp__<server>__<tool> - use * for all tools from server
      // For workers and orchestrators: use instructions as the prompt if provided
      let effectivePrompt = initialPrompt;

      if (agentSnapshot?.cellType === 'worker') {
        if (instructions) {
          // Orchestrator provided explicit instructions - use as worker prompt
          effectivePrompt = instructions;
        } else if (task && parentId) {
          // Smart fallback: actually attempt the task
          effectivePrompt = `You are a worker agent. Execute this task:

${task}${taskDetails ? `\n\nAdditional context:\n${taskDetails}` : ''}

When complete:
1. Call report_result with parentId="${parentId}" and your findings
2. Call report_status with state="done"

Work autonomously. Do not ask questions.`;
        }
      } else if (agentSnapshot?.cellType === 'orchestrator') {
        if (instructions) {
          // Parent orchestrator provided explicit instructions - use as orchestrator prompt
          effectivePrompt = instructions;
        }
      }

      // Determine model based on cell type: orchestrators use sonnet, workers use haiku
      const modelFlag = agentSnapshot?.cellType === "worker" ? "haiku" : "sonnet";

      // Build Claude CLI args for spawned agents
      // Permission strategy: full bypass since agents run in isolated worktrees.
      // For finer control later, consider: per-agent --allowedTools/--disallowedTools,
      // or --settings with a generated settings.json for granular tool permissions.
      const isOrchestrator = agentSnapshot?.cellType === "orchestrator";
      const isWorker = agentSnapshot?.cellType === "worker";

      // Each agent type gets a role-specific system prompt
      const systemPrompt = isOrchestrator
        ? ORCHESTRATOR_SYSTEM_PROMPT
        : isWorker
          ? WORKER_SYSTEM_PROMPT
          : undefined;

      // Compute plugin path for agent hooks (e.g., worker Stop hook enforcement)
      // Plugins are at server/plugins/<cellType>/ in the main repo (not worktree)
      const mainRepoRoot = getGitRoot(cwd ?? process.cwd());
      const pluginDir = isClaudeAgent && mainRepoRoot
        ? join(mainRepoRoot, "server", "plugins", agentSnapshot.cellType)
        : undefined;

      const args: string[] | undefined = isClaudeAgent
        ? [
            ...(effectivePrompt ? [effectivePrompt] : []),
            "--model", modelFlag,
            "--allowedTools", "mcp__hgnucomb__*",
            "--dangerously-skip-permissions",
            ...(systemPrompt ? ["--append-system-prompt", systemPrompt] : []),
            ...(pluginDir ? ["--plugin-dir", pluginDir] : []),
          ]
        : undefined;

      const { session, sessionId } = manager.create({ cols, rows, shell, args, cwd: workingDir, env: finalEnv });

      // Track session -> full agent metadata for persistence and cleanup
      if (agentSnapshot) {
        sessionMetadata.set(sessionId, {
          ...agentSnapshot,
          parentId,
          parentHex,
          task,
          taskDetails,
          initialPrompt,
          instructions,
          detailedStatus: 'pending',
        });

        // Initialize activity tracking only for Claude agents (not plain terminals)
        // Terminals produce constant PTY output from normal shell use, which would
        // flood the HUD with false "working" status transitions.
        if (isClaudeAgent) {
          sessionActivity.set(sessionId, {
            lastOutputTime: Date.now(),
            inferredStatus: 'idle',  // Start idle until first output
          });
        }
      }

      // Track session for this client
      let sessions = clientSessions.get(ws);
      if (!sessions) {
        sessions = new Set();
        clientSessions.set(ws, sessions);
      }
      sessions.add(sessionId);

      // Track which client owns this session (for reconnect support)
      sessionClient.set(sessionId, ws);

      // Wire up data and exit listeners
      // IMPORTANT: Don't capture `ws` directly - look up current client dynamically
      // This allows reconnected clients to receive output from existing sessions
      session.onData((data) => {
        // Update activity tracking for status inference
        const activity = sessionActivity.get(sessionId);
        if (activity) {
          const wasIdle = activity.inferredStatus === 'idle';
          activity.lastOutputTime = Date.now();

          // Transition: idle -> working (debounced to filter panel-switch artifacts)
          // Start a timer on first output; only broadcast if output continues
          if (wasIdle && !activity.workingDebounceTimer) {
            activity.workingDebounceTimer = setTimeout(() => {
              activity.workingDebounceTimer = undefined;
              // Only transition if we've had recent output (sustained activity)
              const elapsed = Date.now() - activity.lastOutputTime;
              if (elapsed < WORKING_DEBOUNCE_MS) {
                activity.inferredStatus = 'working';
                const metadata = sessionMetadata.get(sessionId);
                if (metadata?.detailedStatus && shouldInferStatus(metadata.detailedStatus)) {
                  broadcastInferredStatus(metadata.agentId, 'working');
                }
              }
            }, WORKING_DEBOUNCE_MS);
          }
        }

        const client = sessionClient.get(sessionId);
        if (client && client.readyState === WebSocket.OPEN) {
          send(client, {
            type: "terminal.data",
            payload: { sessionId, data },
          });
        }
      });

      session.onExit((exitCode) => {
        const client = sessionClient.get(sessionId);
        if (client && client.readyState === WebSocket.OPEN) {
          send(client, {
            type: "terminal.exit",
            payload: { sessionId, exitCode },
          });
        }
        // Clean up tracking
        sessions?.delete(sessionId);
        sessionClient.delete(sessionId);
        cleanupActivityTracking(sessionId);
        // Clean up context file and worktree if this was an agent
        const metadata = sessionMetadata.get(sessionId);
        if (metadata) {
          cleanupContextFile(metadata.agentId);
          removeWorktree(process.cwd(), metadata.agentId);
          sessionMetadata.delete(sessionId);
        }
      });

      send(ws, {
        type: "terminal.created",
        requestId: msg.requestId,
        payload: { sessionId, cols: session.cols, rows: session.rows },
      });
      console.log(`[${sessionId}] created (${session.cols}x${session.rows})`);
      break;
    }

    case "terminal.write": {
      const { sessionId, data } = msg.payload;
      const session = manager.get(sessionId);
      if (!session) {
        send(ws, {
          type: "terminal.error",
          requestId: msg.requestId,
          payload: { message: `Session not found: ${sessionId}`, sessionId },
        });
        return;
      }
      try {
        session.write(data);
      } catch (err) {
        send(ws, {
          type: "terminal.error",
          requestId: msg.requestId,
          payload: {
            message: err instanceof Error ? err.message : String(err),
            sessionId,
          },
        });
      }
      break;
    }

    case "terminal.resize": {
      const { sessionId, cols, rows } = msg.payload;
      const session = manager.get(sessionId);
      if (!session) {
        send(ws, {
          type: "terminal.error",
          requestId: msg.requestId,
          payload: { message: `Session not found: ${sessionId}`, sessionId },
        });
        return;
      }
      try {
        session.resize(cols, rows);
        console.log(`[${sessionId}] resized to ${cols}x${rows}`);
      } catch (err) {
        send(ws, {
          type: "terminal.error",
          requestId: msg.requestId,
          payload: {
            message: err instanceof Error ? err.message : String(err),
            sessionId,
          },
        });
      }
      break;
    }

    case "terminal.dispose": {
      const { sessionId } = msg.payload;
      const disposed = manager.dispose(sessionId);
      if (disposed) {
        clientSessions.get(ws)?.delete(sessionId);
        sessionClient.delete(sessionId);
        cleanupActivityTracking(sessionId);
        // Clean up context file and worktree if this was an agent
        const metadata = sessionMetadata.get(sessionId);
        if (metadata) {
          cleanupContextFile(metadata.agentId);
          removeWorktree(process.cwd(), metadata.agentId);
          sessionMetadata.delete(sessionId);
        }
        send(ws, {
          type: "terminal.disposed",
          requestId: msg.requestId,
          payload: { sessionId },
        });
        console.log(`[${sessionId}] disposed`);
      } else {
        send(ws, {
          type: "terminal.error",
          requestId: msg.requestId,
          payload: { message: `Session not found: ${sessionId}`, sessionId },
        });
      }
      break;
    }

    case "sessions.list": {
      // Return all active sessions with metadata and buffers
      const sessions: Array<{
        sessionId: string;
        agent: StoredAgentMetadata | null;
        buffer: string[];
        cols: number;
        rows: number;
        exited: boolean;
      }> = [];

      for (const sessionId of manager.getSessionIds()) {
        const session = manager.get(sessionId);
        if (!session) continue;

        // Re-attach this client to the session (critical for reconnect)
        // This allows the session's onData callback to send to the new client
        sessionClient.set(sessionId, ws);

        sessions.push({
          sessionId,
          agent: sessionMetadata.get(sessionId) ?? null,
          buffer: session.getBuffer(),
          cols: session.cols,
          rows: session.rows,
          exited: !session.isActive(),
        });
      }

      console.log(`[Sessions] Listed ${sessions.length} active session(s), re-attached to client`);

      send(ws, {
        type: "sessions.list.result",
        requestId: msg.requestId,
        payload: { sessions },
      });
      break;
    }

    case "sessions.clear": {
      // Kill all sessions and clear metadata (user-initiated reset)
      const count = manager.size();

      // Clean up context files and worktrees for all agents
      for (const [, metadata] of sessionMetadata.entries()) {
        cleanupContextFile(metadata.agentId);
        removeWorktree(process.cwd(), metadata.agentId);
      }
      sessionMetadata.clear();
      sessionClient.clear();
      // Clear all activity timers before clearing the map
      for (const sessionId of sessionActivity.keys()) {
        cleanupActivityTracking(sessionId);
      }

      // Dispose all PTY sessions
      manager.disposeAll();

      send(ws, {
        type: "sessions.clear.result",
        requestId: msg.requestId,
        payload: { cleared: count },
      });
      console.log(`[Sessions] Cleared ${count} session(s)`);
      break;
    }

    case "terminal.uploadImage": {
      const { sessionId, filename, data } = msg.payload;
      const session = manager.get(sessionId);

      if (!session) {
        send(ws, {
          type: "terminal.error",
          requestId: msg.requestId,
          payload: { message: `Session not found: ${sessionId}`, sessionId },
        });
        return;
      }

      try {
        // Save image to agent's worktree or scratchpad
        const agentId = sessionMetadata.get(sessionId)?.agentId;
        const imagePath = saveImageForSession(agentId, sessionId, filename, data);

        // Inject path into terminal stdin so agent can read it
        session.write(imagePath + '\n');

        // Return success with the path
        send(ws, {
          type: "terminal.uploadImage.result",
          requestId: msg.requestId,
          payload: {
            success: true,
            path: imagePath,
          },
        });

        console.log(`[${sessionId}] Image uploaded: ${filename} -> ${imagePath}`);
      } catch (err) {
        send(ws, {
          type: "terminal.uploadImage.result",
          requestId: msg.requestId,
          payload: {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        console.error(`[${sessionId}] Image upload failed:`, err);
      }
      break;
    }

    default: {
      const exhaustive: never = msg;
      send(ws, {
        type: "terminal.error",
        payload: { message: `Unknown message type: ${(exhaustive as ClientMessage).type}` },
      });
    }
  }
}

const wss = new WebSocketServer({ server: httpServer });

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill the existing process:`);
    console.error(`  lsof -ti:${PORT} | xargs kill`);
    console.error(`  # or: just kill`);
    process.exit(1);
  }
  console.error("Server error:", err.message);
  process.exit(1);
});

httpServer.listen(PORT);

wss.on("connection", (ws) => {
  console.log("Client connected");

  // Assume browser client until mcp.register received
  browserClients.add(ws);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Handle MCP messages
      if (isMcpMessage(msg)) {
        handleMcpMessage(ws, msg);
        return;
      }

      // Handle terminal messages
      if (!isClientMessage(msg)) {
        send(ws, {
          type: "terminal.error",
          payload: { message: "Invalid message format" },
        });
        return;
      }
      handleMessage(ws, msg);
    } catch (err) {
      send(ws, {
        type: "terminal.error",
        payload: {
          message: `Failed to parse message: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  });

  ws.on("close", () => {
    // Clean up browser client
    browserClients.delete(ws);

    // Clean up MCP client
    for (const [agentId, mcpWs] of mcpClients.entries()) {
      if (mcpWs === ws) {
        mcpClients.delete(agentId);
        console.log(`[MCP] Agent ${agentId} disconnected`);
        break;
      }
    }

    // Clean up pending MCP requests from this client
    for (const [requestId, pending] of pendingMcpRequests.entries()) {
      if (pending.mcpWs === ws) {
        pendingMcpRequests.delete(requestId);
      }
    }

    // Detach client from sessions (tmux-like: sessions survive disconnect)
    // PTYs keep running; client can reconnect and re-attach
    const sessions = clientSessions.get(ws);
    if (sessions && sessions.size > 0) {
      console.log(`[Session] Detached ${sessions.size} session(s) - PTYs survive disconnect`);
    }
    clientSessions.delete(ws);
    console.log("Client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });
});

/**
 * Handle MCP protocol messages.
 */
function handleMcpMessage(ws: WebSocket, msg: McpRequest | McpResponse | McpNotification | InboxUpdatedMessage | AgentRemovedNotification): void {
  switch (msg.type) {
    case "mcp.register": {
      // This client is an MCP server, not a browser
      browserClients.delete(ws);
      mcpClients.set(msg.payload.agentId, ws);
      console.log(`[MCP] Agent ${msg.payload.agentId} registered`);
      break;
    }

    case "inbox.updated": {
      // Browser notifying that an agent's inbox has new messages
      const { agentId, messageCount, latestTimestamp } = msg.payload;
      notifyAgentInbox(agentId, messageCount, latestTimestamp);
      break;
    }

    case "mcp.getWorkerDiff": {
      // Server-side handling: get diff between main and worker branch
      const req = msg as McpGetWorkerDiffRequest;
      const workerId = req.payload.workerId;
      const gitRoot = getGitRoot(process.cwd());

      if (!gitRoot) {
        ws.send(JSON.stringify({
          type: "mcp.getWorkerDiff.result",
          requestId: req.requestId,
          payload: {
            success: false,
            error: "Not in a git repository",
          },
        }));
        break;
      }

      // Get diff from worker's branch
      const diffResult = getWorkerDiff(gitRoot, workerId);
      if (!diffResult) {
        ws.send(JSON.stringify({
          type: "mcp.getWorkerDiff.result",
          requestId: req.requestId,
          payload: {
            success: false,
            error: `Failed to get diff for worker ${workerId}`,
          },
        }));
        break;
      }

      ws.send(JSON.stringify({
        type: "mcp.getWorkerDiff.result",
        requestId: req.requestId,
        payload: {
          success: true,
          diff: diffResult.diff,
          stats: diffResult.stats,
        },
      }));
      console.log(`[MCP] Diff retrieved for worker ${workerId}: ${diffResult.stats.files} files`);
      break;
    }

    case "mcp.listWorkerFiles": {
      // Server-side handling: list files changed by worker
      const req = msg as McpListWorkerFilesRequest;
      const workerId = req.payload.workerId;
      const gitRoot = getGitRoot(process.cwd());

      if (!gitRoot) {
        ws.send(JSON.stringify({
          type: "mcp.listWorkerFiles.result",
          requestId: req.requestId,
          payload: { success: false, error: "Not in a git repository" },
        }));
        break;
      }

      const output = listWorkerFiles(gitRoot, workerId);
      if (output === null) {
        ws.send(JSON.stringify({
          type: "mcp.listWorkerFiles.result",
          requestId: req.requestId,
          payload: { success: false, error: `Failed to list files for worker ${workerId}` },
        }));
        break;
      }

      ws.send(JSON.stringify({
        type: "mcp.listWorkerFiles.result",
        requestId: req.requestId,
        payload: { success: true, output },
      }));
      console.log(`[MCP] Files listed for worker ${workerId}`);
      break;
    }

    case "mcp.listWorkerCommits": {
      // Server-side handling: list commits made by worker
      const req = msg as McpListWorkerCommitsRequest;
      const workerId = req.payload.workerId;
      const gitRoot = getGitRoot(process.cwd());

      if (!gitRoot) {
        ws.send(JSON.stringify({
          type: "mcp.listWorkerCommits.result",
          requestId: req.requestId,
          payload: { success: false, error: "Not in a git repository" },
        }));
        break;
      }

      const output = listWorkerCommits(gitRoot, workerId);
      if (output === null) {
        ws.send(JSON.stringify({
          type: "mcp.listWorkerCommits.result",
          requestId: req.requestId,
          payload: { success: false, error: `Failed to list commits for worker ${workerId}` },
        }));
        break;
      }

      ws.send(JSON.stringify({
        type: "mcp.listWorkerCommits.result",
        requestId: req.requestId,
        payload: { success: true, output },
      }));
      console.log(`[MCP] Commits listed for worker ${workerId}`);
      break;
    }

    case "mcp.checkMergeConflicts": {
      // Server-side handling: check if merge would have conflicts
      const req = msg as McpCheckMergeConflictsRequest;
      const { callerId: orchestratorId, workerId } = req.payload;
      const gitRoot = getGitRoot(process.cwd());

      if (!gitRoot) {
        ws.send(JSON.stringify({
          type: "mcp.checkMergeConflicts.result",
          requestId: req.requestId,
          payload: { success: false, error: "Not in a git repository" },
        }));
        break;
      }

      const result = checkMergeConflicts(gitRoot, orchestratorId, workerId);
      if (result === null) {
        ws.send(JSON.stringify({
          type: "mcp.checkMergeConflicts.result",
          requestId: req.requestId,
          payload: { success: false, error: `Failed to check merge conflicts for worker ${workerId}` },
        }));
        break;
      }

      ws.send(JSON.stringify({
        type: "mcp.checkMergeConflicts.result",
        requestId: req.requestId,
        payload: { success: true, canMerge: result.canMerge, output: result.output },
      }));
      console.log(`[MCP] Merge conflict check for worker ${workerId}: canMerge=${result.canMerge}`);
      break;
    }

    case "mcp.mergeWorkerToStaging": {
      // Server-side handling: merge worker into orchestrator's staging worktree
      const req = msg as McpMergeWorkerToStagingRequest;
      const { callerId: orchestratorId, workerId } = req.payload;
      const gitRoot = getGitRoot(process.cwd());

      if (!gitRoot) {
        ws.send(JSON.stringify({
          type: "mcp.mergeWorkerToStaging.result",
          requestId: req.requestId,
          payload: { success: false, error: "Not in a git repository" },
        }));
        break;
      }

      const output = mergeWorkerToStaging(gitRoot, orchestratorId, workerId);
      if (output === null) {
        ws.send(JSON.stringify({
          type: "mcp.mergeWorkerToStaging.result",
          requestId: req.requestId,
          payload: { success: false, error: `Failed to merge worker ${workerId} into staging` },
        }));
        break;
      }

      // Check if output indicates failure
      const success = !output.startsWith("Merge failed:");
      ws.send(JSON.stringify({
        type: "mcp.mergeWorkerToStaging.result",
        requestId: req.requestId,
        payload: { success, output },
      }));
      console.log(`[MCP] Merge worker ${workerId} to staging: ${success ? "success" : "failed"}`);
      break;
    }

    case "mcp.mergeStagingToMain": {
      // Server-side handling: merge orchestrator's staging branch into main
      const req = msg as McpMergeStagingToMainRequest;
      const { callerId: orchestratorId } = req.payload;
      const gitRoot = getGitRoot(process.cwd());

      if (!gitRoot) {
        ws.send(JSON.stringify({
          type: "mcp.mergeStagingToMain.result",
          requestId: req.requestId,
          payload: { success: false, error: "Not in a git repository" },
        }));
        break;
      }

      const output = mergeStagingToMain(gitRoot, orchestratorId);
      if (output === null) {
        ws.send(JSON.stringify({
          type: "mcp.mergeStagingToMain.result",
          requestId: req.requestId,
          payload: { success: false, error: "Failed to merge staging to main" },
        }));
        break;
      }

      // Check if output indicates failure
      const success = output.startsWith("Merge successful:");
      ws.send(JSON.stringify({
        type: "mcp.mergeStagingToMain.result",
        requestId: req.requestId,
        payload: { success, output },
      }));
      console.log(`[MCP] Merge staging to main: ${success ? "success" : "failed"}`);
      break;
    }

    case "mcp.spawn":
    case "mcp.getGrid":
    case "mcp.broadcast":
    case "mcp.reportStatus":
    case "mcp.reportResult":
    case "mcp.getMessages":
    case "mcp.getWorkerStatus": {
      // MCP server requesting action from browser
      const agentId = msg.payload.callerId;
      pendingMcpRequests.set(msg.requestId, { mcpWs: ws, agentId });
      routeMcpToBrowser(msg);
      console.log(`[MCP] Routing ${msg.type} from ${agentId} to browser`);

      // Keep server-side metadata in sync with reported status so that
      // shouldInferStatus() respects sticky states (done, error, etc.)
      if (msg.type === "mcp.reportStatus") {
        for (const [, metadata] of sessionMetadata.entries()) {
          if (metadata.agentId === agentId) {
            metadata.detailedStatus = msg.payload.state as DetailedStatus;
            break;
          }
        }
      }
      break;
    }

    case "mcp.cleanupWorkerWorktree": {
      // Handle server-side: cleanup worker worktree
      const { callerId, workerId } = (msg as McpCleanupWorkerWorktreeRequest).payload;

      // Validate caller exists and is orchestrator
      const caller = Array.from(sessionMetadata.values()).find(m => m.agentId === callerId);
      if (!caller || caller.cellType !== 'orchestrator') {
        const response: McpCleanupWorkerWorktreeResponse = {
          type: 'mcp.cleanupWorkerWorktree.result',
          requestId: msg.requestId,
          payload: {
            success: false,
            error: 'Only orchestrators can cleanup worker worktrees',
          },
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
        break;
      }

      // Validate worker exists and is owned by caller
      const worker = Array.from(sessionMetadata.values()).find(m => m.agentId === workerId);
      if (!worker) {
        const response: McpCleanupWorkerWorktreeResponse = {
          type: 'mcp.cleanupWorkerWorktree.result',
          requestId: msg.requestId,
          payload: {
            success: false,
            error: `Worker not found: ${workerId}`,
          },
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
        break;
      }

      if (worker.parentId !== callerId) {
        const response: McpCleanupWorkerWorktreeResponse = {
          type: 'mcp.cleanupWorkerWorktree.result',
          requestId: msg.requestId,
          payload: {
            success: false,
            error: `Worker ${workerId} is not your child`,
          },
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
        break;
      }

      // Clean up the worktree
      const result = removeWorktree(process.cwd(), workerId);

      // Broadcast removal to all browser clients (even if cleanup had issues - agent is gone)
      if (result.success) {
        broadcastAgentRemoval(workerId, 'cleanup');
      }

      const response: McpCleanupWorkerWorktreeResponse = {
        type: 'mcp.cleanupWorkerWorktree.result',
        requestId: msg.requestId,
        payload: {
          success: result.success,
          message: result.success ? `Cleaned up worktree for ${workerId}` : undefined,
          error: result.error,
        },
      };
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
      }
      console.log(`[MCP] Cleaned up worktree for worker ${workerId}`);
      break;
    }

    case "mcp.killWorker": {
      // Handle server-side: kill worker PTY session
      const { callerId, workerId } = (msg as McpKillWorkerRequest).payload;

      // Validate caller exists and is orchestrator
      const caller = Array.from(sessionMetadata.values()).find(m => m.agentId === callerId);
      if (!caller || caller.cellType !== 'orchestrator') {
        const response: McpKillWorkerResponse = {
          type: 'mcp.killWorker.result',
          requestId: msg.requestId,
          payload: {
            success: false,
            error: 'Only orchestrators can terminate workers',
          },
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
        break;
      }

      // Validate worker exists and is owned by caller
      const worker = Array.from(sessionMetadata.values()).find(m => m.agentId === workerId);
      if (!worker) {
        const response: McpKillWorkerResponse = {
          type: 'mcp.killWorker.result',
          requestId: msg.requestId,
          payload: {
            success: false,
            error: `Worker not found: ${workerId}`,
          },
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
        break;
      }

      if (worker.parentId !== callerId) {
        const response: McpKillWorkerResponse = {
          type: 'mcp.killWorker.result',
          requestId: msg.requestId,
          payload: {
            success: false,
            error: `Worker ${workerId} is not your child`,
          },
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
        break;
      }

      // Find and dispose the session
      const sessionId = findSessionByAgentId(workerId);
      let terminated = false;
      if (sessionId) {
        terminated = manager.dispose(sessionId);
        if (terminated) {
          // Clean up tracking
          clientSessions.forEach(sessions => sessions.delete(sessionId));
          sessionClient.delete(sessionId);
          // Clean up context file and worktree
          cleanupContextFile(workerId);
          removeWorktree(process.cwd(), workerId);
          sessionMetadata.delete(sessionId);

          // Broadcast removal to all browser clients
          broadcastAgentRemoval(workerId, 'kill', sessionId);

          console.log(`[MCP] Terminated worker ${workerId} (session: ${sessionId})`);
        }
      }

      const response: McpKillWorkerResponse = {
        type: 'mcp.killWorker.result',
        requestId: msg.requestId,
        payload: {
          success: terminated,
          terminated,
          message: terminated ? `Terminated worker ${workerId}` : `Worker ${workerId} session not found`,
          error: terminated ? undefined : `Failed to terminate worker ${workerId}`,
        },
      };
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
      }
      break;
    }

    case "mcp.spawn.result":
    case "mcp.getGrid.result":
    case "mcp.broadcast.result":
    case "mcp.reportStatus.result":
    case "mcp.reportResult.result":
    case "mcp.getMessages.result":
    case "mcp.getWorkerStatus.result": {
      // Browser responding to MCP request
      routeMcpResponse(msg);
      console.log(`[MCP] Routing ${msg.type} back to MCP server`);
      break;
    }
  }
}

if (SERVE_STATIC) {
  console.log(`[Server] Serving frontend from dist/ on http://localhost:${PORT}`);
} else {
  console.log(`[Server] No dist/ found, skipping static file serving (dev mode)`);
}
console.log(`[Server] WebSocket listening on ws://localhost:${PORT}`);

// ============================================================================
// Activity Check Interval (idle detection)
// ============================================================================

const activityCheckInterval = setInterval(() => {
  const now = Date.now();

  for (const [sessionId, activity] of sessionActivity.entries()) {
    // Only check sessions that are currently "working"
    if (activity.inferredStatus === 'working') {
      const elapsed = now - activity.lastOutputTime;

      if (elapsed > IDLE_THRESHOLD_MS) {
        activity.inferredStatus = 'idle';
        const metadata = sessionMetadata.get(sessionId);
        if (metadata?.detailedStatus && shouldInferStatus(metadata.detailedStatus)) {
          broadcastInferredStatus(metadata.agentId, 'idle');
        }
      }
    }
  }
}, ACTIVITY_CHECK_INTERVAL_MS);

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down...`);
  clearInterval(activityCheckInterval);
  manager.disposeAll();

  // Forcibly close all WebSocket connections so the server can close immediately
  // This is necessary for hot-reload to work - tsx --watch won't wait
  for (const client of wss.clients) {
    client.terminate();
  }

  wss.close();
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.log("Forcing exit");
    process.exit(1);
  }, 1000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
