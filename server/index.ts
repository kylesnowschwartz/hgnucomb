/**
 * WebSocket server for terminal sessions.
 *
 * Listens on PORT env var (default 3001), manages PTY sessions, and routes
 * messages between browser clients and terminal processes.
 */

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
  McpMergeWorkerChangesRequest,
  McpCleanupWorkerWorktreeRequest,
  McpCleanupWorkerWorktreeResponse,
  McpKillWorkerRequest,
  McpKillWorkerResponse,
  InboxUpdatedMessage,
  StoredAgentMetadata,
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
import { execSync } from "child_process";

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const manager = new TerminalSessionManager();

// ============================================================================
// Git Helper Functions
// ============================================================================

/**
 * Execute git command safely, returning null on error.
 */
function gitExec(args: string[], cwd: string): string | null {
  try {
    const result = execSync(`git ${args.join(" ")}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch (err) {
    console.warn(`[Git] Command failed: git ${args.join(" ")} - ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Get diff between main and a worker branch.
 * Returns { diff, stats } or null on error.
 */
function getWorkerDiff(gitRoot: string, workerId: string): { diff: string; stats: { files: number; insertions: number; deletions: number } } | null {
  const branchName = `hgnucomb/${workerId}`;

  // Get the diff
  const diff = gitExec(["diff", "main...HEAD", "--"], gitRoot);
  if (diff === null) {
    console.warn(`[Git] Failed to get diff for ${branchName}`);
    return null;
  }

  // Get stats: number of files changed, insertions, deletions
  const statsOutput = gitExec(["diff", "main...HEAD", "--stat"], gitRoot);
  if (statsOutput === null) {
    console.warn(`[Git] Failed to get diff stats for ${branchName}`);
    return { diff, stats: { files: 0, insertions: 0, deletions: 0 } };
  }

  // Parse stats from output like: "file1.ts | 5 ++", "file2.ts | 3 --"
  // Last line is usually a summary like: "2 files changed, 8 insertions(+), 0 deletions(-)"
  const lines = statsOutput.split("\n");
  const summary = lines[lines.length - 2] || "";
  const statsRegex = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;
  const match = summary.match(statsRegex);

  const files = match ? parseInt(match[1]) || 0 : 0;
  const insertions = match ? parseInt(match[2]) || 0 : 0;
  const deletions = match ? parseInt(match[3]) || 0 : 0;

  return {
    diff,
    stats: { files, insertions, deletions },
  };
}

/**
 * Merge worker branch into main using squash merge.
 * Returns commit hash or null on error.
 */
function mergeWorkerChanges(gitRoot: string, workerId: string): { commitHash: string; filesChanged: number } | null {
  const branchName = `hgnucomb/${workerId}`;

  // Ensure we're on main branch
  const currentBranch = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], gitRoot);
  if (currentBranch !== "main") {
    console.warn(`[Git] Not on main branch, switching...`);
    const switchResult = gitExec(["checkout", "main"], gitRoot);
    if (switchResult === null) {
      console.warn(`[Git] Failed to switch to main branch`);
      return null;
    }
  }

  // Perform squash merge
  const mergeResult = gitExec(["merge", "--squash", branchName], gitRoot);
  if (mergeResult === null) {
    console.warn(`[Git] Squash merge failed for ${branchName}`);
    return null;
  }

  // Get file count for commit message
  const statusOutput = gitExec(["status", "--short"], gitRoot);
  const filesChanged = statusOutput ? statusOutput.split("\n").filter((line) => line.trim()).length : 0;

  // Auto-commit the squashed merge with descriptive message
  const commitMessage = `Merge worker changes from ${workerId}\n\n${filesChanged} files changed`;
  const commitResult = gitExec(["commit", "-m", commitMessage], gitRoot);
  if (commitResult === null) {
    // Might fail if no changes - that's OK
    console.log(`[Git] Commit after squash merge: no new changes`);
    // Get current HEAD as commit hash anyway
    const headHash = gitExec(["rev-parse", "HEAD"], gitRoot);
    return headHash ? { commitHash: headHash, filesChanged } : null;
  }

  // Get the new commit hash
  const commitHash = gitExec(["rev-parse", "HEAD"], gitRoot);
  if (!commitHash) {
    console.warn(`[Git] Failed to get commit hash after merge`);
    return null;
  }

  console.log(`[Git] Squash merged ${branchName} into main: ${commitHash.slice(0, 7)} (${filesChanged} files)`);
  return { commitHash, filesChanged };
}

// Track which sessions belong to which client for cleanup
const clientSessions = new Map<WebSocket, Set<string>>();

// Track sessionId -> agent metadata for persistence and cleanup
const sessionMetadata = new Map<string, StoredAgentMetadata>();

// Track sessionId -> currently attached browser client
// Updated on session create and on reconnect (sessions.list)
const sessionClient = new Map<string, WebSocket>();

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

      const args: string[] | undefined = isClaudeAgent
        ? [
            ...(effectivePrompt ? [effectivePrompt] : []),
            "--model", modelFlag,
            "--allowedTools", "mcp__hgnucomb__*",
            "--dangerously-skip-permissions",
            ...(systemPrompt ? ["--append-system-prompt", systemPrompt] : []),
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

    default: {
      const exhaustive: never = msg;
      send(ws, {
        type: "terminal.error",
        payload: { message: `Unknown message type: ${(exhaustive as ClientMessage).type}` },
      });
    }
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill the existing process:`);
    console.error(`  lsof -ti:${PORT} | xargs kill`);
    console.error(`  # or: just kill`);
    process.exit(1);
  }
  console.error("Server error:", err.message);
  process.exit(1);
});

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
function handleMcpMessage(ws: WebSocket, msg: McpRequest | McpResponse | McpNotification | InboxUpdatedMessage): void {
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

    case "mcp.mergeWorkerChanges": {
      // Server-side handling: merge worker branch into main
      const req = msg as McpMergeWorkerChangesRequest;
      const workerId = req.payload.workerId;
      const gitRoot = getGitRoot(process.cwd());

      if (!gitRoot) {
        ws.send(JSON.stringify({
          type: "mcp.mergeWorkerChanges.result",
          requestId: req.requestId,
          payload: {
            success: false,
            error: "Not in a git repository",
          },
        }));
        break;
      }

      // Perform squash merge
      const mergeResult = mergeWorkerChanges(gitRoot, workerId);
      if (!mergeResult) {
        ws.send(JSON.stringify({
          type: "mcp.mergeWorkerChanges.result",
          requestId: req.requestId,
          payload: {
            success: false,
            error: `Failed to merge worker ${workerId}`,
          },
        }));
        break;
      }

      ws.send(JSON.stringify({
        type: "mcp.mergeWorkerChanges.result",
        requestId: req.requestId,
        payload: {
          success: true,
          commitHash: mergeResult.commitHash,
          filesChanged: mergeResult.filesChanged,
        },
      }));
      console.log(`[MCP] Merged worker ${workerId}: commit ${mergeResult.commitHash.slice(0, 7)}`);
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

console.log(`Terminal WebSocket server listening on ws://localhost:${PORT}`);

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down...`);
  manager.disposeAll();

  // Forcibly close all WebSocket connections so the server can close immediately
  // This is necessary for hot-reload to work - tsx --watch won't wait
  for (const client of wss.clients) {
    client.terminate();
  }

  wss.close(() => {
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
