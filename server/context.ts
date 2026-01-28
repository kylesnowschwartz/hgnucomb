/**
 * Context generation for orchestrator agents.
 *
 * When an orchestrator spawns, we generate a JSON file describing the grid state.
 * The path is passed via HGNUCOMB_CONTEXT env var.
 */

import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import type {
  AgentSnapshot,
  HexCoordinate,
  CellType,
  AgentStatus,
} from "./protocol.js";

// ============================================================================
// Context JSON Schema (duplicated from src/shared/context.ts for server)
// ============================================================================

interface ContextAgent {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
  distance: number;
  isParent?: boolean;
}

interface ContextConnection {
  from: string;
  to: string;
  type: "parent-child" | "sibling" | "communication";
}

interface ContextGrid {
  agents: ContextAgent[];
  connections: ContextConnection[];
}

interface ContextSelf {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
}

interface ContextCapabilities {
  canSpawn: boolean;
  canMessage: boolean;
  maxChildren: number;
}

interface ContextTask {
  taskId: string;
  description: string;
  details?: string;
  assignedBy: string;
}

interface ContextParent {
  agentId: string;
  hex: HexCoordinate;
}

interface HgnucombContext {
  jsonrpc: "2.0";
  context: {
    self: ContextSelf;
    grid: ContextGrid;
    task: ContextTask | null;
    parent: ContextParent | null;
    capabilities: ContextCapabilities;
  };
}

// ============================================================================
// Hex distance calculation (duplicated from src/shared/types.ts)
// ============================================================================

function hexDistance(a: HexCoordinate, b: HexCoordinate): number {
  const as = -a.q - a.r;
  const bs = -b.q - b.r;
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(as - bs));
}

// ============================================================================
// Context generation
// ============================================================================

const DEFAULT_MAX_DISTANCE = 3;

/**
 * Task assignment options for worker agents.
 */
export interface TaskAssignmentOptions {
  task: string;
  taskDetails?: string;
  assignedBy: string;
  parentHex: HexCoordinate;
}

/**
 * Generate context JSON for an orchestrator or worker agent.
 *
 * @param self - The spawning agent's snapshot
 * @param allAgents - All agents on the grid
 * @param maxDistance - Maximum hex distance for nearby agents (default 3)
 * @param taskAssignment - Optional task assignment for worker agents
 * @returns Context JSON object
 */
export function generateContext(
  self: AgentSnapshot,
  allAgents: AgentSnapshot[],
  maxDistance: number = DEFAULT_MAX_DISTANCE,
  taskAssignment?: TaskAssignmentOptions
): HgnucombContext {
  // Filter and transform nearby agents (excluding self)
  const nearbyAgents: ContextAgent[] = allAgents
    .filter((a) => a.agentId !== self.agentId)
    .map((a) => ({
      agentId: a.agentId,
      cellType: a.cellType,
      hex: a.hex,
      status: a.status,
      distance: hexDistance(self.hex, a.hex),
      // Mark parent if this agent is in our connections list
      ...(self.connections.includes(a.agentId) ? { isParent: true } : {}),
    }))
    .filter((a) => a.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);

  // Build connections from nearby agents
  const connections: ContextConnection[] = [];
  for (const agent of nearbyAgents) {
    if (agent.isParent) {
      connections.push({
        from: agent.agentId,
        to: self.agentId,
        type: "parent-child",
      });
    }
  }

  // Build task info if assigned
  const task: ContextTask | null = taskAssignment
    ? {
        taskId: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: taskAssignment.task,
        details: taskAssignment.taskDetails,
        assignedBy: taskAssignment.assignedBy,
      }
    : null;

  // Build parent info if this is a worker with a task
  const parent: ContextParent | null = taskAssignment
    ? {
        agentId: taskAssignment.assignedBy,
        hex: taskAssignment.parentHex,
      }
    : null;

  return {
    jsonrpc: "2.0",
    context: {
      self: {
        agentId: self.agentId,
        cellType: self.cellType,
        hex: self.hex,
        status: self.status,
      },
      grid: {
        agents: nearbyAgents,
        connections,
      },
      task,
      parent,
      capabilities: {
        canSpawn: self.cellType === "orchestrator",
        canMessage: true,
        maxChildren: 5,
      },
    },
  };
}

/**
 * Write context JSON to a temp file.
 *
 * @param agentId - Agent ID for filename
 * @param context - Context object to write
 * @returns Path to the written file
 */
export function writeContextFile(
  agentId: string,
  context: HgnucombContext
): string {
  const path = `/tmp/hgnucomb-context-${agentId}.json`;
  writeFileSync(path, JSON.stringify(context, null, 2));
  console.log(`[Context] Wrote ${path}`);
  return path;
}

/**
 * Delete context file when agent terminates.
 *
 * @param agentId - Agent ID for filename
 */
export function cleanupContextFile(agentId: string): void {
  const path = `/tmp/hgnucomb-context-${agentId}.json`;
  if (existsSync(path)) {
    unlinkSync(path);
    console.log(`[Context] Cleaned up ${path}`);
  }
}

