#!/usr/bin/env node
/**
 * MCP Server for hgnucomb grid operations.
 *
 * Exposes tools for orchestrator agents to spawn child agents and query grid state.
 * Connects to the main WebSocket server as a client to route requests to the browser.
 *
 * Environment variables:
 * - HGNUCOMB_AGENT_ID: Required. The agent ID of the calling agent.
 * - HGNUCOMB_CELL_TYPE: Required. The cell type (orchestrator, worker, terminal).
 * - HGNUCOMB_WS_URL: Optional. WebSocket server URL (default: ws://localhost:3001)
 *
 * Tool permissions by cell type:
 * - orchestrator: spawn_agent, get_grid_state, broadcast, report_status
 * - worker: get_grid_state, broadcast, report_status (NO spawn_agent)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import type {
  McpSpawnResponse,
  McpGetGridResponse,
  McpBroadcastResponse,
  McpReportStatusResponse,
  McpReportResultResponse,
  McpGetMessagesResponse,
  DetailedStatus,
  AgentMessage,
} from "./protocol.js";

const WS_URL = process.env.HGNUCOMB_WS_URL ?? "ws://localhost:3001";
const AGENT_ID = process.env.HGNUCOMB_AGENT_ID;
const CELL_TYPE = process.env.HGNUCOMB_CELL_TYPE ?? "orchestrator"; // Default for backwards compat
const PARENT_ID = process.env.HGNUCOMB_PARENT_ID; // Set for workers spawned by orchestrators
const HEX_COORD = process.env.HGNUCOMB_HEX; // Format: "q,r"
const REQUEST_TIMEOUT_MS = 30000;

if (!AGENT_ID) {
  console.error("Error: HGNUCOMB_AGENT_ID environment variable is required");
  process.exit(1);
}

/**
 * Check if the current agent can spawn new agents.
 * Only orchestrators have spawn permissions.
 */
