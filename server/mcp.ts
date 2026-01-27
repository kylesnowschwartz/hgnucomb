#!/usr/bin/env node
/**
 * MCP Server for hgnucomb grid operations.
 *
 * Exposes tools for orchestrator agents to spawn child agents and query grid state.
 * Connects to the main WebSocket server as a client to route requests to the browser.
 *
 * Environment variables:
 * - HGNUCOMB_AGENT_ID: Required. The agent ID of the calling orchestrator.
 * - HGNUCOMB_WS_URL: Optional. WebSocket server URL (default: ws://localhost:3001)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import type {
  McpSpawnRequest,
  McpGetGridRequest,
  McpSpawnResponse,
  McpGetGridResponse,
} from "./protocol.js";

const WS_URL = process.env.HGNUCOMB_WS_URL ?? "ws://localhost:3001";
const AGENT_ID = process.env.HGNUCOMB_AGENT_ID;
const REQUEST_TIMEOUT_MS = 30000;

if (!AGENT_ID) {
  console.error("Error: HGNUCOMB_AGENT_ID environment variable is required");
  process.exit(1);
}

// ============================================================================
// WebSocket Client
// ============================================================================

let ws: WebSocket | null = null;
let requestCounter = 0;
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function nextRequestId(): string {
  return `mcp-${AGENT_ID}-${++requestCounter}-${Date.now()}`;
}

async function connectWebSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      // Register as MCP client
      ws?.send(
        JSON.stringify({
          type: "mcp.register",
          payload: { agentId: AGENT_ID },
        })
      );
      console.error(`[MCP] Connected to ${WS_URL} as agent ${AGENT_ID}`);
      resolve();
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleWsMessage(msg);
      } catch (err) {
        console.error("[MCP] Failed to parse message:", err);
      }
    });

    ws.on("close", () => {
      console.error("[MCP] WebSocket closed, exiting");
      process.exit(1);
    });

    ws.on("error", (err) => {
      console.error("[MCP] WebSocket error:", err.message);
      reject(err);
    });

    // Connection timeout
    setTimeout(() => {
      if (ws?.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket connection timeout"));
      }
    }, 10000);
  });
}

function handleWsMessage(msg: McpSpawnResponse | McpGetGridResponse): void {
  if (!msg.requestId) return;

  const pending = pendingRequests.get(msg.requestId);
  if (!pending) {
    console.error(`[MCP] No pending request for: ${msg.requestId}`);
    return;
  }

  pendingRequests.delete(msg.requestId);
  pending.resolve(msg.payload);
}

async function sendRequest<T>(
  type: string,
  payload: Record<string, unknown>
): Promise<T> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket not connected");
  }

  const requestId = nextRequestId();
  const msg = { type, requestId, payload: { ...payload, callerId: AGENT_ID } };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request timeout: ${requestId}`));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    ws?.send(JSON.stringify(msg));
  });
}

// ============================================================================
// MCP Server
// ============================================================================

const mcpServer = new McpServer({
  name: "hgnucomb",
  version: "1.0.0",
});

// Tool: spawn_agent
mcpServer.tool(
  "spawn_agent",
  "Spawn a new agent on the hex grid. If coordinates omitted, auto-places near caller.",
  {
    q: z.number().optional().describe("Hex column (optional - auto-positions if omitted)"),
    r: z.number().optional().describe("Hex row (optional - auto-positions if omitted)"),
    cellType: z
      .enum(["terminal", "orchestrator"])
      .describe("Type of cell to spawn"),
  },
  async ({ q, r, cellType }) => {
    try {
      const result = await sendRequest<McpSpawnResponse["payload"]>("mcp.spawn", {
        q,
        r,
        cellType,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to spawn agent: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Spawned ${cellType} agent ${result.agentId} at hex (${result.hex?.q}, ${result.hex?.r})`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_grid_state
mcpServer.tool(
  "get_grid_state",
  "Get current state of agents on the grid",
  {
    maxDistance: z
      .number()
      .optional()
      .default(5)
      .describe("Max hex distance from caller (default: 5)"),
  },
  async ({ maxDistance }) => {
    try {
      const result = await sendRequest<McpGetGridResponse["payload"]>("mcp.getGrid", {
        maxDistance,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to get grid state: ${result.error}` }],
          isError: true,
        };
      }

      const agents = result.agents ?? [];
      if (agents.length === 0) {
        return {
          content: [{ type: "text", text: "No agents found within range" }],
        };
      }

      const lines = agents.map(
        (a) =>
          `- ${a.agentId} (${a.cellType}): hex(${a.hex.q},${a.hex.r}) distance=${a.distance} status=${a.status}`
      );

      return {
        content: [
          {
            type: "text",
            text: `Found ${agents.length} agents:\n${lines.join("\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Connect to WebSocket server first
  await connectWebSocket();

  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[MCP] Server ready");
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
