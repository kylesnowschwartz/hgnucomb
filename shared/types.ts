/**
 * Core types and hex coordinate utilities.
 *
 * Hex grid uses axial coordinates with "pointy-top" orientation.
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

// ============================================================================
// Hex Coordinate Types
// ============================================================================

/**
 * Axial coordinate for hexagonal grids.
 * q is column, r is row.
 */
export interface HexCoordinate {
  q: number;
  r: number;
}

// ============================================================================
// Agent Types
// ============================================================================

export type CellType = 'terminal' | 'orchestrator' | 'worker';
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'offline';

/**
 * Detailed agent status - 9-state model for fine-grained observability.
 *
 * Lifecycle: pending -> (idle|working) -> ... -> (done|error|cancelled)
 * Terminal states: done, error, cancelled (no further transitions)
 */
export type DetailedStatus =
  | 'pending'        // Spawned, waiting for Claude CLI to boot (~10-30s)
  | 'idle'           // At prompt, waiting for command
  | 'working'        // Actively executing
  | 'waiting_input'  // Needs user to type something
  | 'waiting_permission' // Needs Y/N approval
  | 'done'           // Finished assigned task
  | 'stuck'          // Explicitly requested help
  | 'error'          // Critical failure
  | 'cancelled';     // Aborted by user or timeout

/** Terminal states - agent is finished and won't transition further */
export const TERMINAL_STATUSES: ReadonlySet<DetailedStatus> = new Set(['done', 'error', 'cancelled']);

/**
 * Minimal agent info sent from client when creating a session.
 */
export interface AgentSnapshot {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
  connections: string[];
}

/**
 * Extended agent metadata stored server-side for session persistence.
 * Includes everything needed to restore the grid after browser refresh.
 */
export interface StoredAgentMetadata extends AgentSnapshot {
  parentId?: string;
  parentHex?: HexCoordinate;
  task?: string;
  taskDetails?: string;
  initialPrompt?: string;
  instructions?: string;
  detailedStatus?: DetailedStatus;
  statusMessage?: string;
  /** Directory of the target project (where agents work). Falls back to server's TOOL_DIR. */
  projectDir?: string;
  /** Epoch ms when the session was created (for elapsed time display) */
  createdAt?: number;
}

// ============================================================================
// Hex Coordinate Utilities
// ============================================================================

/**
 * Convert hex axial coordinates to pixel position.
 * Uses pointy-top orientation.
 */
export function hexToPixel(hex: HexCoordinate, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * hex.q + (Math.sqrt(3) / 2) * hex.r);
  const y = size * ((3 / 2) * hex.r);
  return { x, y };
}

/**
 * Generate hex coordinates within a rectangular pixel region.
 * Used for viewport culling - only render hexes visible on screen.
 */
export function hexesInRect(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  size: number
): HexCoordinate[] {
  const hexes: HexCoordinate[] = [];
  const rMin = Math.floor(minY / (size * 1.5)) - 1;
  const rMax = Math.ceil(maxY / (size * 1.5)) + 1;
  const sqrt3 = Math.sqrt(3);

  for (let r = rMin; r <= rMax; r++) {
    const rOffset = (sqrt3 / 2) * r;
    const qMin = Math.floor((minX / size - rOffset) / sqrt3) - 1;
    const qMax = Math.ceil((maxX / size - rOffset) / sqrt3) + 1;

    for (let q = qMin; q <= qMax; q++) {
      hexes.push({ q, r });
    }
  }

  return hexes;
}

/**
 * Calculate distance between two hex coordinates.
 * Uses cube coordinate conversion for accurate distance.
 */
export function hexDistance(a: HexCoordinate, b: HexCoordinate): number {
  const as = -a.q - a.r;
  const bs = -b.q - b.r;
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(as - bs));
}

/**
 * Hex neighbor offsets in axial coordinates.
 * Order: E, NE, NW, W, SW, SE (clockwise from east)
 */
export const HEX_NEIGHBORS: readonly HexCoordinate[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/**
 * Get all hexes at exactly a given distance from center.
 * Returns hexes in ring order, walking the perimeter clockwise.
 */
export function getHexRing(center: HexCoordinate, radius: number): HexCoordinate[] {
  if (radius === 0) return [center];

  const results: HexCoordinate[] = [];
  let hex = {
    q: center.q + HEX_NEIGHBORS[4].q * radius,
    r: center.r + HEX_NEIGHBORS[4].r * radius,
  };

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push({ ...hex });
      hex = {
        q: hex.q + HEX_NEIGHBORS[i].q,
        r: hex.r + HEX_NEIGHBORS[i].r,
      };
    }
  }

  return results;
}
