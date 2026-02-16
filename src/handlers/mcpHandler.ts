/**
 * MCP request handler for the browser client.
 *
 * Handles incoming MCP requests from orchestrator agents via the WebSocket bridge.
 * Extracted from App.tsx to reduce component bloat.
 */

import type { TerminalBridge } from '@features/terminal/TerminalBridge';
import type { AgentState, SpawnOptions } from '@features/agents/agentStore';
import type {
  McpRequest,
  McpSpawnResponse,
  McpGetGridResponse,
  McpGridAgent,
  HexCoordinate,
  CellType,
} from '@shared/protocol';
import { hexDistance, getHexRing } from '@shared/types';

// ============================================================================
// Types
// ============================================================================

export interface McpHandlerDeps {
  getAgent: (id: string) => AgentState | undefined;
  getAllAgents: () => AgentState[];
  spawnAgent: (
    hex: HexCoordinate,
    cellType: CellType,
    options: SpawnOptions,
  ) => string;
  addSpawn: (
    agentId: string,
    cellType: CellType,
    hex: HexCoordinate
  ) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find nearest empty hex to a given position using ring expansion.
 * Searches distance 1, then 2, etc. until an empty hex is found.
 */
function findNearestEmptyHex(
  center: HexCoordinate,
  agents: AgentState[]
): HexCoordinate {
  const occupied = new Set(agents.map((a) => `${a.hex.q},${a.hex.r}`));

  for (let radius = 1; radius <= 10; radius++) {
    const ring = getHexRing(center, radius);
    for (const hex of ring) {
      if (!occupied.has(`${hex.q},${hex.r}`)) {
        return hex;
      }
    }
  }

  // Fallback: return adjacent hex even if occupied (shouldn't happen)
  return { q: center.q + 1, r: center.r };
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create an MCP request handler with the given dependencies.
 *
 * @param deps Store actions and selectors
 * @param bridge WebSocket bridge for sending responses
 * @returns Handler function for MCP requests
 */
export function createMcpHandler(
  deps: McpHandlerDeps,
  bridge: TerminalBridge
): (request: McpRequest) => void {
  const {
    getAgent,
    getAllAgents,
    spawnAgent,
    addSpawn,
  } = deps;

  return (request: McpRequest) => {
    console.log('[McpHandler] Request:', request.type, request.payload);

    switch (request.type) {
      case 'mcp.register': {
        // Registration is handled server-side, not in browser
        break;
      }

      case 'mcp.spawn': {
        const { callerId, q, r, cellType, task, instructions, taskDetails, model, repoPath } =
          request.payload;

        // Validate caller exists and is orchestrator
        const caller = getAgent(callerId);
        if (!caller) {
          const response: McpSpawnResponse = {
            type: 'mcp.spawn.result',
            requestId: request.requestId,
            payload: {
              success: false,
              error: `Caller agent not found: ${callerId}`,
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        if (caller.cellType !== 'orchestrator') {
          const response: McpSpawnResponse = {
            type: 'mcp.spawn.result',
            requestId: request.requestId,
            payload: {
              success: false,
              error: 'Only orchestrators can spawn agents',
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        // Determine hex position
        let targetHex = { q: q ?? 0, r: r ?? 0 };
        if (q === undefined || r === undefined) {
          targetHex = findNearestEmptyHex(caller.hex, getAllAgents());
        }

        // Check if hex is occupied
        const agents = getAllAgents();
        const occupied = agents.some(
          (a) => a.hex.q === targetHex.q && a.hex.r === targetHex.r
        );
        if (occupied) {
          const response: McpSpawnResponse = {
            type: 'mcp.spawn.result',
            requestId: request.requestId,
            payload: {
              success: false,
              error: `Hex (${targetHex.q}, ${targetHex.r}) is already occupied`,
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        // Spawn the agent
        const newAgentId = spawnAgent(targetHex, cellType, {
          parentId: callerId,
          parentHex: caller.hex,
          task,
          instructions,
          taskDetails,
          model,
          repoPath,
        });
        addSpawn(newAgentId, cellType, targetHex);

        const response: McpSpawnResponse = {
          type: 'mcp.spawn.result',
          requestId: request.requestId,
          payload: { success: true, agentId: newAgentId, hex: targetHex },
        };
        bridge.sendMcpResponse(response);
        console.log(
          '[McpHandler] Spawned agent:',
          newAgentId,
          'at',
          targetHex,
          task ? `task: ${task}` : '',
          instructions ? 'with instructions' : ''
        );
        break;
      }

      case 'mcp.getGrid': {
        const { callerId, maxDistance = 5 } = request.payload;

        const caller = getAgent(callerId);
        if (!caller) {
          const response: McpGetGridResponse = {
            type: 'mcp.getGrid.result',
            requestId: request.requestId,
            payload: {
              success: false,
              error: `Caller agent not found: ${callerId}`,
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        const agents = getAllAgents();
        const nearbyAgents: McpGridAgent[] = agents
          .map((a) => ({
            agentId: a.id,
            cellType: a.cellType,
            hex: a.hex,
            status: a.status,
            distance: hexDistance(caller.hex, a.hex),
          }))
          .filter((a) => a.distance <= maxDistance)
          .sort((a, b) => a.distance - b.distance);

        const response: McpGetGridResponse = {
          type: 'mcp.getGrid.result',
          requestId: request.requestId,
          payload: { success: true, agents: nearbyAgents },
        };
        bridge.sendMcpResponse(response);
        break;
      }

      // mcp.broadcast, mcp.reportResult, mcp.reportStatus, mcp.getMessages, mcp.getWorkerStatus
      // are all handled server-side (server/index.ts) and no longer routed through the browser.
    }
  };
}