function canSpawn(): boolean {
  return CELL_TYPE === "orchestrator";
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
  "Spawn a new worker agent on the hex grid. If coordinates omitted, auto-places near caller. Only orchestrators can spawn agents. Pass task (description) and instructions (prompt) for the worker.",
  {
    q: z.number().optional().describe("Hex column (optional - auto-positions if omitted)"),
    r: z.number().optional().describe("Hex row (optional - auto-positions if omitted)"),
    cellType: z
      .enum(["terminal", "orchestrator", "worker"])
      .default("worker")
      .describe("Type of cell to spawn (default: worker). Workers are Claude agents with limited MCP tools."),
    task: z.string().optional().describe("Short task name/description displayed in UI"),
    instructions: z.string().optional().describe(
      "Instructions for the worker to execute (the worker's prompt). " +
      "If omitted, worker will acknowledge task and report done. " +
      "Include 'report_result' and 'report_status done' in instructions for results."
    ),
    taskDetails: z.string().optional().describe("Additional context or details for the task"),
  },
  async ({ q, r, cellType, task, instructions, taskDetails }) => {
    // Permission check: only orchestrators can spawn
    if (!canSpawn()) {
      return {
        content: [
          {
            type: "text",
            text: `Permission denied: Only orchestrators can spawn agents. You are a ${CELL_TYPE}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpSpawnResponse["payload"]>("mcp.spawn", {
        q,
        r,
        cellType,
        task,
        instructions,
        taskDetails,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to spawn agent: ${result.error}` }],
          isError: true,
        };
      }

      const taskInfo = task ? ` with task: "${task}"` : "";
      return {
        content: [
          {
            type: "text",
            text: `Spawned ${cellType} agent ${result.agentId} at hex (${result.hex?.q}, ${result.hex?.r})${taskInfo}`,
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

// Tool: broadcast
mcpServer.tool(
  "broadcast",
  "Send a message to all agents within a specified hex radius. Recipients must be within the radius to receive.",
  {
    radius: z
      .number()
      .min(1)
      .max(10)
      .describe("Hex radius for broadcast (1-10)"),
    type: z
      .string()
      .describe("Message type identifier (e.g., 'status_update', 'request_help')"),
    payload: z
      .unknown()
      .optional()
      .describe("Message payload (any JSON-serializable data)"),
  },
  async ({ radius, type, payload }) => {
    try {
      const result = await sendRequest<McpBroadcastResponse["payload"]>("mcp.broadcast", {
        radius,
        broadcastType: type,
        broadcastPayload: payload ?? null,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Broadcast failed: ${result.error}` }],
          isError: true,
        };
      }

      if (result.delivered === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Broadcast sent but no agents within radius ${radius}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Broadcast delivered to ${result.delivered} agents: ${result.recipients.join(", ")}`,
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

// Tool: report_status
mcpServer.tool(
  "report_status",
  "Report your current status to the hgnucomb UI. Status badge will update on the hex grid.",
  {
    state: z
      .enum(["idle", "working", "waiting_input", "waiting_permission", "done", "stuck", "error"])
      .describe("Current status: idle (at prompt), working (executing), waiting_input (needs user input), waiting_permission (needs Y/N), done (task complete), stuck (needs help), error (failed)"),
    message: z
      .string()
      .optional()
      .describe("Optional message explaining the status"),
  },
  async ({ state, message }) => {
    try {
      const result = await sendRequest<McpReportStatusResponse["payload"]>("mcp.reportStatus", {
        state: state as DetailedStatus,
        message,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Status report failed: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Status updated to: ${state}${message ? ` (${message})` : ""}`,
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

// Tool: report_result
mcpServer.tool(
  "report_result",
  "Report task completion result to your parent orchestrator. Call this when you've finished your assigned task. Your status will automatically be set to 'done'.",
  {
    parentId: z.string().describe("Parent orchestrator agent ID (from HGNUCOMB_PARENT_ID environment variable)"),
    result: z.unknown().describe("Result payload (any JSON-serializable data)"),
    success: z.boolean().describe("Whether the task completed successfully"),
    message: z.string().optional().describe("Optional message describing the result or any issues"),
  },
  async ({ parentId, result, success, message }) => {
    try {
      // First, report the result to parent
      const resultResponse = await sendRequest<McpReportResultResponse["payload"]>("mcp.reportResult", {
        parentId,
        result,
        success,
        message,
      });

      if (!resultResponse.success) {
        return {
          content: [{ type: "text", text: `Failed to report result: ${resultResponse.error}` }],
          isError: true,
        };
      }

      // Also update own status to 'done'
      await sendRequest<McpReportStatusResponse["payload"]>("mcp.reportStatus", {
        state: "done" as DetailedStatus,
        message: message ?? (success ? "Task completed" : "Task failed"),
      });

      return {
        content: [
          {
            type: "text",
            text: `Result reported to parent ${parentId}. Success: ${success}${message ? ` - ${message}` : ""}`,
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

// Tool: get_messages
mcpServer.tool(
  "get_messages",
  "Get messages from your inbox. Use this to poll for results from spawned workers or broadcasts from nearby agents.",
  {
    since: z.string().optional().describe("ISO timestamp - only return messages after this time"),
  },
  async ({ since }) => {
    try {
      const result = await sendRequest<McpGetMessagesResponse["payload"]>("mcp.getMessages", {
        since,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to get messages: ${result.error}` }],
          isError: true,
        };
      }

      const messages = result.messages ?? [];
      if (messages.length === 0) {
        return {
          content: [{ type: "text", text: "No new messages in inbox" }],
        };
      }

      const formatted = messages.map((m: AgentMessage) => {
        const payload = JSON.stringify(m.payload, null, 2);
        return `[${m.timestamp}] From: ${m.from} Type: ${m.type}\n${payload}`;
      }).join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `${messages.length} message(s):\n\n${formatted}`,
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

// Tool: get_identity
mcpServer.tool(
  "get_identity",
  "Get your own agent identity. Use this to find your agent ID, cell type, parent ID (for workers), and hex coordinates. Call this first if you need to know who you are or who your parent is.",
  {},
  async () => {
    const identity = {
      agentId: AGENT_ID,
      cellType: CELL_TYPE,
      parentId: PARENT_ID ?? null,
      hex: HEX_COORD ?? null,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(identity, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Log identity on startup so it's visible in Claude's context
  console.error(`[MCP] Agent identity: ${AGENT_ID} (${CELL_TYPE})${PARENT_ID ? ` parent=${PARENT_ID}` : ""}`);

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
