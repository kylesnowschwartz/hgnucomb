#!/usr/bin/env tsx
/**
 * Integration test for MCP server tools.
 *
 * Prerequisites:
 * - WebSocket server running (just dev-all)
 * - Browser client connected with at least one orchestrator agent
 *
 * Usage:
 *   cd server
 *   HGNUCOMB_AGENT_ID=<orchestrator-agent-id> pnpm exec tsx test-mcp.ts
 */

import WebSocket from "ws";
import type {
  McpSpawnResponse,
  McpGetGridResponse,
} from "../shared/protocol.ts";

const WS_URL = process.env.HGNUCOMB_WS_URL ?? "ws://localhost:3001";
const AGENT_ID = process.env.HGNUCOMB_AGENT_ID;

if (!AGENT_ID) {
  console.error("Error: HGNUCOMB_AGENT_ID environment variable is required");
  console.error("Usage: HGNUCOMB_AGENT_ID=<agent-id> pnpm exec tsx test-mcp.ts");
  process.exit(1);
}

let ws: WebSocket;
let requestCounter = 0;
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function nextRequestId(): string {
  return `test-${++requestCounter}-${Date.now()}`;
}

async function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      // Register as MCP client
      ws.send(
        JSON.stringify({
          type: "mcp.register",
          payload: { agentId: AGENT_ID },
        })
      );
      console.log(`Connected as agent: ${AGENT_ID}`);
      resolve();
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.requestId && pendingRequests.has(msg.requestId)) {
        const pending = pendingRequests.get(msg.requestId)!;
        pendingRequests.delete(msg.requestId);
        pending.resolve(msg.payload);
      }
    });

    ws.on("error", reject);
  });
}

async function sendRequest<T>(
  type: string,
  payload: Record<string, unknown>
): Promise<T> {
  const requestId = nextRequestId();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request timeout: ${requestId}`));
    }, 10000);

    pendingRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value as T);
      },
      reject,
    });

    ws.send(JSON.stringify({ type, requestId, payload: { ...payload, callerId: AGENT_ID } }));
  });
}

async function testGetGridState(): Promise<void> {
  console.log("\n=== Test: get_grid_state ===");
  const result = await sendRequest<McpGetGridResponse["payload"]>("mcp.getGrid", {
    maxDistance: 10,
  });

  if (!result.success) {
    console.error("FAIL:", result.error);
    return;
  }

  console.log(`Found ${result.agents?.length ?? 0} agents:`);
  for (const agent of result.agents ?? []) {
    console.log(`  - ${agent.agentId} (${agent.cellType}) at (${agent.hex.q},${agent.hex.r}) d=${agent.distance}`);
  }
}

async function testSpawnAgent(): Promise<void> {
  console.log("\n=== Test: spawn_agent (auto-position) ===");
  const result = await sendRequest<McpSpawnResponse["payload"]>("mcp.spawn", {
    cellType: "terminal",
  });

  if (!result.success) {
    console.error("FAIL:", result.error);
    return;
  }

  console.log(`Spawned: ${result.agentId} at (${result.hex?.q},${result.hex?.r})`);
}

async function testSpawnAtPosition(): Promise<void> {
  console.log("\n=== Test: spawn_agent (specific position) ===");
  const result = await sendRequest<McpSpawnResponse["payload"]>("mcp.spawn", {
    q: 5,
    r: 5,
    cellType: "terminal",
  });

  if (!result.success) {
    console.error("FAIL:", result.error);
    return;
  }

  console.log(`Spawned: ${result.agentId} at (${result.hex?.q},${result.hex?.r})`);
}

async function main(): Promise<void> {
  console.log("MCP Integration Test");
  console.log("====================");

  await connect();

  await testGetGridState();
  await testSpawnAgent();
  await testGetGridState();
  await testSpawnAtPosition();
  await testGetGridState();

  console.log("\n=== Done ===");
  ws.close();
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
