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
  McpGetWorkerStatusResponse,
  McpCheckWorkersResponse,
  McpGetWorkerDiffResponse,
  McpListWorkerFilesResponse,
  McpListWorkerCommitsResponse,
  McpCheckMergeConflictsResponse,
  McpMergeWorkerToStagingResponse,
  McpMergeStagingToMainResponse,
  McpCleanupWorkerWorktreeResponse,
  McpKillWorkerResponse,
  DetailedStatus,
  AgentMessage,
  WorkerSummary,
} from "../shared/protocol.ts";

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

// Pending wait for inbox notification (used by get_messages with wait=true)
let pendingInboxWait: {
  resolve: () => void;
  timeout: NodeJS.Timeout;
} | null = null;

function handleWsMessage(msg: McpSpawnResponse | McpGetGridResponse | { type: string; payload?: unknown }): void {
  // Handle inbox notification - wake any pending get_messages(wait=true)
  if (msg.type === 'mcp.inbox.notification') {
    console.error(`[MCP] Received inbox notification, pendingInboxWait=${pendingInboxWait ? 'SET' : 'null'}`);
    if (pendingInboxWait) {
      console.error("[MCP] Waking pending get_messages...");
      const pending = pendingInboxWait;
      pendingInboxWait = null;  // Clear first to prevent double-wake
      clearTimeout(pending.timeout);
      pending.resolve();
    }
    return;
  }

  if (!('requestId' in msg) || !msg.requestId) return;

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
    model: z.enum(["opus", "sonnet", "haiku"]).optional().describe(
      "Claude model to use. Defaults: orchestrator=opus, worker=sonnet. " +
      "Use haiku for simple/fast tasks, sonnet for standard work, opus for complex reasoning."
    ),
    repoPath: z.string().optional().describe(
      "Absolute path to a git repository for the worker's worktree. " +
      "Required when orchestrator is outside a git repo (e.g., a meta-directory). " +
      "The worker will get an isolated worktree in this repo."
    ),
  },
  async ({ q, r, cellType, task, instructions, taskDetails, model, repoPath }) => {
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
        model,
        repoPath,
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
  `Update your status badge on the hex grid (UI observability for humans).

Workers: Report "done" AFTER calling report_result to your parent.
Orchestrators: Report "done" ONLY when your entire mission is complete, including waiting for all spawned workers via await_worker.`,
  {
    state: z
      .enum(["idle", "working", "waiting_input", "waiting_permission", "done", "stuck", "error"])
      .describe("idle=waiting, working=executing, waiting_input=needs text, waiting_permission=needs Y/N, done=mission complete, stuck=needs help, error=failed"),
    message: z
      .string()
      .optional()
      .describe("Short explanation of current state"),
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
  "Get and consume messages from your inbox. Messages are deleted after reading (auto-consume). Use wait=true to block until a message arrives (IMAP IDLE style). Returns immediately if messages exist.",
  {
    since: z.string().optional().describe("ISO timestamp - only return messages after this time"),
    fromAgent: z.string().optional().describe("Only return messages from this specific agent ID"),
    wait: z.boolean().optional().describe("Block until a message arrives (default: false)"),
    timeout: z.number().optional().describe("Wait timeout in milliseconds (default: 30000, max: 60000)"),
  },
  async ({ since, fromAgent, wait, timeout }) => {
    const waitTimeout = Math.min(timeout ?? 30000, 60000);
    // Accept any truthy value for wait (handles string "true" if MCP passes it wrong)
    const shouldWait = Boolean(wait);

    console.error(`[MCP] get_messages called: wait=${JSON.stringify(wait)} (${typeof wait}), shouldWait=${shouldWait}, timeout=${waitTimeout}`);

    /**
     * Format messages for response.
     */
    const formatMessages = (messages: AgentMessage[]) => {
      if (messages.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No new messages in inbox" }],
        };
      }

      const formatted = messages.map((m: AgentMessage) => {
        const payload = JSON.stringify(m.payload, null, 2);
        return `[${m.timestamp}] From: ${m.from} Type: ${m.type}\n${payload}`;
      }).join("\n\n");

      return {
        content: [{ type: "text" as const, text: `${messages.length} message(s):\n\n${formatted}` }],
      };
    };

    try {
      // Check current inbox first
      const result = await sendRequest<McpGetMessagesResponse["payload"]>("mcp.getMessages", {
        since,
        fromAgent,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to get messages: ${result.error}` }],
          isError: true,
        };
      }

      const messages = result.messages ?? [];
      console.error(`[MCP] get_messages initial check: ${messages.length} messages`);

      // If we have messages or not waiting, return immediately
      if (messages.length > 0 || !shouldWait) {
        console.error(`[MCP] get_messages returning immediately: messages=${messages.length}, shouldWait=${shouldWait}`);
        return formatMessages(messages);
      }

      // No messages and wait=true: block until notification or timeout
      console.error(`[MCP] get_messages: BLOCKING - waiting for inbox notification (timeout: ${waitTimeout}ms)`);

      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          console.error("[MCP] get_messages: TIMEOUT reached");
          pendingInboxWait = null;
          resolve({ content: [{ type: "text" as const, text: "No messages (timeout)" }] });
        }, waitTimeout);

        pendingInboxWait = {
          resolve: async () => {
            console.error("[MCP] get_messages: WOKEN by inbox notification, re-fetching...");
            clearTimeout(timeoutId);
            pendingInboxWait = null;
            // Re-fetch messages after notification
            try {
              const newResult = await sendRequest<McpGetMessagesResponse["payload"]>("mcp.getMessages", { since, fromAgent });
              console.error(`[MCP] get_messages: re-fetch got ${newResult.messages?.length ?? 0} messages`);
              resolve(formatMessages(newResult.messages ?? []));
            } catch (err) {
              console.error(`[MCP] get_messages: re-fetch error: ${err}`);
              resolve({
                content: [{ type: "text" as const, text: `Error fetching messages: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
              });
            }
          },
          timeout: timeoutId,
        };
      });
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

