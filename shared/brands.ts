/**
 * Branded types for coordinate systems.
 *
 * Prevents mixing hex coordinates with pixel coordinates at compile time.
 * Zero runtime cost -- brands erase during compilation.
 */

declare const HexBrand: unique symbol;
declare const PixelBrand: unique symbol;

/** Branded hex axial coordinate. Use hex() to construct. */
export type HexCoord = { readonly q: number; readonly r: number } & {
  readonly [HexBrand]: true;
};

/** Branded pixel coordinate. Use pixel() to construct. */
export type PixelCoord = { readonly x: number; readonly y: number } & {
  readonly [PixelBrand]: true;
};

/** Construct a branded hex coordinate. */
export function hex(q: number, r: number): HexCoord {
  return { q, r } as HexCoord;
}

/** Construct a branded pixel coordinate. */
export function pixel(x: number, y: number): PixelCoord {
  return { x, y } as PixelCoord;
}
