/**
 * Zustand store for terminal state management.
 *
 * Tracks connection state, active sessions, and terminal output buffers.
 * Holds reference to the bridge instance for global access.
 */

import { create } from 'zustand';
import type {
  ConnectionState,
  TerminalBridge,
  TerminalSessionInfo,
} from '@terminal/index.ts';

const MAX_BUFFER_CHUNKS = 1000;

export interface TerminalSession {
  sessionId: string;
  cols: number;
  rows: number;
  buffer: string[];
  exited: boolean;
  exitCode?: number;
}

interface TerminalStore {
  // Bridge reference
  bridge: TerminalBridge | null;
  setBridge: (bridge: TerminalBridge | null) => void;

  // Connection state
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;

  // Sessions
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;

  // Actions
  addSession: (info: TerminalSessionInfo) => void;
  removeSession: (sessionId: string) => void;
  appendData: (sessionId: string, data: string) => void;
  markExited: (sessionId: string, exitCode: number) => void;
  setActiveSession: (sessionId: string | null) => void;
  resizeSession: (sessionId: string, cols: number, rows: number) => void;
  clearBuffer: (sessionId: string) => void;
  getSession: (sessionId: string) => TerminalSession | undefined;
  getAllSessions: () => TerminalSession[];
}

export const useTerminalStore = create<TerminalStore>()((set, get) => ({
  bridge: null,
  setBridge: (bridge) => set({ bridge }),

  connectionState: 'disconnected',
  setConnectionState: (connectionState) => set({ connectionState }),

  sessions: new Map(),
  activeSessionId: null,

  addSession: (info) => {
    set((s) => ({
      sessions: new Map(s.sessions).set(info.sessionId, {
        sessionId: info.sessionId,
        cols: info.cols,
        rows: info.rows,
        buffer: [],
        exited: false,
      }),
      // Auto-select first session
      activeSessionId: s.activeSessionId ?? info.sessionId,
    }));
    console.log('[TerminalStore] Session added:', info.sessionId);
  },

  removeSession: (sessionId) => {
    set((s) => {
      const next = new Map(s.sessions);
      next.delete(sessionId);
      return {
        sessions: next,
        activeSessionId:
          s.activeSessionId === sessionId
            ? (next.keys().next().value ?? null)
            : s.activeSessionId,
      };
    });
    console.log('[TerminalStore] Session removed:', sessionId);
  },

  appendData: (sessionId, data) => {
    set((s) => {
      const session = s.sessions.get(sessionId);
      if (!session) return s;

      const newBuffer = [...session.buffer, data];
      // Cap buffer to prevent memory bloat
      if (newBuffer.length > MAX_BUFFER_CHUNKS) {
        newBuffer.splice(0, newBuffer.length - MAX_BUFFER_CHUNKS);
      }

      return {
        sessions: new Map(s.sessions).set(sessionId, {
          ...session,
          buffer: newBuffer,
        }),
      };
    });
  },

  markExited: (sessionId, exitCode) => {
    set((s) => {
      const session = s.sessions.get(sessionId);
      if (!session) return s;

      return {
        sessions: new Map(s.sessions).set(sessionId, {
          ...session,
          exited: true,
          exitCode,
        }),
      };
    });
    console.log('[TerminalStore] Session exited:', sessionId, 'code:', exitCode);
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
  },

  resizeSession: (sessionId, cols, rows) => {
    set((s) => {
      const session = s.sessions.get(sessionId);
      if (!session) return s;

      return {
        sessions: new Map(s.sessions).set(sessionId, {
          ...session,
          cols,
          rows,
        }),
      };
    });
  },

  clearBuffer: (sessionId) => {
    set((s) => {
      const session = s.sessions.get(sessionId);
      if (!session) return s;

      return {
        sessions: new Map(s.sessions).set(sessionId, {
          ...session,
          buffer: [],
        }),
      };
    });
  },

  getSession: (sessionId) => get().sessions.get(sessionId),
  getAllSessions: () => Array.from(get().sessions.values()),
}));
