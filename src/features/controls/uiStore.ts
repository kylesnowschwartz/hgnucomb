/**
 * UI state store - panel visibility, selections, transient UI state.
 *
 * Three independent selection states:
 * - hoveredHex: transient, follows mouse
 * - selectedHex: persistent cell focus (yellow border)
 * - selectedAgentId: agent with panel open (pink border)
 */

import { create } from 'zustand';
import type { HexCoordinate } from '@shared/types';

interface UIStore {
  // Currently selected agent (terminal panel open for this agent)
  selectedAgentId: string | null;
  selectAgent: (agentId: string | null) => void;

  // Currently hovered hex cell (for visual feedback)
  hoveredHex: HexCoordinate | null;
  setHoveredHex: (hex: HexCoordinate | null) => void;

  // Currently focused/selected hex cell (persistent until cleared)
  selectedHex: HexCoordinate | null;
  selectHex: (hex: HexCoordinate | null) => void;
  clearSelection: () => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  selectedAgentId: null,
  hoveredHex: null,
  selectedHex: null,

  selectAgent: (agentId) => {
    set({ selectedAgentId: agentId });
    if (agentId) {
      console.log('[UIStore] Selected agent:', agentId);
    } else {
      console.log('[UIStore] Deselected agent');
    }
  },

  setHoveredHex: (hex) => {
    set({ hoveredHex: hex });
  },

  selectHex: (hex) => {
    set({ selectedHex: hex });
    if (hex) {
      console.log('[UIStore] Selected hex:', hex.q, hex.r);
    }
  },

  clearSelection: () => {
    set({ selectedHex: null });
  },
}));
