/**
 * Helper function for converting agent state to snapshot format.
 */

import type { AgentState } from '@state/agentStore';
import type { AgentSnapshot } from '@shared/context';

/**
 * Convert an agent state to a minimal snapshot for context generation.
 */
export function agentToSnapshot(agent: AgentState): AgentSnapshot {
  return {
    agentId: agent.id,
    cellType: agent.cellType,
    hex: agent.hex,
    status: agent.status,
    connections: agent.connections,
  };
}
