/**
 * Agent store persistence — localStorage read/write + subscription.
 *
 * Extracted from agentStore.ts so the store stays pure state logic.
 * Import this module from any entry point that needs persistence
 * (the subscription activates on import via side effect).
 */

import { useAgentStore, type AgentState } from './agentStore';

const STORAGE_KEY = 'hgnucomb:agents';

/**
 * Serialize agent state to localStorage.
 * Called automatically on state changes via subscription.
 */
function persistToLocalStorage(agents: Map<string, AgentState>): void {
  try {
    const data = Array.from(agents.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Persist failure is non-fatal — state lives in memory
  }
}

/**
 * Load agent state from localStorage.
 * Called by reconnect flow to get cached state (server is still source of truth).
 */
export function loadAgentsFromLocalStorage(): AgentState[] {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return [];
    return JSON.parse(json) as AgentState[];
  } catch {
    return [];
  }
}

/**
 * Clear persisted agent state from localStorage.
 * Called on session clear.
 */
export function clearAgentsFromLocalStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Clear failure is non-fatal
  }
}

// Subscribe to state changes and persist (debounced to avoid blocking the main
// thread with synchronous JSON.stringify during high-frequency updates like
// agent activity broadcasts and terminal data processing)
let persistTimer: ReturnType<typeof setTimeout> | null = null;
useAgentStore.subscribe((state) => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistToLocalStorage(state.agents);
  }, 2000);
});
