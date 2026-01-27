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

interface HgnucombContext {
  jsonrpc: "2.0";
  context: {
    self: ContextSelf;
    grid: ContextGrid;
    task: null;
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
 * Generate context JSON for an orchestrator agent.
 *
 * @param self - The spawning agent's snapshot
 * @param allAgents - All agents on the grid
 * @param maxDistance - Maximum hex distance for nearby agents (default 3)
 * @returns Context JSON object
 */
export function generateContext(
  self: AgentSnapshot,
  allAgents: AgentSnapshot[],
  maxDistance: number = DEFAULT_MAX_DISTANCE
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
      task: null,
      capabilities: {
        canSpawn: true,
        canMessage: false, // Future: enable when MCP messaging is ready
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
