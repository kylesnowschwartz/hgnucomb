import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from './projectStore';
import './projectPersistence'; // Activate persistence subscription

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

// Suppress console logs during tests
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('projectStore', () => {
  beforeEach(() => {
    // Reset to clean state
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [],
      serverDefault: null,
      validationCache: new Map(),
    });
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // effectiveProject - the priority logic is the critical path
  // ==========================================================================

  describe('effectiveProject', () => {
    it('returns null when nothing is set', () => {
      expect(useProjectStore.getState().effectiveProject()).toBeNull();
    });

    it('returns serverDefault when no currentProject', () => {
      useProjectStore.getState().setServerDefault('/srv/hgnucomb');
      expect(useProjectStore.getState().effectiveProject()).toBe('/srv/hgnucomb');
    });

    it('returns currentProject over serverDefault', () => {
      useProjectStore.getState().setServerDefault('/srv/hgnucomb');
      useProjectStore.getState().setProject('/home/kyle/my-saas');
      expect(useProjectStore.getState().effectiveProject()).toBe('/home/kyle/my-saas');
    });

    it('falls back to serverDefault when currentProject is removed', () => {
      useProjectStore.getState().setServerDefault('/srv/hgnucomb');
      useProjectStore.getState().setProject('/home/kyle/my-saas');
      useProjectStore.getState().removeFromRecents('/home/kyle/my-saas');
      expect(useProjectStore.getState().effectiveProject()).toBe('/srv/hgnucomb');
    });
  });

  // ==========================================================================
  // setProject
  // ==========================================================================

  describe('setProject', () => {
    it('sets currentProject', () => {
      useProjectStore.getState().setProject('/home/kyle/project-a');
      expect(useProjectStore.getState().currentProject).toBe('/home/kyle/project-a');
    });

    it('adds to front of recentProjects', () => {
      useProjectStore.getState().setProject('/a');
      useProjectStore.getState().setProject('/b');
      expect(useProjectStore.getState().recentProjects).toEqual(['/b', '/a']);
    });

    it('deduplicates when selecting an existing recent', () => {
      useProjectStore.getState().setProject('/a');
      useProjectStore.getState().setProject('/b');
      useProjectStore.getState().setProject('/a');
      expect(useProjectStore.getState().recentProjects).toEqual(['/a', '/b']);
    });

    it('caps recents at 10 entries', () => {
      for (let i = 0; i < 15; i++) {
        useProjectStore.getState().setProject(`/project-${i}`);
      }
      expect(useProjectStore.getState().recentProjects).toHaveLength(10);
      // Most recent should be first
      expect(useProjectStore.getState().recentProjects[0]).toBe('/project-14');
    });
  });

  // ==========================================================================
  // setServerDefault
  // ==========================================================================

  describe('setServerDefault', () => {
    it('sets the server default path', () => {
      useProjectStore.getState().setServerDefault('/srv/default');
      expect(useProjectStore.getState().serverDefault).toBe('/srv/default');
    });

    it('does not affect currentProject', () => {
      useProjectStore.getState().setProject('/user/custom');
      useProjectStore.getState().setServerDefault('/srv/default');
      expect(useProjectStore.getState().currentProject).toBe('/user/custom');
    });
  });

  // ==========================================================================
  // removeFromRecents
  // ==========================================================================

  describe('removeFromRecents', () => {
    it('removes a path from recents', () => {
      useProjectStore.getState().setProject('/a');
      useProjectStore.getState().setProject('/b');
      useProjectStore.getState().removeFromRecents('/a');
      expect(useProjectStore.getState().recentProjects).toEqual(['/b']);
    });

    it('clears currentProject if it matches the removed path', () => {
      useProjectStore.getState().setProject('/a');
      expect(useProjectStore.getState().currentProject).toBe('/a');
      useProjectStore.getState().removeFromRecents('/a');
      expect(useProjectStore.getState().currentProject).toBeNull();
    });

    it('does not clear currentProject if removing a different path', () => {
      useProjectStore.getState().setProject('/a');
      useProjectStore.getState().setProject('/b');
      useProjectStore.getState().removeFromRecents('/a');
      expect(useProjectStore.getState().currentProject).toBe('/b');
    });

    it('is a no-op for paths not in recents', () => {
      useProjectStore.getState().setProject('/a');
      useProjectStore.getState().removeFromRecents('/nonexistent');
      expect(useProjectStore.getState().recentProjects).toEqual(['/a']);
      expect(useProjectStore.getState().currentProject).toBe('/a');
    });
  });

  // ==========================================================================
  // validationCache
  // ==========================================================================

  describe('validationCache', () => {
    it('returns undefined for uncached paths', () => {
      expect(useProjectStore.getState().getValidation('/unknown')).toBeUndefined();
    });

    it('stores and retrieves validation results', () => {
      useProjectStore.getState().cacheValidation('/a', { exists: true, isGitRepo: true });
      expect(useProjectStore.getState().getValidation('/a')).toEqual({
        exists: true,
        isGitRepo: true,
      });
    });

    it('overwrites previous validation for same path', () => {
      useProjectStore.getState().cacheValidation('/a', { exists: true, isGitRepo: false });
      useProjectStore.getState().cacheValidation('/a', { exists: true, isGitRepo: true });
      expect(useProjectStore.getState().getValidation('/a')?.isGitRepo).toBe(true);
    });
  });

  // ==========================================================================
  // localStorage persistence
  // ==========================================================================

  describe('localStorage persistence', () => {
    it('persists currentProject and recentProjects on change', () => {
      useProjectStore.getState().setProject('/persisted');

      // The subscribe handler fires synchronously after setState
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'hgnucomb:projects',
        expect.any(String),
      );

      const stored = JSON.parse(
        localStorageMock.setItem.mock.calls.at(-1)?.[1] ?? '{}'
      );
      expect(stored.currentProject).toBe('/persisted');
      expect(stored.recentProjects).toContain('/persisted');
    });

    it('does not persist serverDefault (transient)', () => {
      useProjectStore.getState().setServerDefault('/srv/transient');

      // serverDefault change triggers subscribe, but the persisted data
      // should not include it
      const calls = localStorageMock.setItem.mock.calls.filter(
        ([key]: [string, string]) => key === 'hgnucomb:projects'
      );
      if (calls.length > 0) {
        const stored = JSON.parse(calls.at(-1)?.[1] ?? '{}');
        expect(stored).not.toHaveProperty('serverDefault');
      }
    });

    it('does not persist validationCache (transient)', () => {
      useProjectStore.getState().cacheValidation('/tmp', { exists: true, isGitRepo: false });

      const calls = localStorageMock.setItem.mock.calls.filter(
        ([key]: [string, string]) => key === 'hgnucomb:projects'
      );
      if (calls.length > 0) {
        const stored = JSON.parse(calls.at(-1)?.[1] ?? '{}');
        expect(stored).not.toHaveProperty('validationCache');
      }
    });
  });
});
