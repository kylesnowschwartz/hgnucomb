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
   * Request pan to center a hex on screen.
   * Only pans if hex is beyond threshold distance from current viewport center.
   * Sets pendingPan for HexGrid to consume.
   */
  panToHex: (hex: HexCoordinate, threshold?: number) => void;

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

  panToHex: (hex: HexCoordinate, threshold = 3) => {
    const { scale, position, hexSize, containerSize } = get();
    const { width, height } = containerSize;
    if (width === 0 || height === 0) return; // Not initialized yet

    // Calculate hex world position
    const worldPos = hexToPixel(hex, hexSize);

    // Calculate hex screen position (where it currently is)
    const screenX = worldPos.x * scale + position.x;
    const screenY = worldPos.y * scale + position.y;

    // Calculate distance from viewport center (in screen pixels)
    const centerX = width / 2;
    const centerY = height / 2;
    const distFromCenter = Math.sqrt(
      Math.pow(screenX - centerX, 2) + Math.pow(screenY - centerY, 2)
    );

    // Only pan if beyond threshold (threshold * hexSize pixels from center)
    const thresholdPixels = threshold * hexSize * scale;
    if (distFromCenter <= thresholdPixels) return;

    // Calculate target position to center hex on screen
    const targetX = centerX - worldPos.x * scale;
    const targetY = centerY - worldPos.y * scale;

    set({ pendingPan: { position: { x: targetX, y: targetY } } });
  },
}));
