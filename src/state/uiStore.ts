/**
 * UI state store - panel visibility, selections, transient UI state.
 */

import { create } from 'zustand';

interface UIStore {
  // Currently selected agent (terminal panel open for this agent)
  selectedAgentId: string | null;
  selectAgent: (agentId: string | null) => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  selectedAgentId: null,

  selectAgent: (agentId) => {
    set({ selectedAgentId: agentId });
    if (agentId) {
      console.log('[UIStore] Selected agent:', agentId);
    } else {
      console.log('[UIStore] Deselected agent');
    }
  },
}));
