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
  agentId: string | null; // Associated agent, null for standalone sessions
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
  agentToSession: Map<string, string>; // agentId -> sessionId

  // Actions
  clear: () => void;
  addSession: (info: TerminalSessionInfo, agentId?: string | null) => void;
  removeSession: (sessionId: string) => void;
  removeSessionForAgent: (agentId: string) => void;
  appendData: (sessionId: string, data: string) => void;
  markExited: (sessionId: string, exitCode: number) => void;
  setActiveSession: (sessionId: string | null) => void;
  resizeSession: (sessionId: string, cols: number, rows: number) => void;
  clearBuffer: (sessionId: string) => void;
  getSession: (sessionId: string) => TerminalSession | undefined;
  getSessionForAgent: (agentId: string) => TerminalSession | undefined;
  getAllSessions: () => TerminalSession[];
}

export const useTerminalStore = create<TerminalStore>()((set, get) => ({
  bridge: null,
  setBridge: (bridge) => set({ bridge }),

  connectionState: 'disconnected',
  setConnectionState: (connectionState) => set({ connectionState }),

  sessions: new Map(),
  activeSessionId: null,
  agentToSession: new Map(),

  clear: () => set({
    sessions: new Map(),
    activeSessionId: null,
    agentToSession: new Map(),
  }),

  addSession: (info, agentId = null) => {
    set((s) => {
      const newAgentToSession = new Map(s.agentToSession);
      if (agentId) {
        newAgentToSession.set(agentId, info.sessionId);
      }
      return {
        sessions: new Map(s.sessions).set(info.sessionId, {
          sessionId: info.sessionId,
          agentId,
          cols: info.cols,
          rows: info.rows,
          buffer: [],
          exited: false,
        }),
        agentToSession: newAgentToSession,
        // Don't auto-select - let UI control this
        activeSessionId: s.activeSessionId,
      };
    });
    console.log('[TerminalStore] Session added:', info.sessionId, 'for agent:', agentId);
  },

  removeSession: (sessionId) => {
    set((s) => {
      const session = s.sessions.get(sessionId);
      const nextSessions = new Map(s.sessions);
      nextSessions.delete(sessionId);

      // Clean up agent mapping
      const nextAgentToSession = new Map(s.agentToSession);
      if (session?.agentId) {
        nextAgentToSession.delete(session.agentId);
      }

      return {
        sessions: nextSessions,
        agentToSession: nextAgentToSession,
        activeSessionId:
          s.activeSessionId === sessionId ? null : s.activeSessionId,
      };
    });
    console.log('[TerminalStore] Session removed:', sessionId);
  },

  removeSessionForAgent: (agentId) => {
    const { agentToSession, bridge } = get();
    const sessionId = agentToSession.get(agentId);
    if (!sessionId) return;

    // Kill the PTY process
    if (bridge) {
      bridge.disposeSession(sessionId).catch((err) => {
        console.error('[TerminalStore] Failed to dispose session:', err);
      });
    }

    // Clean up store state
    get().removeSession(sessionId);
    console.log('[TerminalStore] Cleaned up session for agent:', agentId);
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
  getSessionForAgent: (agentId) => {
    const sessionId = get().agentToSession.get(agentId);
    return sessionId ? get().sessions.get(sessionId) : undefined;
  },
  getAllSessions: () => Array.from(get().sessions.values()),
}));
