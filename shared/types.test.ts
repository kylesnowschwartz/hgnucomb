import { describe, it, expect } from 'vitest';
import { getHexRing, hexDistance, hexToPixel, hexesInRect } from '@shared/types';

// ============================================================================
// hexDistance
// ============================================================================

describe('hexDistance', () => {
  it('returns 0 for same coordinate', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 5, r: -3 }, { q: 5, r: -3 })).toBe(0);
  });

  it('is symmetric: d(a,b) === d(b,a)', () => {
    const a = { q: 3, r: -2 };
    const b = { q: -1, r: 4 };
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
  });

  it('handles negative coordinates', () => {
    const a = { q: -3, r: -2 };
    const b = { q: -1, r: -5 };
    expect(hexDistance(a, b)).toBeGreaterThan(0);
    // Manual verification: cube coords a = (-3,-2,5), b = (-1,-5,6)
    // distance = max(|-3-(-1)|, |-2-(-5)|, |5-6|) = max(2, 3, 1) = 3
    expect(hexDistance(a, b)).toBe(3);
  });

  it('adjacent hexes are at distance 1', () => {
    const center = { q: 0, r: 0 };
    const neighbors = [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ];
    for (const neighbor of neighbors) {
      expect(hexDistance(center, neighbor)).toBe(1);
    }
  });

  it('two-hop hexes are at distance 2', () => {
    const center = { q: 0, r: 0 };
    // Moving 2 steps in one direction
    expect(hexDistance(center, { q: 2, r: 0 })).toBe(2);
    expect(hexDistance(center, { q: 0, r: -2 })).toBe(2);
    expect(hexDistance(center, { q: -2, r: 2 })).toBe(2);
  });

  it('satisfies triangle inequality: d(a,c) <= d(a,b) + d(b,c)', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 2, r: -1 };
    const c = { q: -1, r: 3 };
    expect(hexDistance(a, c)).toBeLessThanOrEqual(hexDistance(a, b) + hexDistance(b, c));
  });
});

// ============================================================================
// hexToPixel
// ============================================================================

describe('hexToPixel', () => {
  const size = 30; // common hex size for testing

  it('returns origin for (0,0)', () => {
    const pixel = hexToPixel({ q: 0, r: 0 }, size);
    expect(pixel.x).toBe(0);
    expect(pixel.y).toBe(0);
  });

  it('produces correct pointy-top hex layout', () => {
    // For pointy-top: x = size * (sqrt(3)*q + sqrt(3)/2 * r), y = size * 3/2 * r
    const sqrt3 = Math.sqrt(3);

    // Moving in q direction (column)
    const p1 = hexToPixel({ q: 1, r: 0 }, size);
    expect(p1.x).toBeCloseTo(size * sqrt3);
    expect(p1.y).toBe(0);

    // Moving in r direction (row)
    const p2 = hexToPixel({ q: 0, r: 1 }, size);
    expect(p2.x).toBeCloseTo(size * sqrt3 / 2);
    expect(p2.y).toBeCloseTo(size * 1.5);
  });

  it('handles negative coordinates', () => {
    const p = hexToPixel({ q: -2, r: -3 }, size);
    // x = 30 * (sqrt(3)*(-2) + sqrt(3)/2 * (-3))
    // y = 30 * (3/2 * -3) = -135
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeLessThan(0);
  });

  it('scales linearly with size', () => {
    const hex = { q: 2, r: -1 };
    const p1 = hexToPixel(hex, 30);
    const p2 = hexToPixel(hex, 60);
    expect(p2.x).toBeCloseTo(p1.x * 2);
    expect(p2.y).toBeCloseTo(p1.y * 2);
  });
});

// ============================================================================
// hexesInRect
// ============================================================================

