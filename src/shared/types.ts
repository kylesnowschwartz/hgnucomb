/**
 * Axial coordinate system for hexagonal grids.
 * Uses the "pointy-top" orientation where q is column and r is row.
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */
export interface HexCoordinate {
  /** Column position in axial coordinates */
  q: number;
  /** Row position in axial coordinates */
  r: number;
}

/**
 * Convert hex axial coordinates to pixel position.
 * Uses pointy-top orientation.
 *
 * @param hex - The hex coordinate to convert
 * @param size - The radius of the hexagon in pixels
 * @returns Pixel position {x, y} for the hex center
 */
export function hexToPixel(hex: HexCoordinate, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * hex.q + (Math.sqrt(3) / 2) * hex.r);
  const y = size * ((3 / 2) * hex.r);
  return { x, y };
}

/**
 * Convert pixel position to hex axial coordinates.
 * Uses pointy-top orientation. Returns rounded coordinates.
 *
 * @param x - Pixel x position
 * @param y - Pixel y position
 * @param size - The radius of the hexagon in pixels
 * @returns Rounded hex coordinate
 */
export function pixelToHex(x: number, y: number, size: number): HexCoordinate {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return { q: Math.round(q), r: Math.round(r) };
}

/**
 * Generate hex coordinates within a given radius from origin.
 * Uses axial coordinate distance formula.
 *
 * @param radius - Maximum distance from origin (0,0)
 * @returns Array of hex coordinates within the radius
 */
export function hexesInRange(radius: number): HexCoordinate[] {
  const hexes: HexCoordinate[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.push({ q, r });
    }
  }
  return hexes;
}

/**
 * Generate hex coordinates within a rectangular pixel region.
 * Used for viewport culling - only render hexes visible on screen.
 *
 * In axial coordinates, a rectangular (q,r) range produces a parallelogram
 * in pixel space. To cover a rectangular viewport, we must vary the q range
 * based on r to compensate for the diagonal offset.
 *
 * @param minX - Left edge in world pixels
 * @param maxX - Right edge in world pixels
 * @param minY - Top edge in world pixels
 * @param maxY - Bottom edge in world pixels
 * @param size - Hex radius in pixels
 * @returns Array of hex coordinates within the rectangle
 */
export function hexesInRect(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  size: number
): HexCoordinate[] {
  const hexes: HexCoordinate[] = [];

  // Calculate r range from y bounds (r controls vertical position)
  const rMin = Math.floor(minY / (size * 1.5)) - 1;
  const rMax = Math.ceil(maxY / (size * 1.5)) + 1;

  const sqrt3 = Math.sqrt(3);

  for (let r = rMin; r <= rMax; r++) {
    // For each row, calculate the q range needed to cover x bounds
    // x = size * (sqrt(3) * q + sqrt(3)/2 * r)
    // Solving for q: q = (x / size - sqrt(3)/2 * r) / sqrt(3)
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
 *
 * @param a - First hex coordinate
 * @param b - Second hex coordinate
 * @returns Integer distance (number of hex steps)
 */
export function hexDistance(a: HexCoordinate, b: HexCoordinate): number {
  // Convert axial to cube: s = -q - r
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
 *
 * Algorithm: Start at a corner (radius steps in direction 4 from center),
 * then walk the perimeter by taking radius steps in each of the 6 directions.
 * Reference: https://www.redblobgames.com/grids/hexagons/#rings
 *
 * @param center - Center hex coordinate
 * @param radius - Distance from center (must be >= 0)
 * @returns Array of hex coordinates forming the ring (6*radius hexes)
 */
export function getHexRing(center: HexCoordinate, radius: number): HexCoordinate[] {
  if (radius === 0) return [center];

  const results: HexCoordinate[] = [];

  // Start at corner: go radius steps in direction 4 (SW)
  let hex = {
    q: center.q + HEX_NEIGHBORS[4].q * radius,
    r: center.r + HEX_NEIGHBORS[4].r * radius,
  };

  // Walk the perimeter: radius steps in each of 6 directions
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
