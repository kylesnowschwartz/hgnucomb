/**
 * Project store persistence — localStorage write subscription.
 *
 * Extracted from projectStore.ts so the store stays pure state logic.
 * The subscription activates on import (side effect).
 *
 * Note: loadFromStorage stays in projectStore.ts because the store needs
 * it at creation time — extracting it here would create a circular import.
 */

import { useProjectStore } from './projectStore';

const STORAGE_KEY = 'hgnucomb:projects';

/** Persist to localStorage (only currentProject and recentProjects) */
function persistToStorage(currentProject: string | null, recentProjects: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentProject, recentProjects }));
  } catch {
    // Persist failure is non-fatal — state lives in memory
  }
}

// Persist on state changes
useProjectStore.subscribe((state) => {
  persistToStorage(state.currentProject, state.recentProjects);
});
