/**
 * Wait condition factory helpers.
 *
 * These create WaitCondition objects for common scenarios in integration tests.
 */

import type { WaitCondition } from './types';
import type { AgentState } from '@state/agentStore';
import type { LogEvent } from '@state/eventLogStore';
import type { CellType } from '@shared/context';
import type { DetailedStatus } from '@terminal/types';
import { TIMEOUTS } from './IntegrationTestRunner';

// ============================================================================
// Store Getters (passed in to avoid circular deps)
// ============================================================================

export interface ConditionStores {
  getAllAgents: () => AgentState[];
  getAgent: (id: string) => AgentState | undefined;
  getEvents: () => LogEvent[];
  getSessionForAgent: (agentId: string) => { sessionId: string } | undefined;
}

// ============================================================================
// Agent Count Conditions
// ============================================================================

/**
 * Wait for total agent count to reach a value.
 */
export function agentCountEquals(
  stores: ConditionStores,
  count: number,
  timeout: number = TIMEOUTS.agentSpawn
): WaitCondition {
  return {
    description: `${count} agents on grid`,
    predicate: () => stores.getAllAgents().length === count,
    timeout,
  };
}

/**
 * Wait for at least N agents on grid.
 */
export function agentCountAtLeast(
  stores: ConditionStores,
  count: number,
  timeout: number = TIMEOUTS.agentSpawn
): WaitCondition {
  return {
    description: `at least ${count} agents on grid`,
    predicate: () => stores.getAllAgents().length >= count,
    timeout,
  };
}

/**
 * Wait for a specific number of agents with a given cellType.
 */
export function agentsByTypeCount(
  stores: ConditionStores,
  cellType: CellType,
  count: number,
  timeout: number = TIMEOUTS.agentSpawn
): WaitCondition {
  return {
    description: `${count} ${cellType} agents`,
    predicate: () => {
      const matching = stores.getAllAgents().filter((a) => a.cellType === cellType);
      return matching.length >= count;
    },
    timeout,
  };
}

// ============================================================================
// Agent Status Conditions
// ============================================================================

/**
 * Wait for a specific agent to report a status.
 */
export function agentStatusIs(
  stores: ConditionStores,
  agentId: string,
  status: DetailedStatus,
  timeout: number = TIMEOUTS.statusReports
): WaitCondition {
  return {
    description: `agent ${agentId} status === ${status}`,
    predicate: () => {
      const agent = stores.getAgent(agentId);
      return agent?.detailedStatus === status;
    },
    timeout,
  };
}

/**
 * Wait for all agents of a type to report a specific status.
 */
export function allAgentsOfTypeHaveStatus(
  stores: ConditionStores,
  cellType: CellType,
  status: DetailedStatus,
  timeout: number = TIMEOUTS.statusReports
): WaitCondition {
  return {
    description: `all ${cellType} agents have status ${status}`,
    predicate: () => {
      const agents = stores.getAllAgents().filter((a) => a.cellType === cellType);
      return agents.length > 0 && agents.every((a) => a.detailedStatus === status);
    },
    timeout,
  };
}

// ============================================================================
// Event Log Conditions
// ============================================================================

/**
 * Wait for an event of a specific kind to be logged.
 */
export function eventLogged(
  stores: ConditionStores,
  kind: LogEvent['kind'],
  timeout: number = TIMEOUTS.statusReports
): WaitCondition {
  return {
    description: `event of kind '${kind}' logged`,
    predicate: () => stores.getEvents().some((e) => e.kind === kind),
    timeout,
  };
}

/**
 * Wait for a broadcast event with a specific type.
 */
export function broadcastLogged(
  stores: ConditionStores,
  broadcastType: string,
  timeout: number = TIMEOUTS.statusReports
): WaitCondition {
  return {
    description: `broadcast '${broadcastType}' logged`,
    predicate: () =>
      stores.getEvents().some(
        (e) => e.kind === 'broadcast' && e.broadcastType === broadcastType
      ),
    timeout,
  };
}

/**
 * Wait for a status_change event for a specific agent.
 */
export function statusChangeLogged(
  stores: ConditionStores,
  agentId: string,
  newStatus: DetailedStatus,
  timeout: number = TIMEOUTS.statusReports
): WaitCondition {
  return {
    description: `status_change to '${newStatus}' for ${agentId} logged`,
    predicate: () =>
      stores.getEvents().some(
        (e) =>
          e.kind === 'status_change' &&
          e.agentId === agentId &&
          e.newStatus === newStatus
      ),
    timeout,
  };
}

// ============================================================================
// Composite Conditions
// ============================================================================

/**
 * Wait for multiple conditions to all be true.
 */
export function allConditions(
  conditions: WaitCondition[],
  timeout?: number
): WaitCondition {
  const maxTimeout = timeout ?? Math.max(...conditions.map((c) => c.timeout));
  return {
    description: conditions.map((c) => c.description).join(' AND '),
    predicate: () => conditions.every((c) => c.predicate()),
    timeout: maxTimeout,
  };
}

/**
 * Wait for any one of the conditions to be true.
 */
export function anyCondition(
  conditions: WaitCondition[],
  timeout?: number
): WaitCondition {
  const maxTimeout = timeout ?? Math.max(...conditions.map((c) => c.timeout));
  return {
    description: conditions.map((c) => c.description).join(' OR '),
    predicate: () => conditions.some((c) => c.predicate()),
    timeout: maxTimeout,
  };
}

// ============================================================================
// Time-based Conditions
// ============================================================================

/**
 * Wait for a fixed delay. Useful for giving Claude time to process.
 * Start time is captured on first predicate check, not at creation.
 */
export function delay(ms: number): WaitCondition {
  let start: number | null = null;
  return {
    description: `${ms}ms delay`,
    predicate: () => {
      if (start === null) {
        start = Date.now();
      }
      return Date.now() - start >= ms;
    },
    timeout: ms + 1000, // Allow some buffer
    pollInterval: Math.min(ms, 100),
  };
}
