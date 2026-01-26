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
