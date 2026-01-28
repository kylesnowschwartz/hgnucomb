/**
 * MCP request handler for the browser client.
 *
 * Handles incoming MCP requests from orchestrator agents via the WebSocket bridge.
 * Extracted from App.tsx to reduce component bloat.
 */

import type { TerminalBridge } from '@features/terminal/TerminalBridge';
import type { AgentState } from '@features/agents/agentStore';
import type {
  McpRequest,
  McpSpawnResponse,
  McpGetGridResponse,
  McpGridAgent,
  McpBroadcastResponse,
  McpReportStatusResponse,
  McpReportResultResponse,
  McpGetMessagesResponse,
  McpGetWorkerStatusResponse,
  AgentMessage,
  HexCoordinate,
  CellType,
  DetailedStatus,
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
    options: {
      parentId?: string;
      parentHex?: HexCoordinate;
      task?: string;
      instructions?: string;
      taskDetails?: string;
    }
  ) => string;
  updateDetailedStatus: (
    agentId: string,
    status: DetailedStatus,
    message?: string
  ) => DetailedStatus | undefined;
  addMessageToInbox: (agentId: string, message: AgentMessage) => boolean;
  getMessages: (agentId: string, since?: string) => AgentMessage[];
  addBroadcast: (
    senderId: string,
    senderHex: HexCoordinate,
    broadcastType: string,
    radius: number,
    recipientCount: number,
    payload: unknown
  ) => void;
  addStatusChange: (
    agentId: string,
    newStatus: DetailedStatus,
    message?: string,
    previousStatus?: DetailedStatus
  ) => void;
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
    updateDetailedStatus,
    addMessageToInbox,
    getMessages,
    addBroadcast,
    addStatusChange,
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
        const { callerId, q, r, cellType, task, instructions, taskDetails } =
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

      case 'mcp.broadcast': {
        const { callerId, radius, broadcastType, broadcastPayload } =
          request.payload;

        const caller = getAgent(callerId);
        if (!caller) {
          const response: McpBroadcastResponse = {
            type: 'mcp.broadcast.result',
            requestId: request.requestId,
            payload: {
              success: false,
              delivered: 0,
              recipients: [],
              error: `Caller agent not found: ${callerId}`,
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        const agents = getAllAgents();
        const recipients = agents
          .filter((a) => a.id !== callerId)
          .filter((a) => hexDistance(caller.hex, a.hex) <= radius)
          .map((a) => a.id);

        addBroadcast(
          callerId,
          caller.hex,
          broadcastType,
          radius,
          recipients.length,
          broadcastPayload
        );

        for (const recipientId of recipients) {
          const broadcastMessage: AgentMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            from: callerId,
            type: 'broadcast',
            payload: { broadcastType, broadcastPayload },
            timestamp: new Date().toISOString(),
          };
          const wasAdded = addMessageToInbox(recipientId, broadcastMessage);
          if (wasAdded) {
            const recipient = getAgent(recipientId);
            bridge.sendInboxNotification({
              agentId: recipientId,
              messageCount: recipient?.inbox.length ?? 1,
              latestTimestamp: broadcastMessage.timestamp,
            });
          }
        }

        const response: McpBroadcastResponse = {
          type: 'mcp.broadcast.result',
          requestId: request.requestId,
          payload: { success: true, delivered: recipients.length, recipients },
        };
        bridge.sendMcpResponse(response);
        console.log(
          '[McpHandler] Broadcast from',
          callerId,
          'type:',
          broadcastType,
          'delivered:',
          recipients.length
        );
        break;
      }

      case 'mcp.reportStatus': {
        const { callerId, state, message } = request.payload;

        const previousStatus = updateDetailedStatus(callerId, state, message);

        if (previousStatus === undefined) {
          const response: McpReportStatusResponse = {
            type: 'mcp.reportStatus.result',
            requestId: request.requestId,
            payload: { success: false, error: `Agent not found: ${callerId}` },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        addStatusChange(callerId, state, message, previousStatus);

        const response: McpReportStatusResponse = {
          type: 'mcp.reportStatus.result',
          requestId: request.requestId,
          payload: { success: true },
        };
        bridge.sendMcpResponse(response);
        console.log(
          '[McpHandler] Status update:',
          callerId,
          previousStatus,
          '->',
          state
        );
        break;
      }

      case 'mcp.reportResult': {
        const { callerId, parentId, result, success, message } = request.payload;

        const parent = getAgent(parentId);
        if (!parent) {
          const response: McpReportResultResponse = {
            type: 'mcp.reportResult.result',
            requestId: request.requestId,
            payload: {
              success: false,
              error: `Parent agent not found: ${parentId}`,
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        const agentMessage: AgentMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from: callerId,
          type: 'result',
          payload: { result, success, message },
          timestamp: new Date().toISOString(),
        };

        const added = addMessageToInbox(parentId, agentMessage);
        if (!added) {
          const response: McpReportResultResponse = {
            type: 'mcp.reportResult.result',
            requestId: request.requestId,
            payload: {
              success: false,
              error: `Failed to add message to parent inbox`,
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        const updatedParent = getAgent(parentId);
        bridge.sendInboxNotification({
          agentId: parentId,
          messageCount: updatedParent?.inbox.length ?? 1,
          latestTimestamp: agentMessage.timestamp,
        });

        const response: McpReportResultResponse = {
          type: 'mcp.reportResult.result',
          requestId: request.requestId,
          payload: { success: true },
        };
        bridge.sendMcpResponse(response);
        console.log(
          '[McpHandler] Result reported from',
          callerId,
          'to parent',
          parentId,
          'success:',
          success
        );
        break;
      }

      case 'mcp.getMessages': {
        const { callerId, since } = request.payload;

        const messages = getMessages(callerId, since);

        const response: McpGetMessagesResponse = {
          type: 'mcp.getMessages.result',
          requestId: request.requestId,
          payload: { success: true, messages },
        };
        bridge.sendMcpResponse(response);
        console.log(
          '[McpHandler] Get messages for',
          callerId,
          'count:',
          messages.length
        );
        break;
      }

      case 'mcp.getWorkerStatus': {
        const { callerId, workerId } = request.payload;

        const caller = getAgent(callerId);
        if (!caller) {
          const response: McpGetWorkerStatusResponse = {
            type: 'mcp.getWorkerStatus.result',
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
          const response: McpGetWorkerStatusResponse = {
            type: 'mcp.getWorkerStatus.result',
            requestId: request.requestId,
            payload: {
              success: false,
              error: 'Only orchestrators can check worker status',
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        const worker = getAgent(workerId);
        if (!worker) {
          const response: McpGetWorkerStatusResponse = {
            type: 'mcp.getWorkerStatus.result',
            requestId: request.requestId,
            payload: { success: false, error: `Worker not found: ${workerId}` },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        if (worker.parentId !== callerId) {
          const response: McpGetWorkerStatusResponse = {
            type: 'mcp.getWorkerStatus.result',
            requestId: request.requestId,
            payload: {
              success: false,
              error: `Worker ${workerId} is not your child`,
            },
          };
          bridge.sendMcpResponse(response);
          return;
        }

        const response: McpGetWorkerStatusResponse = {
          type: 'mcp.getWorkerStatus.result',
          requestId: request.requestId,
          payload: {
            success: true,
            status: worker.detailedStatus,
            message: worker.statusMessage,
          },
        };
        bridge.sendMcpResponse(response);
        console.log('[McpHandler] Worker status:', workerId, worker.detailedStatus);
        break;
      }
    }
  };
}
