import { describe, it, expect } from 'vitest';
import { getHexRing, hexDistance } from './types';

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
