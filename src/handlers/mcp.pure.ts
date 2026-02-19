/**
 * Pure functions for MCP request handling.
 *
 * No side effects, no store imports. Safe for agent review and unit testing.
 */

import type { HexCoordinate } from '@shared/types';
import { getHexRing } from '@shared/types';

/**
 * Find nearest empty hex to a given position using ring expansion.
 * Searches distance 1, then 2, etc. until an empty hex is found.
 *
 * Accepts any array of objects with a `hex` field, so callers don't
 * need to import AgentState (which lives in a Zustand store module).
 */
export function findNearestEmptyHex(
  center: HexCoordinate,
  agents: ReadonlyArray<{ hex: HexCoordinate }>
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
