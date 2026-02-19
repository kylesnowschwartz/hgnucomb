/**
 * Hex direction utilities.
 *
 * Maps HexDirection to neighbor offsets using the HEX_NEIGHBORS constant.
 */

import type { HexCoordinate } from '@shared/types';
import { HEX_NEIGHBORS } from '@shared/types';
import type { HexDirection } from './types';

/**
 * Direction to HEX_NEIGHBORS index mapping.
 * HEX_NEIGHBORS order: E(0), NE(1), NW(2), W(3), SW(4), SE(5)
 */
const DIRECTION_INDEX: Record<HexDirection, number> = {
  e: 0,
  ne: 1,
  nw: 2,
  w: 3,
  sw: 4,
  se: 5,
};

/**
 * Get neighbor hex in the specified direction.
 */
export function getNeighborInDirection(
  hex: HexCoordinate,
  direction: HexDirection
): HexCoordinate {
  // DIRECTION_INDEX maps all 6 HexDirection values to valid HEX_NEIGHBORS indices
  const offset = HEX_NEIGHBORS[DIRECTION_INDEX[direction]]!;
  return {
    q: hex.q + offset.q,
    r: hex.r + offset.r,
  };
}

/**
 * All directions for iteration.
 */
export const ALL_DIRECTIONS: readonly HexDirection[] = ['e', 'ne', 'nw', 'w', 'sw', 'se'];

/**
 * Get vertical zigzag direction based on current hex position.
 * Alternates NW/NE (up) or SW/SE (down) based on row (r) parity.
 * This keeps you in the same visual column when moving vertically.
 *
 * Based on offset coordinate conversion from Red Blob Games:
 * https://www.redblobgames.com/grids/hexagons/#coordinates-offset
 */
export function getVerticalDirection(
  hex: HexCoordinate,
  direction: 'up' | 'down'
): HexDirection {
  // Use r (row) parity to determine which diagonal keeps us in same visual column
  // Even rows: go "right-leaning" (NE/SE)
  // Odd rows: go "left-leaning" (NW/SW)
  const goRight = hex.r % 2 === 0;

  if (direction === 'up') {
    return goRight ? 'ne' : 'nw';
  } else {
    return goRight ? 'se' : 'sw';
  }
}
