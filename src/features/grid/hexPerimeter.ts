/**
 * Hex perimeter computation for family visual grouping.
 *
 * Computes which hex edges are on the perimeter of a group so that
 * internal edges can be suppressed ("mush together") and perimeter
 * edges drawn as a styled border.
 *
 * Algorithm: For each hex in a group, check all 6 edges. An edge is
 * "perimeter" if the neighbor across it is NOT in the group. O(n * 6).
 */

import type { CellType } from '@shared/types';
import { HEX_NEIGHBORS, hexToPixel } from '@shared/types';
import type { AgentState } from '@features/agents/agentStore';

// ============================================================================
// Types
// ============================================================================

/** A single edge segment with pixel coordinates */
export interface EdgeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A family group: orchestrator + its direct workers */
export interface FamilyGroup {
  /** Root orchestrator agent ID */
  rootId: string;
  /** Root agent's cell type (for perimeter color) */
  rootCellType: CellType;
  /** "q,r" keys of all member hex positions */
  memberHexes: Set<string>;
  /** Computed perimeter edge segments in pixel coordinates */
  perimeterEdges: EdgeSegment[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maps hex edge index (0-5) to HEX_NEIGHBORS index.
 *
 * For a pointy-top hexagon (Konva RegularPolygon, sides=6, no rotation):
 *   Vertices go clockwise from top: V0(top), V1(top-right), V2(bottom-right),
 *   V3(bottom), V4(bottom-left), V5(top-left).
 *
 *   Edge 0 (V0->V1, upper-right) faces NE neighbor (HEX_NEIGHBORS[1])
 *   Edge 1 (V1->V2, right)       faces E  neighbor (HEX_NEIGHBORS[0])
 *   Edge 2 (V2->V3, lower-right) faces SE neighbor (HEX_NEIGHBORS[5])
 *   Edge 3 (V3->V4, lower-left)  faces SW neighbor (HEX_NEIGHBORS[4])
 *   Edge 4 (V4->V5, left)        faces W  neighbor (HEX_NEIGHBORS[3])
 *   Edge 5 (V5->V0, upper-left)  faces NW neighbor (HEX_NEIGHBORS[2])
 */
const EDGE_TO_NEIGHBOR: readonly number[] = [1, 0, 5, 4, 3, 2];

// ============================================================================
// Vertex Computation
// ============================================================================

/**
 * Compute pixel position of a hex vertex.
 * Matches Konva RegularPolygon vertex ordering (V0=top, clockwise).
 */
function hexVertex(
  cx: number,
  cy: number,
  size: number,
  vertexIndex: number,
): { x: number; y: number } {
  const angle = (vertexIndex * Math.PI * 2) / 6 - Math.PI / 2;
  return {
    x: cx + size * Math.cos(angle),
    y: cy + size * Math.sin(angle),
  };
}

// ============================================================================
// Perimeter Computation
// ============================================================================

/**
 * Compute perimeter edge segments for a set of hex coordinates.
 *
 * For each hex in the set, checks all 6 edges. An edge is "perimeter"
 * if the neighbor across it is NOT in the set.
 */
export function computePerimeterEdges(
  memberHexes: Set<string>,
  hexSize: number,
): EdgeSegment[] {
  const edges: EdgeSegment[] = [];

  for (const key of memberHexes) {
    const [q, r] = key.split(',').map(Number);
    const { x: cx, y: cy } = hexToPixel({ q, r }, hexSize);

    for (let edgeIdx = 0; edgeIdx < 6; edgeIdx++) {
      const neighborDir = EDGE_TO_NEIGHBOR[edgeIdx];
      const neighbor = HEX_NEIGHBORS[neighborDir];
      const neighborKey = `${q + neighbor.q},${r + neighbor.r}`;

      if (!memberHexes.has(neighborKey)) {
        const v1 = hexVertex(cx, cy, hexSize, edgeIdx);
        const v2 = hexVertex(cx, cy, hexSize, (edgeIdx + 1) % 6);
        edges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y });
      }
    }
  }

  return edges;
}

// ============================================================================
// Family Grouping
// ============================================================================

/**
 * Group agents into families by parent-child relationships.
 * A family = orchestrator + all direct workers it spawned.
 *
 * Returns Map<rootAgentId, FamilyGroup> with pre-computed perimeter edges.
 * Single-member families (orchestrator with no workers) are excluded since
 * there are no internal edges to suppress.
 */
export function computeFamilyGroups(
  agents: AgentState[],
  hexSize: number,
): Map<string, FamilyGroup> {
  const families = new Map<string, FamilyGroup>();

  // First pass: collect worker hexes into parent's family
  for (const agent of agents) {
    if (!agent.parentId) continue;

    const familyId = agent.parentId;
    if (!families.has(familyId)) {
      families.set(familyId, {
        rootId: familyId,
        rootCellType: 'orchestrator', // Default, overwritten when root found
        memberHexes: new Set(),
        perimeterEdges: [],
      });
    }
    families.get(familyId)!.memberHexes.add(`${agent.hex.q},${agent.hex.r}`);
  }

  // Second pass: add parent hexes and capture their cell type
  for (const agent of agents) {
    const group = families.get(agent.id);
    if (group) {
      group.memberHexes.add(`${agent.hex.q},${agent.hex.r}`);
      group.rootCellType = agent.cellType;
    }
  }

  // Third pass: compute perimeter edges for multi-member families
  for (const [familyId, group] of families) {
    if (group.memberHexes.size < 2) {
      families.delete(familyId); // Single-member: nothing to merge
      continue;
    }
    group.perimeterEdges = computePerimeterEdges(group.memberHexes, hexSize);
  }

  return families;
}

/**
 * Build a lookup from hex key ("q,r") to the FamilyGroup it belongs to.
 * Only includes hexes that are in multi-member families (2+ members).
 */
export function buildFamilyLookup(
  familyGroups: Map<string, FamilyGroup>,
): Map<string, FamilyGroup> {
  const lookup = new Map<string, FamilyGroup>();
  for (const group of familyGroups.values()) {
    for (const hexKey of group.memberHexes) {
      lookup.set(hexKey, group);
    }
  }
  return lookup;
}
