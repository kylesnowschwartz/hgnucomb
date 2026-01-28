/**
 * Context schema for orchestrator agents.
 *
 * When an orchestrator spawns, it receives a JSON file describing the grid state.
 * This gives the agent awareness of its position, nearby agents, and capabilities.
 */

import type { HexCoordinate } from './types.ts';

// ============================================================================
// Agent Snapshot (sent from client to server)
// ============================================================================

export type CellType = 'terminal' | 'orchestrator' | 'worker';
/** Agent operational status - must match protocol/types.ts */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'offline';

/**
 * Minimal agent info sent from client when creating a session.
 * Contains everything needed to build context.
 */
export interface AgentSnapshot {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
  connections: string[];
}

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
 * Full context JSON schema following JSON-RPC 2.0 style.
 */
export interface HgnucombContext {
  jsonrpc: '2.0';
  context: {
    self: ContextSelf;
    grid: ContextGrid;
    task: null; // Reserved for future task assignment
    capabilities: ContextCapabilities;
  };
}
