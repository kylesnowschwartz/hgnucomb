/**
 * Keymap registry.
 */

import type { Keymap } from '../types';
import { vimKeymap } from './vim';
import { arrowsKeymap } from './arrows';

export const KEYMAPS: Record<string, Keymap> = {
  vim: vimKeymap,
  arrows: arrowsKeymap,
};

export const DEFAULT_KEYMAP_ID = 'vim';
