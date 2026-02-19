/**
 * Project directory state management.
 *
 * Tracks which project directory agents should work in.
 * Decoupled from hgnucomb's own directory (TOOL_DIR).
 *
 * Server sends its default on connect via server.info message.
 * User can override by selecting a different project in the ProjectBar.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'hgnucomb:projects';
const MAX_RECENTS = 10;

interface ValidationResult {
  exists: boolean;
  isGitRepo: boolean;
}

interface ProjectStore {
  /** User-selected project directory (overrides serverDefault) */
  currentProject: string | null;
  /** Most-recently-used project directories */
  recentProjects: string[];
  /** Default from server.info message (where the server is running) */
  serverDefault: string | null;
  /** Cached validation results keyed by resolved path */
  validationCache: Map<string, ValidationResult>;

  /** The project directory that should actually be used */
  effectiveProject: () => string | null;

  /** Set the active project directory */
  setProject: (path: string) => void;
  /** Set the server default (called on server.info) */
  setServerDefault: (path: string) => void;
  /** Remove a path from recents */
  removeFromRecents: (path: string) => void;
  /** Cache a validation result */
  cacheValidation: (path: string, result: ValidationResult) => void;
  /** Get cached validation for a path */
  getValidation: (path: string) => ValidationResult | undefined;
}

/** Load persisted state from localStorage */
function loadFromStorage(): { currentProject: string | null; recentProjects: string[] } {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return { currentProject: null, recentProjects: [] };
    const data = JSON.parse(json);
    return {
      currentProject: data.currentProject ?? null,
      recentProjects: Array.isArray(data.recentProjects) ? data.recentProjects : [],
    };
  } catch {
    return { currentProject: null, recentProjects: [] };
  }
}

const initial = loadFromStorage();

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  currentProject: initial.currentProject,
  recentProjects: initial.recentProjects,
  serverDefault: null,
  validationCache: new Map(),

  effectiveProject: () => {
    const { currentProject, serverDefault } = get();
    return currentProject ?? serverDefault ?? null;
  },

  setProject: (path) => {
    set((s) => {
      // Add to front of recents, deduplicate, cap at MAX_RECENTS
      const recents = [path, ...s.recentProjects.filter((p) => p !== path)].slice(0, MAX_RECENTS);
      return { currentProject: path, recentProjects: recents };
    });
  },

  setServerDefault: (path) => {
    set({ serverDefault: path });
  },

  removeFromRecents: (path) => {
    set((s) => ({
      recentProjects: s.recentProjects.filter((p) => p !== path),
      // If removing the current project, clear selection
      currentProject: s.currentProject === path ? null : s.currentProject,
    }));
  },

  cacheValidation: (path, result) => {
    set((s) => {
      const next = new Map(s.validationCache);
      next.set(path, result);
      return { validationCache: next };
    });
  },

  getValidation: (path) => {
    return get().validationCache.get(path);
  },
}));
