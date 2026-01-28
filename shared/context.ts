/**
 * Context schema for orchestrator agents.
 *
 * When an orchestrator spawns, it receives a JSON file describing the grid state.
 * This gives the agent awareness of its position, nearby agents, and capabilities.
 */

import type { HexCoordinate, CellType, AgentStatus } from './types.ts';

// Re-export for convenience
export type { HexCoordinate, CellType, AgentStatus };

// ============================================================================
// Context JSON Schema (written to file for orchestrator)
// ============================================================================

/**
 * Agent info as it appears in context (includes computed fields like distance).
 */
export interface ContextAgent {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
  distance: number;
  isParent?: boolean;
}

/**
 * Connection between two agents.
 */
export interface ContextConnection {
  from: string;
  to: string;
  type: 'parent-child' | 'sibling' | 'communication';
}

/**
 * Grid state visible to the orchestrator.
 */
export interface ContextGrid {
  agents: ContextAgent[];
  connections: ContextConnection[];
}

/**
 * Orchestrator's own identity info.
 */
export interface ContextSelf {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
}

/**
 * What the orchestrator is allowed to do.
 */
export interface ContextCapabilities {
  canSpawn: boolean;
  canMessage: boolean;
  maxChildren: number;
}

/**
 * Task assignment for worker agents.
 */
export interface ContextTask {
  taskId: string;
  description: string;
  details?: string;
  assignedBy: string;
}

/**
 * Parent agent info for workers.
 */
export interface ContextParent {
  agentId: string;
  hex?: HexCoordinate;
}

/**
 * Full context JSON schema following JSON-RPC 2.0 style.
 */
export interface HgnucombContext {
  jsonrpc: '2.0';
  context: {
    self: ContextSelf;
    grid: ContextGrid;
    task: ContextTask | null;
    parent: ContextParent | null;
    capabilities: ContextCapabilities;
  };
}
