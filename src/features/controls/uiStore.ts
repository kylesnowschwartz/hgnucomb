/**
 * UI state store - panel visibility, selections, transient UI state.
 *
 * Two selection states:
 * - selectedHex: current cell focus (set by mouse hover or keyboard nav)
 * - selectedAgentId: agent with panel open (pink border)
 */

import { create } from 'zustand';
import type { HexCoordinate } from '@shared/types';
import type { InputMode } from '@features/keyboard/types';

interface UIStore {
  // Currently selected agent (terminal panel open for this agent)
  selectedAgentId: string | null;
  selectAgent: (agentId: string | null) => void;

  // Currently selected hex cell (mouse hover or keyboard nav)
  selectedHex: HexCoordinate | null;
  selectHex: (hex: HexCoordinate | null) => void;
  clearSelection: () => void;

  // Derived input mode from state
  getMode: () => InputMode;
}

export const useUIStore = create<UIStore>()((set) => ({
  selectedAgentId: null,
  selectedHex: null,

  selectAgent: (agentId) => {
    set({ selectedAgentId: agentId });
    if (agentId) {
      console.log('[UIStore] Selected agent:', agentId);
    } else {
      console.log('[UIStore] Deselected agent');
    }
  },

  selectHex: (hex) => {
    set({ selectedHex: hex });
  },

  clearSelection: () => {
    set({ selectedHex: null });
  },

  getMode: () => {
    const state = useUIStore.getState();
    if (state.selectedAgentId) return 'terminal';
    if (state.selectedHex) return 'selected';
    return 'grid';
  },
}));
