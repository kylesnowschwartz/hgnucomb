/**
 * Zustand store for terminal state management.
 *
 * Tracks connection state, active sessions, and session metadata.
 * Holds reference to the bridge instance for global access.
 *
 * Terminal output buffers live OUTSIDE Zustand (module-level Map) because
 * they are write-hot (every PTY byte) but read-cold (only on panel mount).
 * Storing them in reactive state caused O(n) array copies and full React
 * re-render cascades on every keystroke echo.
 */

import { create } from 'zustand';
import type {
  ConnectionState,
  TerminalBridge,
  TerminalSessionInfo,
} from './index.ts';

const MAX_BUFFER_CHUNKS = 1000;

// ==========================================================================
// Output buffers — mutable, outside React's reactive graph
// ==========================================================================

const outputBuffers = new Map<string, string[]>();

/** Append PTY output to a session's buffer. Zero allocations, zero React notifications. */
export function appendToBuffer(sessionId: string, data: string): void {
  let buf = outputBuffers.get(sessionId);
  if (!buf) {
    buf = [];
    outputBuffers.set(sessionId, buf);
  }
  buf.push(data);
  if (buf.length > MAX_BUFFER_CHUNKS) {
    buf.splice(0, buf.length - MAX_BUFFER_CHUNKS);
  }
}

/** Get a session's output buffer (returns the live array — snapshot with [...] if needed). */
export function getBuffer(sessionId: string): string[] {
  return outputBuffers.get(sessionId) ?? [];
}

/** Clear a session's output buffer. */
export function clearOutputBuffer(sessionId: string): void {
  const buf = outputBuffers.get(sessionId);
  if (buf) buf.length = 0;
}

/** Delete a session's output buffer entirely. */
function removeOutputBuffer(sessionId: string): void {
  outputBuffers.delete(sessionId);
}

/** Clear all output buffers (called from store.clear()). */
function clearAllOutputBuffers(): void {
  outputBuffers.clear();
}

// ==========================================================================
// Zustand store — only UI-relevant state
// ==========================================================================

export interface TerminalSession {
  sessionId: string;
  agentId: string | null; // Associated agent, null for standalone sessions
  cols: number;
  rows: number;
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
  markExited: (sessionId: string, exitCode: number) => void;
  setActiveSession: (sessionId: string | null) => void;
  resizeSession: (sessionId: string, cols: number, rows: number) => void;
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

  clear: () => {
    clearAllOutputBuffers();
    set({
      sessions: new Map(),
      activeSessionId: null,
      agentToSession: new Map(),
    });
  },

  addSession: (info, agentId = null) => {
    set((s) => {
      const newAgentToSession = new Map(s.agentToSession);
      if (agentId) {
        newAgentToSession.set(agentId, info.sessionId);
      }
      // Initialize the output buffer outside Zustand
      outputBuffers.set(info.sessionId, []);

      return {
        sessions: new Map(s.sessions).set(info.sessionId, {
          sessionId: info.sessionId,
          agentId,
          cols: info.cols,
          rows: info.rows,
          exited: false,
        }),
        agentToSession: newAgentToSession,
        // Don't auto-select - let UI control this
        activeSessionId: s.activeSessionId,
      };
    });
  },

  removeSession: (sessionId) => {
    removeOutputBuffer(sessionId);
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
  },

  removeSessionForAgent: (agentId) => {
    const { agentToSession, bridge } = get();
    const sessionId = agentToSession.get(agentId);
    if (!sessionId) return;

    // Kill the PTY process
    if (bridge) {
      bridge.disposeSession(sessionId).catch(() => {
        // Dispose failure is non-fatal — session may already be dead
      });
    }

    // Clean up store state
    get().removeSession(sessionId);
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

  getSession: (sessionId) => get().sessions.get(sessionId),
  getSessionForAgent: (agentId) => {
    const sessionId = get().agentToSession.get(agentId);
    return sessionId ? get().sessions.get(sessionId) : undefined;
  },
  getAllSessions: () => Array.from(get().sessions.values()),
}));
