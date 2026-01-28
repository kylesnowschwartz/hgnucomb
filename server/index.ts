/**
 * WebSocket server for terminal sessions.
 *
 * Listens on port 3001, manages PTY sessions, and routes messages
 * between browser clients and terminal processes.
 */

import { WebSocketServer, WebSocket } from "ws";
import { TerminalSessionManager } from "./manager.js";
import {
  ClientMessage,
  ServerMessage,
  isClientMessage,
  isMcpMessage,
  McpRequest,
  McpResponse,
  McpNotification,
  McpSpawnRequest,
  McpGetGridRequest,
  McpBroadcastRequest,
  McpReportStatusRequest,
  McpReportResultRequest,
  McpGetMessagesRequest,
} from "./protocol.js";
import {
  generateContext,
  writeContextFile,
  cleanupContextFile,
} from "./context.js";
import {
  createWorktree,
  removeWorktree,
} from "./worktree.js";

const PORT = 3001;
const manager = new TerminalSessionManager();

// Track which sessions belong to which client for cleanup
const clientSessions = new Map<WebSocket, Set<string>>();

// Track sessionId -> agentId for context cleanup
const sessionToAgent = new Map<string, string>();

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
function routeMcpToBrowser(msg: McpSpawnRequest | McpGetGridRequest | McpBroadcastRequest | McpReportStatusRequest | McpReportResultRequest | McpGetMessagesRequest): void {
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
        const worktreeResult = createWorktree(workingDir, agentSnapshot.agentId, agentSnapshot.cellType);
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
          };
        }
      }

      // Build CLI args for Claude agents (pre-approve MCP tools)
      // Pattern: mcp__<server>__<tool> - use * for all tools from server
      // For workers: use instructions as the prompt if provided, otherwise build default
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
      }

      // Determine model based on cell type: orchestrators use sonnet, workers use haiku
      const modelFlag = agentSnapshot?.cellType === "worker" ? "haiku" : "sonnet";

      const args: string[] | undefined = isClaudeAgent
        ? [
            ...(effectivePrompt ? [effectivePrompt] : []),
            "--model", modelFlag,
            "--allowedTools", "mcp__hgnucomb__*",
          ]
        : undefined;

      const { session, sessionId } = manager.create({ cols, rows, shell, args, cwd: workingDir, env: finalEnv });

      // Track session -> agent for context cleanup
      if (agentSnapshot) {
        sessionToAgent.set(sessionId, agentSnapshot.agentId);
      }

      // Track session for this client
      let sessions = clientSessions.get(ws);
      if (!sessions) {
        sessions = new Set();
        clientSessions.set(ws, sessions);
      }
      sessions.add(sessionId);

      // Wire up data and exit listeners
      session.onData((data) => {
        send(ws, {
          type: "terminal.data",
          payload: { sessionId, data },
        });
      });

      session.onExit((exitCode) => {
        send(ws, {
          type: "terminal.exit",
          payload: { sessionId, exitCode },
        });
        // Clean up tracking
        sessions?.delete(sessionId);
        // Clean up context file and worktree if this was an orchestrator
        const agentId = sessionToAgent.get(sessionId);
        if (agentId) {
          cleanupContextFile(agentId);
          removeWorktree(process.cwd(), agentId);
          sessionToAgent.delete(sessionId);
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
        // Clean up context file and worktree if this was an orchestrator
        const agentId = sessionToAgent.get(sessionId);
        if (agentId) {
          cleanupContextFile(agentId);
          removeWorktree(process.cwd(), agentId);
          sessionToAgent.delete(sessionId);
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

    // Clean up all sessions owned by this client
    const sessions = clientSessions.get(ws);
    if (sessions) {
      for (const sessionId of sessions) {
        manager.dispose(sessionId);
        console.log(`[${sessionId}] disposed (client disconnected)`);
      }
      clientSessions.delete(ws);
    }
    console.log("Client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });
});

/**
 * Handle MCP protocol messages.
 */
function handleMcpMessage(ws: WebSocket, msg: McpRequest | McpResponse | McpNotification): void {
  switch (msg.type) {
    case "mcp.register": {
      // This client is an MCP server, not a browser
      browserClients.delete(ws);
      mcpClients.set(msg.payload.agentId, ws);
      console.log(`[MCP] Agent ${msg.payload.agentId} registered`);
      break;
    }

    case "mcp.spawn":
    case "mcp.getGrid":
    case "mcp.broadcast":
    case "mcp.reportStatus":
    case "mcp.reportResult":
    case "mcp.getMessages": {
      // MCP server requesting action from browser
      const agentId = msg.payload.callerId;
      pendingMcpRequests.set(msg.requestId, { mcpWs: ws, agentId });
      routeMcpToBrowser(msg);
      console.log(`[MCP] Routing ${msg.type} from ${agentId} to browser`);
      break;
    }

    case "mcp.spawn.result":
    case "mcp.getGrid.result":
    case "mcp.broadcast.result":
    case "mcp.reportStatus.result":
    case "mcp.reportResult.result":
    case "mcp.getMessages.result": {
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
  wss.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.log("Forcing exit");
    process.exit(1);
  }, 3000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