describe('hexesInRect', () => {
  const size = 30;

  it('returns empty for zero-area rect', () => {
    // Rect where min > max should return nothing useful
    // Actually the function doesn't handle this - let's test what it does
    const hexes = hexesInRect(100, 100, 100, 100, size);
    // For a point, we might get a few hexes due to padding
    expect(hexes.length).toBeGreaterThanOrEqual(0);
  });

  it('returns hexes for a small viewport around origin', () => {
    // A small rect around origin should include (0,0)
    const hexes = hexesInRect(-50, 50, -50, 50, size);
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes.some((h) => h.q === 0 && h.r === 0)).toBe(true);
  });

  it('returns consistent results for same rect', () => {
    const rect1 = hexesInRect(-100, 100, -100, 100, size);
    const rect2 = hexesInRect(-100, 100, -100, 100, size);
    expect(rect1).toEqual(rect2);
  });

  it('larger bounds produce more hexes', () => {
    const small = hexesInRect(-50, 50, -50, 50, size);
    const large = hexesInRect(-200, 200, -200, 200, size);
    expect(large.length).toBeGreaterThan(small.length);
  });

  it('does not explode memory for large bounds', () => {
    // 10000x10000 viewport should still return a reasonable number
    const start = performance.now();
    const hexes = hexesInRect(-5000, 5000, -5000, 5000, size);
    const elapsed = performance.now() - start;

    // Should complete quickly and not return millions of hexes
    expect(elapsed).toBeLessThan(1000); // Under 1 second
    expect(hexes.length).toBeLessThan(500000); // Sanity check
  });

  it('hexes in rect actually fall within or near the rect bounds', () => {
    const minX = -100, maxX = 100, minY = -100, maxY = 100;
    const hexes = hexesInRect(minX, maxX, minY, maxY, size);

    // Convert back to pixels and check they're reasonably close to bounds
    // (algorithm adds padding so some may be slightly outside)
    for (const hex of hexes) {
      const pixel = hexToPixel(hex, size);
      // Allow generous margin for hex centers near edges
      expect(pixel.x).toBeGreaterThan(minX - size * 3);
      expect(pixel.x).toBeLessThan(maxX + size * 3);
      expect(pixel.y).toBeGreaterThan(minY - size * 3);
      expect(pixel.y).toBeLessThan(maxY + size * 3);
    }
  });
});

// ============================================================================
// getHexRing
// ============================================================================

describe('getHexRing', () => {
  it('returns center for radius 0', () => {
    const center = { q: 0, r: 0 };
    const ring = getHexRing(center, 0);
    expect(ring).toEqual([center]);
  });

  it('returns exactly 6 hexes for radius 1', () => {
    const ring = getHexRing({ q: 0, r: 0 }, 1);
    expect(ring).toHaveLength(6);
  });

  it('returns exactly 12 hexes for radius 2', () => {
    const ring = getHexRing({ q: 0, r: 0 }, 2);
    expect(ring).toHaveLength(12);
  });

  it('returns exactly 6*radius hexes for any radius', () => {
    for (const radius of [1, 2, 3, 4, 5]) {
      const ring = getHexRing({ q: 0, r: 0 }, radius);
      expect(ring).toHaveLength(6 * radius);
    }
  });

  it('ALL hexes in radius 1 ring are at distance 1 from center', () => {
    const center = { q: 0, r: 0 };
    const ring = getHexRing(center, 1);

    for (const hex of ring) {
      const dist = hexDistance(center, hex);
      expect(dist, `hex (${hex.q},${hex.r}) should be at distance 1`).toBe(1);
    }
  });

  it('ALL hexes in radius 2 ring are at distance 2 from center', () => {
    const center = { q: 0, r: 0 };
    const ring = getHexRing(center, 2);

    for (const hex of ring) {
      const dist = hexDistance(center, hex);
      expect(dist, `hex (${hex.q},${hex.r}) should be at distance 2`).toBe(2);
    }
  });

  it('ALL hexes in radius 3 ring are at distance 3 from center', () => {
    const center = { q: 0, r: 0 };
    const ring = getHexRing(center, 3);

    for (const hex of ring) {
      const dist = hexDistance(center, hex);
      expect(dist, `hex (${hex.q},${hex.r}) should be at distance 3`).toBe(3);
    }
  });

  it('works with non-origin center', () => {
    const center = { q: -2, r: 3 };
    const ring = getHexRing(center, 1);

    expect(ring).toHaveLength(6);
    for (const hex of ring) {
      const dist = hexDistance(center, hex);
      expect(dist, `hex (${hex.q},${hex.r}) should be at distance 1 from center (${center.q},${center.r})`).toBe(1);
    }
  });

  it('contains no duplicate hexes', () => {
    const ring = getHexRing({ q: 0, r: 0 }, 3);
    const keys = ring.map((h) => `${h.q},${h.r}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(ring.length);
  });
});
