/**
 * Keyboard store - active keymap with localStorage persistence.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Keymap } from './types';
import { KEYMAPS, DEFAULT_KEYMAP_ID } from './keymaps';

interface KeyboardStore {
  activeKeymapId: string;
  setActiveKeymap: (id: string) => void;
  getActiveKeymap: () => Keymap;
  getAvailableKeymaps: () => Keymap[];
}

export const useKeyboardStore = create<KeyboardStore>()(
  persist(
    (set, get) => ({
      activeKeymapId: DEFAULT_KEYMAP_ID,

      setActiveKeymap: (id: string) => {
        if (KEYMAPS[id]) {
          set({ activeKeymapId: id });
        }
      },

      getActiveKeymap: () => {
        const { activeKeymapId } = get();
        // DEFAULT_KEYMAP_ID is a key in KEYMAPS, so fallback is always defined
        return KEYMAPS[activeKeymapId] ?? KEYMAPS[DEFAULT_KEYMAP_ID]!;
      },

      getAvailableKeymaps: () => Object.values(KEYMAPS),
    }),
    {
      name: 'hgnucomb:keyboard:active-keymap',
      partialize: (state) => ({ activeKeymapId: state.activeKeymapId }),
    }
  )
);
