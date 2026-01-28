/**
 * UI state store - panel visibility, selections, transient UI state.
 */

import { create } from 'zustand';
import type { HexCoordinate } from '@shared/types';

interface UIStore {
  // Currently selected agent (terminal panel open for this agent)
  selectedAgentId: string | null;
  selectAgent: (agentId: string | null) => void;

  // Currently hovered hex cell (for visual feedback, keyboard nav later)
  hoveredHex: HexCoordinate | null;
  setHoveredHex: (hex: HexCoordinate | null) => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  selectedAgentId: null,
  hoveredHex: null,

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
}));
