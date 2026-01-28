import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTerminalStore } from './terminalStore';
import type { TerminalBridge } from './index';

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('terminalStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useTerminalStore.getState().clear();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // addSession
  // ==========================================================================

  describe('addSession', () => {
    it('creates session with empty buffer', () => {
      useTerminalStore.getState().addSession({
        sessionId: 'sess-1',
        cols: 80,
        rows: 24,
      });

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session).toBeDefined();
      expect(session?.buffer).toEqual([]);
      expect(session?.exited).toBe(false);
    });

    it('stores cols and rows', () => {
      useTerminalStore.getState().addSession({
        sessionId: 'sess-1',
        cols: 120,
        rows: 40,
      });

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.cols).toBe(120);
      expect(session?.rows).toBe(40);
    });

    it('updates agentToSession mapping when agentId provided', () => {
      useTerminalStore.getState().addSession(
        { sessionId: 'sess-1', cols: 80, rows: 24 },
        'agent-123'
      );

      const session = useTerminalStore.getState().getSessionForAgent('agent-123');
      expect(session).toBeDefined();
      expect(session?.sessionId).toBe('sess-1');
      expect(session?.agentId).toBe('agent-123');
    });

    it('leaves agentToSession unchanged when no agentId', () => {
      useTerminalStore.getState().addSession({
        sessionId: 'sess-1',
        cols: 80,
        rows: 24,
      });

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.agentId).toBeNull();
    });

    it('does not auto-select the new session', () => {
      // First session
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });
      useTerminalStore.getState().setActiveSession('sess-1');

      // Second session should not change activeSessionId
      useTerminalStore.getState().addSession({ sessionId: 'sess-2', cols: 80, rows: 24 });

      expect(useTerminalStore.getState().activeSessionId).toBe('sess-1');
    });
  });

  // ==========================================================================
  // appendData
  // ==========================================================================

  describe('appendData', () => {
    it('adds to buffer', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });

      useTerminalStore.getState().appendData('sess-1', 'hello');
      useTerminalStore.getState().appendData('sess-1', 'world');

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.buffer).toEqual(['hello', 'world']);
    });

    it('ignores non-existent sessionId', () => {
      // Should not throw
      useTerminalStore.getState().appendData('nonexistent', 'data');

      // No sessions should exist
      expect(useTerminalStore.getState().getAllSessions()).toEqual([]);
    });

    it('at MAX_BUFFER_CHUNKS (1000) drops oldest via splice', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });

      // Add 1000 chunks
      for (let i = 0; i < 1000; i++) {
        useTerminalStore.getState().appendData('sess-1', `chunk-${i}`);
      }

      let session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.buffer.length).toBe(1000);
      expect(session?.buffer[0]).toBe('chunk-0');
      expect(session?.buffer[999]).toBe('chunk-999');

      // Add one more - should drop the oldest
      useTerminalStore.getState().appendData('sess-1', 'chunk-1000');

      session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.buffer.length).toBe(1000);
      expect(session?.buffer[0]).toBe('chunk-1');
      expect(session?.buffer[999]).toBe('chunk-1000');
    });

    it('keeps exactly 1000 chunks when over limit', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });

      // Add 1010 chunks
      for (let i = 0; i < 1010; i++) {
        useTerminalStore.getState().appendData('sess-1', `chunk-${i}`);
      }

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.buffer.length).toBe(1000);
    });
  });

  // ==========================================================================
  // removeSession
  // ==========================================================================

  describe('removeSession', () => {
    it('deletes from sessions map', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });
      expect(useTerminalStore.getState().getSession('sess-1')).toBeDefined();

      useTerminalStore.getState().removeSession('sess-1');
      expect(useTerminalStore.getState().getSession('sess-1')).toBeUndefined();
    });

    it('removes from agentToSession if session had agent', () => {
      useTerminalStore.getState().addSession(
        { sessionId: 'sess-1', cols: 80, rows: 24 },
        'agent-123'
      );
      expect(useTerminalStore.getState().getSessionForAgent('agent-123')).toBeDefined();

      useTerminalStore.getState().removeSession('sess-1');
      expect(useTerminalStore.getState().getSessionForAgent('agent-123')).toBeUndefined();
    });

    it('clears activeSessionId if it was the removed session', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });
      useTerminalStore.getState().setActiveSession('sess-1');
      expect(useTerminalStore.getState().activeSessionId).toBe('sess-1');

      useTerminalStore.getState().removeSession('sess-1');
      expect(useTerminalStore.getState().activeSessionId).toBeNull();
    });

    it('keeps activeSessionId if different session removed', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });
      useTerminalStore.getState().addSession({ sessionId: 'sess-2', cols: 80, rows: 24 });
      useTerminalStore.getState().setActiveSession('sess-1');

      useTerminalStore.getState().removeSession('sess-2');
      expect(useTerminalStore.getState().activeSessionId).toBe('sess-1');
    });

    it('does not throw for non-existent session', () => {
      // Should not throw
      useTerminalStore.getState().removeSession('nonexistent');
    });
  });

  // ==========================================================================
  // removeSessionForAgent
  // ==========================================================================

  describe('removeSessionForAgent', () => {
    it('is no-op when agent has no session', () => {
      // Should not throw
      useTerminalStore.getState().removeSessionForAgent('unknown-agent');
      expect(useTerminalStore.getState().getAllSessions()).toEqual([]);
    });

    it('calls removeSession for the mapped session', () => {
      useTerminalStore.getState().addSession(
        { sessionId: 'sess-1', cols: 80, rows: 24 },
        'agent-123'
      );

      // Set up mock bridge to avoid actual WebSocket call
      const mockBridge = {
        disposeSession: vi.fn().mockResolvedValue(undefined),
      } as unknown as TerminalBridge;
      useTerminalStore.getState().setBridge(mockBridge);

      useTerminalStore.getState().removeSessionForAgent('agent-123');

      // Bridge should have been called
      expect(mockBridge.disposeSession).toHaveBeenCalledWith('sess-1');

      // Session should be removed
      expect(useTerminalStore.getState().getSession('sess-1')).toBeUndefined();
      expect(useTerminalStore.getState().getSessionForAgent('agent-123')).toBeUndefined();
    });
  });

  // ==========================================================================
  // markExited
  // ==========================================================================

  describe('markExited', () => {
    it('sets exited=true and exitCode', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });

      useTerminalStore.getState().markExited('sess-1', 0);

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.exited).toBe(true);
      expect(session?.exitCode).toBe(0);
    });

    it('handles non-zero exit codes', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });

      useTerminalStore.getState().markExited('sess-1', 127);

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.exitCode).toBe(127);
    });

    it('is no-op for non-existent session', () => {
      // Should not throw
      useTerminalStore.getState().markExited('nonexistent', 0);
    });
  });

  // ==========================================================================
  // getSessionForAgent
  // ==========================================================================

  describe('getSessionForAgent', () => {
    it('returns undefined for unknown agent', () => {
      const session = useTerminalStore.getState().getSessionForAgent('unknown');
      expect(session).toBeUndefined();
    });

    it('returns session when mapping exists', () => {
      useTerminalStore.getState().addSession(
        { sessionId: 'sess-1', cols: 80, rows: 24 },
        'agent-123'
      );

      const session = useTerminalStore.getState().getSessionForAgent('agent-123');
      expect(session?.sessionId).toBe('sess-1');
    });
  });

  // ==========================================================================
  // resizeSession
  // ==========================================================================

  describe('resizeSession', () => {
    it('updates cols and rows', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });

      useTerminalStore.getState().resizeSession('sess-1', 120, 40);

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.cols).toBe(120);
      expect(session?.rows).toBe(40);
    });

    it('is no-op for non-existent session', () => {
      // Should not throw
      useTerminalStore.getState().resizeSession('nonexistent', 120, 40);
    });
  });

  // ==========================================================================
  // clearBuffer
  // ==========================================================================

  describe('clearBuffer', () => {
    it('resets buffer to empty array', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });
      useTerminalStore.getState().appendData('sess-1', 'some data');
      useTerminalStore.getState().appendData('sess-1', 'more data');

      useTerminalStore.getState().clearBuffer('sess-1');

      const session = useTerminalStore.getState().getSession('sess-1');
      expect(session?.buffer).toEqual([]);
    });
  });

  // ==========================================================================
  // getAllSessions
  // ==========================================================================

  describe('getAllSessions', () => {
    it('returns all sessions as array', () => {
      useTerminalStore.getState().addSession({ sessionId: 'sess-1', cols: 80, rows: 24 });
      useTerminalStore.getState().addSession({ sessionId: 'sess-2', cols: 80, rows: 24 });

      const sessions = useTerminalStore.getState().getAllSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.sessionId).sort()).toEqual(['sess-1', 'sess-2']);
    });

    it('returns empty array when no sessions', () => {
      const sessions = useTerminalStore.getState().getAllSessions();
      expect(sessions).toEqual([]);
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================

  describe('clear', () => {
    it('removes all sessions and resets state', () => {
      useTerminalStore.getState().addSession(
        { sessionId: 'sess-1', cols: 80, rows: 24 },
        'agent-1'
      );
      useTerminalStore.getState().addSession(
        { sessionId: 'sess-2', cols: 80, rows: 24 },
        'agent-2'
      );
      useTerminalStore.getState().setActiveSession('sess-1');

      useTerminalStore.getState().clear();

      expect(useTerminalStore.getState().getAllSessions()).toEqual([]);
      expect(useTerminalStore.getState().activeSessionId).toBeNull();
      expect(useTerminalStore.getState().getSessionForAgent('agent-1')).toBeUndefined();
      expect(useTerminalStore.getState().getSessionForAgent('agent-2')).toBeUndefined();
    });
  });
});
