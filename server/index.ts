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
} from "./protocol.js";

const PORT = 3001;
const manager = new TerminalSessionManager();

// Track which sessions belong to which client for cleanup
const clientSessions = new Map<WebSocket, Set<string>>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleMessage(ws: WebSocket, msg: ClientMessage): void {
  switch (msg.type) {
    case "terminal.create": {
      const { cols, rows, shell, cwd, env } = msg.payload;
      const { session, sessionId } = manager.create({ cols, rows, shell, cwd, env });

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

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
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
