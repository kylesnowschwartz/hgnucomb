/**
 * Viewport store - shared state for grid pan/zoom.
 *
 * Allows components outside HexGrid (like ActionBar) to know
 * viewport position for screen coordinate calculations.
 */

import { create } from 'zustand';

interface ViewportStore {
  scale: number;
  position: { x: number; y: number };
  hexSize: number;

  setScale: (scale: number) => void;
  setPosition: (position: { x: number; y: number }) => void;
  setHexSize: (size: number) => void;

  /** Update both scale and position atomically */
  setViewport: (scale: number, position: { x: number; y: number }) => void;
}

export const useViewportStore = create<ViewportStore>()((set) => ({
  scale: 1,
  position: { x: 0, y: 0 },
  hexSize: 40,

  setScale: (scale) => set({ scale }),
  setPosition: (position) => set({ position }),
  setHexSize: (hexSize) => set({ hexSize }),

  setViewport: (scale, position) => set({ scale, position }),
}));
