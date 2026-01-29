/**
 * Viewport store - shared state for grid pan/zoom.
 *
 * Allows components outside HexGrid (like ActionBar) to know
 * viewport position for screen coordinate calculations.
 * Also enables external viewport control (e.g., keyboard navigation centering).
 */

import { create } from 'zustand';
import { type HexCoordinate, hexToPixel } from '@shared/types';

interface PendingPan {
  position: { x: number; y: number };
}

interface ViewportStore {
  scale: number;
  position: { x: number; y: number };
  hexSize: number;
  containerSize: { width: number; height: number };

  /** Pending pan request from external source (e.g., keyboard nav) */
  pendingPan: PendingPan | null;

  setScale: (scale: number) => void;
  setPosition: (position: { x: number; y: number }) => void;
  setHexSize: (size: number) => void;
  setContainerSize: (size: { width: number; height: number }) => void;

  /** Update both scale and position atomically */
  setViewport: (scale: number, position: { x: number; y: number }) => void;

  /**
   * Request pan to keep a hex visible on screen.
   * Only pans when hex is near viewport edge (within 1 hex margin).
   * Nudges by 2 hex widths instead of recentering.
   * Sets pendingPan for HexGrid to consume.
   */
  panToHex: (hex: HexCoordinate) => void;

  /**
   * Force-center viewport on a hex (e.g., for 'g' go-to-origin).
   * Always pans to center the hex on screen.
   */
  centerOnHex: (hex: HexCoordinate) => void;

  /** Clear pending pan (called by HexGrid after applying) */
  clearPendingPan: () => void;
}

export const useViewportStore = create<ViewportStore>()((set, get) => ({
  scale: 1,
  position: { x: 0, y: 0 },
  hexSize: 40,
  containerSize: { width: 0, height: 0 },
  pendingPan: null,

  setScale: (scale) => set({ scale }),
  setPosition: (position) => set({ position }),
  setHexSize: (hexSize) => set({ hexSize }),
  setContainerSize: (containerSize) => set({ containerSize }),
  clearPendingPan: () => set({ pendingPan: null }),

  setViewport: (scale, position) => set({ scale, position }),

  panToHex: (hex: HexCoordinate) => {
    const { scale, position, hexSize, containerSize } = get();
    const { width, height } = containerSize;
    if (width === 0 || height === 0) return; // Not initialized yet

    // Calculate hex world position and screen position
    const worldPos = hexToPixel(hex, hexSize);
    const screenX = worldPos.x * scale + position.x;
    const screenY = worldPos.y * scale + position.y;

    // Edge margin: 1 hex from edge triggers pan
    const margin = hexSize * scale;
    // Nudge amount: 2 hex widths
    const nudge = hexSize * scale * 2;

    let newX = position.x;
    let newY = position.y;

    // Check edges and nudge (don't recenter, just nudge enough to keep visible)
    if (screenX < margin) newX += nudge;
    else if (screenX > width - margin) newX -= nudge;

    if (screenY < margin) newY += nudge;
    else if (screenY > height - margin) newY -= nudge;

    // Only update if changed
    if (newX !== position.x || newY !== position.y) {
      set({ pendingPan: { position: { x: newX, y: newY } } });
    }
  },

  centerOnHex: (hex: HexCoordinate) => {
    const { scale, hexSize, containerSize } = get();
    const { width, height } = containerSize;
    if (width === 0 || height === 0) return;

    const worldPos = hexToPixel(hex, hexSize);
    const targetX = width / 2 - worldPos.x * scale;
    const targetY = height / 2 - worldPos.y * scale;

    set({ pendingPan: { position: { x: targetX, y: targetY } } });
  },
}));
