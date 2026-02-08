/**
 * UI state store - panel visibility, selections, transient UI state.
 *
 * Three selection states:
 * - hoveredHex: transient, follows mouse movement over hex cells
 * - selectedHex: sticky, set by click or keyboard navigation (intentional user action)
 * - selectedAgentId: agent with terminal panel open
 *
 * Kill confirmation is a mode flag, not a coordinate - the target is always selectedHex.
 */

import { create } from 'zustand';
import type { HexCoordinate } from '@shared/types';
import type { InputMode } from '@features/keyboard/types';

interface UIStore {
  // Currently selected agent (terminal panel open for this agent)
  selectedAgentId: string | null;
  selectAgent: (agentId: string | null) => void;

  // Hex under the mouse cursor (transient, visual feedback only)
  hoveredHex: HexCoordinate | null;
  setHoveredHex: (hex: HexCoordinate | null) => void;

  // Intentionally selected hex (click or keyboard nav - sticks until changed)
  selectedHex: HexCoordinate | null;
  selectHex: (hex: HexCoordinate | null) => void;
  clearSelection: () => void;

  // Kill confirmation mode (true = waiting for confirm/cancel, target is selectedHex)
  killConfirmationActive: boolean;
  setKillConfirmationActive: (active: boolean) => void;

  // MetaPanel (right-side collapsible panel)
  metaPanelOpen: boolean;
  toggleMetaPanel: () => void;

  // Derived input mode from state
  getMode: () => InputMode;
}

export const useUIStore = create<UIStore>()((set) => ({
  selectedAgentId: null,
  hoveredHex: null,
  selectedHex: null,
  killConfirmationActive: false,
  metaPanelOpen: true,

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
  },

  clearSelection: () => {
    set({ selectedHex: null, hoveredHex: null });
  },

  setKillConfirmationActive: (active) => {
    set({ killConfirmationActive: active });
  },

  toggleMetaPanel: () => {
    set((s) => ({ metaPanelOpen: !s.metaPanelOpen }));
  },

  getMode: () => {
    const state = useUIStore.getState();
    if (state.selectedAgentId) return 'terminal';
    if (state.selectedHex) return 'selected';
    return 'grid';
  },
}));