// Tool: get_worker_status
mcpServer.tool(
  "get_worker_status",
  "Check the current status of a worker agent you spawned. Only works for your own workers.",
  {
    workerId: z.string().describe("The agent ID of the worker to check"),
  },
  async ({ workerId }) => {
    // Permission check: only orchestrators can check worker status
    if (!canSpawn()) {
      return {
        content: [
          {
            type: "text",
            text: `Permission denied: Only orchestrators can check worker status. You are a ${CELL_TYPE}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpGetWorkerStatusResponse["payload"]>("mcp.getWorkerStatus", {
        workerId,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to get worker status: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              workerId,
              status: result.status,
              statusMessage: result.message,
              isComplete: result.status === 'done' || result.status === 'error',
            }, null, 2),
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

// Tool: check_workers
mcpServer.tool(
  "check_workers",
  "Get status of ALL your spawned workers in one call. Returns immediately (non-blocking). " +
  "Use this to monitor progress while staying interactive with the user. " +
  "Prefer this over await_worker when you want to remain responsive.",
  {},
  async () => {
    if (!canSpawn()) {
      return {
        content: [
          {
            type: "text",
            text: `Permission denied: Only orchestrators can check workers. You are a ${CELL_TYPE}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpCheckWorkersResponse["payload"]>("mcp.checkWorkers", {});

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to check workers: ${result.error}` }],
          isError: true,
        };
      }

      const workers = result.workers ?? [];
      if (workers.length === 0) {
        return {
          content: [{ type: "text", text: "No workers spawned yet." }],
        };
      }

      const summary = result.summary!;
      const lines = workers.map((w: WorkerSummary) => {
        const result = w.hasResult ? " [RESULT READY]" : "";
        const msg = w.statusMessage ? ` (${w.statusMessage})` : "";
        const task = w.task ? ` task="${w.task}"` : "";
        return `  ${w.workerId}: ${w.status}${msg}${task}${result}`;
      });

      const header = `Workers: ${summary.total} total, ${summary.done} done, ${summary.error} error, ${summary.working} working`;

      return {
        content: [
          {
            type: "text",
            text: `${header}\n\n${lines.join("\n")}`,
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

// Tool: await_worker
mcpServer.tool(
  "await_worker",
  "Wait for a worker to complete. Polls status every 2s until done/error or timeout. Returns final status and any messages. " +
  "WARNING: This BLOCKS your session. Prefer check_workers for non-blocking status checks.",
  {
    workerId: z.string().describe("Worker agent ID to wait for"),
    timeout: z.number().optional().default(300000).describe("Timeout in ms (default: 300000/5min, max: 600000/10min)"),
    pollInterval: z.number().optional().default(2000).describe("Poll interval in ms (default: 2000, min: 500)"),
  },
  async ({ workerId, timeout, pollInterval }) => {
    // Permission check: only orchestrators can await workers
    if (!canSpawn()) {
      return {
        content: [
          {
            type: "text",
            text: `Permission denied: Only orchestrators can await workers. You are a ${CELL_TYPE}.`,
          },
        ],
        isError: true,
      };
    }

    const effectiveTimeout = Math.min(timeout ?? 300000, 600000);
    const interval = Math.max(pollInterval ?? 2000, 500);
    const deadline = Date.now() + effectiveTimeout;

    console.error(`[MCP] await_worker: starting poll for ${workerId}, timeout=${effectiveTimeout}ms, interval=${interval}ms`);

    while (Date.now() < deadline) {
      try {
        const statusResult = await sendRequest<McpGetWorkerStatusResponse["payload"]>("mcp.getWorkerStatus", {
          workerId,
        });

        if (!statusResult.success) {
          return {
            content: [{ type: "text", text: `Worker check failed: ${statusResult.error}` }],
            isError: true,
          };
        }

        console.error(`[MCP] await_worker: worker ${workerId} status=${statusResult.status}`);

        // Worker finished - done, error, or cancelled are terminal states
        const isTerminal = statusResult.status === 'done' ||
                          statusResult.status === 'error' ||
                          statusResult.status === 'cancelled';
        if (isTerminal) {
          console.error(`[MCP] await_worker: worker ${workerId} completed with status=${statusResult.status}`);

          // Fetch messages from this specific worker only
          const messagesResult = await sendRequest<McpGetMessagesResponse["payload"]>("mcp.getMessages", {
            fromAgent: workerId,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  workerId,
                  status: statusResult.status,
                  statusMessage: statusResult.message,
                  hasResult: (messagesResult.messages?.length ?? 0) > 0,
                  messages: messagesResult.messages ?? [],
                }, null, 2),
              },
            ],
          };
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, interval));
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error polling worker: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // Timeout
    console.error(`[MCP] await_worker: timeout waiting for worker ${workerId}`);
    return {
      content: [{ type: "text", text: `Timeout waiting for worker ${workerId} after ${effectiveTimeout}ms` }],
      isError: true,
    };
  }
);

// Tool: get_worker_diff
mcpServer.tool(
  "get_worker_diff",
  "Get diff of changes made by a worker since branching from main. Orchestrators only.",
  {
    workerId: z.string().describe("The agent ID of the worker to get diff for"),
  },
  async ({ workerId }) => {
    // Permission check: only orchestrators can view worker diffs
    if (!canSpawn()) {
      return {
        content: [
          {
            type: "text",
            text: `Permission denied: Only orchestrators can view worker diffs. You are a ${CELL_TYPE}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpGetWorkerDiffResponse["payload"]>("mcp.getWorkerDiff", {
        workerId,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to get worker diff: ${result.error}` }],
          isError: true,
        };
      }

      const diff = result.diff ?? "";
      const stats = result.stats;
      const header = stats
        ? `[${stats.files} files changed, +${stats.insertions} -${stats.deletions}]\n\n`
        : "";

      if (!diff) {
        return {
          content: [{ type: "text", text: "No changes (worker branch is identical to main)" }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `${header}${diff}`,
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

// Tool: list_worker_files
mcpServer.tool(
  "list_worker_files",
  "List files changed by a worker since branching from main (git diff --stat output). Orchestrators only.",
  {
    workerId: z.string().describe("The agent ID of the worker to list files for"),
  },
  async ({ workerId }) => {
    if (!canSpawn()) {
      return {
        content: [{ type: "text", text: `Permission denied: Only orchestrators can list worker files. You are a ${CELL_TYPE}.` }],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpListWorkerFilesResponse["payload"]>("mcp.listWorkerFiles", { workerId });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to list worker files: ${result.error ?? result.output}` }],
          isError: true,
        };
      }

      const output = result.output ?? "";
      return {
        content: [{ type: "text", text: output || "No files changed (worker branch is identical to main)" }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// Tool: list_worker_commits
mcpServer.tool(
  "list_worker_commits",
  "List commits made by a worker since branching from main (git log --oneline --stat output). Orchestrators only.",
  {
    workerId: z.string().describe("The agent ID of the worker to list commits for"),
  },
  async ({ workerId }) => {
    if (!canSpawn()) {
      return {
        content: [{ type: "text", text: `Permission denied: Only orchestrators can list worker commits. You are a ${CELL_TYPE}.` }],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpListWorkerCommitsResponse["payload"]>("mcp.listWorkerCommits", { workerId });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to list worker commits: ${result.error ?? result.output}` }],
          isError: true,
        };
      }

      const output = result.output ?? "";
      return {
        content: [{ type: "text", text: output || "No commits (worker has not committed any changes)" }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// Tool: check_merge_conflicts
mcpServer.tool(
  "check_merge_conflicts",
  "Check if merging a worker's branch into main would cause conflicts. Does a dry-run merge and reports the result. Always call this BEFORE merge_worker_changes. Orchestrators only.",
  {
    workerId: z.string().describe("The agent ID of the worker to check"),
  },
  async ({ workerId }) => {
    if (!canSpawn()) {
      return {
        content: [{ type: "text", text: `Permission denied: Only orchestrators can check merge conflicts. You are a ${CELL_TYPE}.` }],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpCheckMergeConflictsResponse["payload"]>("mcp.checkMergeConflicts", { workerId });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to check merge conflicts: ${result.error ?? result.output}` }],
          isError: true,
        };
      }

      const canMerge = result.canMerge ?? false;
      const output = result.output ?? "";

      return {
        content: [{ type: "text", text: `canMerge: ${canMerge}\n\n${output}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// Tool: merge_worker_to_staging
mcpServer.tool(
  "merge_worker_to_staging",
  "Merge a worker's branch into your staging worktree. Call this after worker completes to pull their changes into your staging area for review. Orchestrators only.",
  {
    workerId: z.string().describe("The agent ID of the worker to merge into staging"),
  },
  async ({ workerId }) => {
    if (!canSpawn()) {
      return {
        content: [{ type: "text", text: `Permission denied: Only orchestrators can merge to staging. You are a ${CELL_TYPE}.` }],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpMergeWorkerToStagingResponse["payload"]>("mcp.mergeWorkerToStaging", { workerId });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to merge worker to staging: ${result.error ?? result.output}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: result.output ?? "Merge completed" }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// Tool: merge_staging_to_main
mcpServer.tool(
  "merge_staging_to_main",
  "Merge your staging branch into main. Call this AFTER human approval to promote your staged changes to main. Orchestrators only.",
  {},
  async () => {
    if (!canSpawn()) {
      return {
        content: [{ type: "text", text: `Permission denied: Only orchestrators can merge to main. You are a ${CELL_TYPE}.` }],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpMergeStagingToMainResponse["payload"]>("mcp.mergeStagingToMain", {});

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to merge staging to main: ${result.error ?? result.output}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: result.output ?? "Merge completed" }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// Tool: cleanup_worker_worktree
mcpServer.tool(
  "cleanup_worker_worktree",
  "Clean up worker worktree and branch after merge. Removes the worker's git worktree directory and deletes the branch.",
  {
    workerId: z.string().describe("The agent ID of the worker to clean up"),
    force: z.boolean().optional().describe("Force cleanup even if worktree appears stale (optional)"),
  },
  async ({ workerId, force }) => {
    // Permission check: only orchestrators can cleanup workers
    if (!canSpawn()) {
      return {
        content: [
          {
            type: "text",
            text: `Permission denied: Only orchestrators can cleanup workers. You are a ${CELL_TYPE}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpCleanupWorkerWorktreeResponse["payload"]>("mcp.cleanupWorkerWorktree", {
        workerId,
        force,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to cleanup worker worktree: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Cleaned up worker ${workerId}${result.message ? ` - ${result.message}` : ""}`,
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

// Tool: kill_worker
mcpServer.tool(
  "kill_worker",
  "Forcibly terminate a worker agent. Kills the PTY session and cleans up resources.",
  {
    workerId: z.string().describe("The agent ID of the worker to terminate"),
    force: z.boolean().optional().describe("Force termination (optional)"),
  },
  async ({ workerId, force }) => {
    // Permission check: only orchestrators can kill workers
    if (!canSpawn()) {
      return {
        content: [
          {
            type: "text",
            text: `Permission denied: Only orchestrators can terminate workers. You are a ${CELL_TYPE}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await sendRequest<McpKillWorkerResponse["payload"]>("mcp.killWorker", {
        workerId,
        force,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Failed to terminate worker: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Terminated worker ${workerId}${result.message ? ` - ${result.message}` : ""}`,
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
