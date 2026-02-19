/**
 * Server notification handler for the browser client.
 *
 * Dispatches WebSocket notifications to the appropriate store actions.
 * Extracted from App.tsx to reduce component bloat.
 *
 * Follows the same dependency-injection pattern as mcpHandler.ts —
 * store actions are injected, making this testable without real stores.
 */

import type { AgentState } from '@features/agents/agentStore';
import type { TerminalSession } from '@features/terminal/terminalStore';
import type {
  AgentMessage,
  AgentTelemetryData,
  HexCoordinate,
} from '@shared/protocol';
import type { CellType, DetailedStatus } from '@shared/types';

// ============================================================================
// Types
// ============================================================================

export interface NotificationHandlerDeps {
  // Agent store
  getAgent: (id: string) => AgentState | undefined;
  updateAgentType: (agentId: string, newCellType: CellType) => boolean;
  removeAgent: (id: string) => void;
  updateDetailedStatus: (agentId: string, status: DetailedStatus, message?: string) => DetailedStatus | undefined;
  updateActivities: (updates: Array<{
    agentId: string;
    createdAt: number;
    lastActivityAt: number;
    gitCommitCount: number;
    gitRecentCommits: string[];
    telemetry?: AgentTelemetryData;
  }>) => void;
  setAgentInbox: (agentId: string, messages: AgentMessage[]) => void;

  // Terminal store
  removeSession: (sessionId: string) => void;
  getSessionForAgent: (agentId: string) => TerminalSession | undefined;

  // Event log store
  addRemoval: (agentId: string, reason: 'cleanup' | 'kill') => void;
  addMessageReceived: (recipientId: string, senderId: string, messageType: 'result' | 'broadcast', payload: unknown) => void;
  addBroadcast: (senderId: string, senderHex: HexCoordinate, broadcastType: string, radius: number, recipientCount: number, payload: unknown) => void;
  addStatusChange: (agentId: string, newStatus: DetailedStatus, message?: string, previousStatus?: DetailedStatus) => void;

  // UI store
  getSelectedAgentId: () => string | null;
  selectAgent: (agentId: string | null) => void;
}

// ============================================================================
// Notification message shape (from server)
// ============================================================================

interface ServerNotification {
  type: string;
  payload?: Record<string, unknown>;
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create a notification handler with the given dependencies.
 *
 * @param deps Store actions and selectors
 * @returns Handler function for server notifications
 */
export function createNotificationHandler(
  deps: NotificationHandlerDeps
): (notification: unknown) => void {
  return (notification: unknown) => {
    if (typeof notification !== 'object' || notification === null) return;
    const msg = notification as ServerNotification;
    if (!msg.payload) return;

    // server.info is handled in the bridge init effect (before connect)

    // Handle cell type conversion (orchestrator/worker -> terminal)
    if (msg.type === 'cell.converted') {
      const { agentId, newCellType } = msg.payload as {
        agentId: string;
        oldCellType: string;
        newCellType: string;
        sessionId: string;
      };
      deps.updateAgentType(agentId, newCellType as CellType);
      return;
    }

    // Handle agent removal
    if (msg.type === 'agent.removed') {
      const { agentId, reason, sessionId } = msg.payload as {
        agentId: string;
        reason: 'cleanup' | 'kill';
        sessionId?: string;
      };

      deps.removeAgent(agentId);

      // Remove associated terminal session
      if (sessionId) {
        deps.removeSession(sessionId);
      } else {
        const session = deps.getSessionForAgent(agentId);
        if (session) {
          deps.removeSession(session.sessionId);
        }
      }

      deps.addRemoval(agentId, reason);

      if (deps.getSelectedAgentId() === agentId) {
        deps.selectAgent(null);
      }
      return;
    }

    // Handle inbox sync from server (display only - server is source of truth)
    if (msg.type === 'inbox.sync') {
      const { agentId, messages } = msg.payload as {
        agentId: string;
        messages: AgentMessage[];
      };
      const agent = deps.getAgent(agentId);
      if (agent) {
        // Log new messages that weren't in the previous inbox
        const oldIds = new Set(agent.inbox.map((m) => m.id));
        for (const incomingMsg of messages) {
          if (!oldIds.has(incomingMsg.id)) {
            deps.addMessageReceived(agentId, incomingMsg.from, incomingMsg.type, incomingMsg.payload);
          }
        }
        deps.setAgentInbox(agentId, messages);
      }
      return;
    }

    // Handle broadcast event from server (for EventLog display)
    if (msg.type === 'mcp.broadcast.event') {
      const { senderId, senderHex, broadcastType, radius, recipientCount } = msg.payload as {
        senderId: string;
        senderHex: HexCoordinate;
        broadcastType: string;
        radius: number;
        recipientCount: number;
        recipients: string[];
      };
      deps.addBroadcast(senderId, senderHex, broadcastType, radius, recipientCount, null);
      return;
    }

    // Handle agent activity broadcast (HUD observability data)
    if (msg.type === 'agent.activity') {
      const { agents: activities } = msg.payload as {
        agents: Array<{
          agentId: string;
          createdAt: number;
          lastActivityAt: number;
          gitCommitCount: number;
          gitRecentCommits: string[];
          telemetry?: AgentTelemetryData;
        }>;
      };
      // Batched: single set() call, single re-render for all subscribers.
      deps.updateActivities(activities);
      return;
    }

    // Handle status updates from server (both explicit agent reports and inferred PTY activity)
    if (msg.type === 'mcp.statusUpdate') {
      const { agentId, state, message: statusMessage, previousStatus, source } = msg.payload as {
        agentId: string;
        state: DetailedStatus;
        message?: string;
        previousStatus?: DetailedStatus;
        source?: 'explicit' | 'inferred';
      };

      if (source === 'explicit') {
        // Explicit agent-reported status: always apply + log to event log
        deps.updateDetailedStatus(agentId, state, statusMessage);
        deps.addStatusChange(agentId, state, statusMessage, previousStatus);
      } else {
        // Inferred from PTY activity: apply sticky-state filtering
        // Don't override explicit statuses that agents deliberately set
        const agent = deps.getAgent(agentId);
        const stickyStates: DetailedStatus[] = ['error', 'cancelled', 'waiting_input', 'waiting_permission', 'stuck'];
        if (agent && stickyStates.includes(agent.detailedStatus)) {
          return;
        }
        deps.updateDetailedStatus(agentId, state);
      }
      return;
    }
  };
}
