import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from './agentStore';
import { useEventLogStore } from '@features/events/eventLogStore';
import type { AgentMessage } from '@shared/protocol';

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
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('agentStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useAgentStore.getState().clear();
    useEventLogStore.getState().clear();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // spawnAgent
  // ==========================================================================

  describe('spawnAgent', () => {
    it('generates ID in format agent-{timestamp}-{random}', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      expect(id).toMatch(/^agent-\d+-[a-z0-9]{4}$/);
    });

    it('maps cellType correctly: terminal -> worker role', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 }, 'terminal');
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.cellType).toBe('terminal');
      expect(agent?.role).toBe('worker');
    });

    it('maps cellType correctly: orchestrator -> orchestrator role', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 1, r: 1 }, 'orchestrator');
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.cellType).toBe('orchestrator');
      expect(agent?.role).toBe('orchestrator');
    });

    it('maps cellType correctly: worker -> worker role', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 2, r: 2 }, 'worker');
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.cellType).toBe('worker');
      expect(agent?.role).toBe('worker');
    });

    it('initializes empty inbox', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.inbox).toEqual([]);
    });

    it('sets connections to [parentId] when parentId provided', () => {
      const id = useAgentStore.getState().spawnAgent(
        { q: 0, r: 0 },
        'worker',
        { parentId: 'orchestrator-123', parentHex: { q: 1, r: 0 } }
      );
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.connections).toEqual(['orchestrator-123']);
      expect(agent?.parentId).toBe('orchestrator-123');
      expect(agent?.parentHex).toEqual({ q: 1, r: 0 });
    });

    it('sets connections to empty array when no parentId', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.connections).toEqual([]);
    });

    it('stores task and instructions when provided', () => {
      const id = useAgentStore.getState().spawnAgent(
        { q: 0, r: 0 },
        'worker',
        { task: 'analyze code', instructions: 'Focus on security', taskDetails: 'Check auth module' }
      );
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.task).toBe('analyze code');
      expect(agent?.instructions).toBe('Focus on security');
      expect(agent?.taskDetails).toBe('Check auth module');
    });

    it('initializes with pending status', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.status).toBe('idle');
      expect(agent?.detailedStatus).toBe('pending');
    });
  });

  // ==========================================================================
  // removeAgent
  // ==========================================================================

  describe('removeAgent', () => {
    it('removes agent from map', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      expect(useAgentStore.getState().getAgent(id)).toBeDefined();

      useAgentStore.getState().removeAgent(id);
      expect(useAgentStore.getState().getAgent(id)).toBeUndefined();
    });

    it('does not affect other agents', () => {
      const id1 = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      const id2 = useAgentStore.getState().spawnAgent({ q: 1, r: 1 });

      useAgentStore.getState().removeAgent(id1);

      expect(useAgentStore.getState().getAgent(id1)).toBeUndefined();
      expect(useAgentStore.getState().getAgent(id2)).toBeDefined();
    });

    it('is no-op for non-existent agent', () => {
      // Should not throw
      useAgentStore.getState().removeAgent('nonexistent-id');
      expect(useAgentStore.getState().getAllAgents()).toEqual([]);
    });
  });

  // ==========================================================================
  // updateDetailedStatus
  // ==========================================================================

  describe('updateDetailedStatus', () => {
    it('returns previous status', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      const previous = useAgentStore.getState().updateDetailedStatus(id, 'working');
      expect(previous).toBe('pending');
    });

    it('updates status correctly', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      useAgentStore.getState().updateDetailedStatus(id, 'working', 'Processing task');

      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.detailedStatus).toBe('working');
      expect(agent?.statusMessage).toBe('Processing task');
    });

    it('returns undefined for non-existent agent', () => {
      const result = useAgentStore.getState().updateDetailedStatus('nonexistent', 'working');
      expect(result).toBeUndefined();
    });

    it('tracks status transitions correctly', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });

      // pending -> working -> waiting_input -> done
      expect(useAgentStore.getState().updateDetailedStatus(id, 'working')).toBe('pending');
      expect(useAgentStore.getState().updateDetailedStatus(id, 'waiting_input')).toBe('working');
      expect(useAgentStore.getState().updateDetailedStatus(id, 'done')).toBe('waiting_input');
    });
  });

  // ==========================================================================
  // addMessageToInbox
  // ==========================================================================

  describe('addMessageToInbox', () => {
    it('appends message to existing inbox', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });

      const msg1: AgentMessage = {
        id: 'msg-1',
        from: 'worker-1',
        type: 'result',
        payload: { data: 'first' },
        timestamp: '2024-01-01T10:00:00Z',
      };
      const msg2: AgentMessage = {
        id: 'msg-2',
        from: 'worker-2',
        type: 'result',
        payload: { data: 'second' },
        timestamp: '2024-01-01T11:00:00Z',
      };

      useAgentStore.getState().addMessageToInbox(id, msg1);
      useAgentStore.getState().addMessageToInbox(id, msg2);

      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.inbox).toHaveLength(2);
      expect(agent?.inbox[0]).toEqual(msg1);
      expect(agent?.inbox[1]).toEqual(msg2);
    });

    it('returns false for non-existent agent', () => {
      const msg: AgentMessage = {
        id: 'msg-1',
        from: 'worker-1',
        type: 'result',
        payload: {},
        timestamp: '2024-01-01T10:00:00Z',
      };
      const result = useAgentStore.getState().addMessageToInbox('nonexistent', msg);
      expect(result).toBe(false);
    });

    it('returns true on success', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      const msg: AgentMessage = {
        id: 'msg-1',
        from: 'worker-1',
        type: 'result',
        payload: {},
        timestamp: '2024-01-01T10:00:00Z',
      };
      const result = useAgentStore.getState().addMessageToInbox(id, msg);
      expect(result).toBe(true);
    });

    it('logs to eventLogStore', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      const msg: AgentMessage = {
        id: 'msg-1',
        from: 'worker-1',
        type: 'result',
        payload: { analysis: 'complete' },
        timestamp: '2024-01-01T10:00:00Z',
      };

      useAgentStore.getState().addMessageToInbox(id, msg);

      const events = useEventLogStore.getState().events;
      expect(events.length).toBe(1);
      expect(events[0].kind).toBe('messageReceived');
    });
  });

  // ==========================================================================
  // getMessages
  // ==========================================================================

  describe('getMessages', () => {
    it('returns all messages and clears inbox when no timestamp', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });

      const msg1: AgentMessage = {
        id: 'msg-1',
        from: 'w1',
        type: 'result',
        payload: {},
        timestamp: '2024-01-01T10:00:00Z',
      };
      const msg2: AgentMessage = {
        id: 'msg-2',
        from: 'w2',
        type: 'result',
        payload: {},
        timestamp: '2024-01-01T11:00:00Z',
      };

      useAgentStore.getState().addMessageToInbox(id, msg1);
      useAgentStore.getState().addMessageToInbox(id, msg2);

      const messages = useAgentStore.getState().getMessages(id);
      expect(messages).toHaveLength(2);

      // Inbox should be empty now
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.inbox).toEqual([]);
    });

    it('returns only messages AFTER timestamp, removes them', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });

      const msg1: AgentMessage = {
        id: 'msg-1',
        from: 'w1',
        type: 'result',
        payload: {},
        timestamp: '2024-01-01T10:00:00Z',
      };
      const msg2: AgentMessage = {
        id: 'msg-2',
        from: 'w2',
        type: 'result',
        payload: {},
        timestamp: '2024-01-01T11:00:00Z',
      };
      const msg3: AgentMessage = {
        id: 'msg-3',
        from: 'w3',
        type: 'result',
        payload: {},
        timestamp: '2024-01-01T12:00:00Z',
      };

      useAgentStore.getState().addMessageToInbox(id, msg1);
      useAgentStore.getState().addMessageToInbox(id, msg2);
      useAgentStore.getState().addMessageToInbox(id, msg3);

      // Get messages after msg1's timestamp
      const messages = useAgentStore.getState().getMessages(id, '2024-01-01T10:00:00Z');
      expect(messages).toHaveLength(2);
      expect(messages.map((m) => m.id)).toEqual(['msg-2', 'msg-3']);

      // Inbox should keep msg1 (at or before timestamp)
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.inbox).toHaveLength(1);
      expect(agent?.inbox[0].id).toBe('msg-1');
    });

    it('keeps messages AT OR BEFORE timestamp', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });

      const msg1: AgentMessage = {
        id: 'msg-1',
        from: 'w1',
        type: 'result',
        payload: {},
        timestamp: '2024-01-01T10:00:00Z',
      };

      useAgentStore.getState().addMessageToInbox(id, msg1);

      // Request messages after exactly msg1's timestamp - should not include msg1
      const messages = useAgentStore.getState().getMessages(id, '2024-01-01T10:00:00Z');
      expect(messages).toHaveLength(0);

      // msg1 should still be in inbox
      const agent = useAgentStore.getState().getAgent(id);
      expect(agent?.inbox).toHaveLength(1);
    });

    it('returns empty array for non-existent agent', () => {
      const messages = useAgentStore.getState().getMessages('nonexistent');
      expect(messages).toEqual([]);
    });

    it('returns empty array when inbox is empty', () => {
      const id = useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      const messages = useAgentStore.getState().getMessages(id);
      expect(messages).toEqual([]);
    });
  });

  // ==========================================================================
  // getAllAgents and getAgent
  // ==========================================================================

  describe('getAllAgents', () => {
    it('returns all agents as array', () => {
      useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      useAgentStore.getState().spawnAgent({ q: 1, r: 1 });
      useAgentStore.getState().spawnAgent({ q: 2, r: 2 });

      const agents = useAgentStore.getState().getAllAgents();
      expect(agents).toHaveLength(3);
    });

    it('returns empty array when no agents', () => {
      const agents = useAgentStore.getState().getAllAgents();
      expect(agents).toEqual([]);
    });
  });

  describe('getAgent', () => {
    it('returns undefined for unknown agent', () => {
      const agent = useAgentStore.getState().getAgent('unknown-id');
      expect(agent).toBeUndefined();
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================

  describe('clear', () => {
    it('removes all agents', () => {
      useAgentStore.getState().spawnAgent({ q: 0, r: 0 });
      useAgentStore.getState().spawnAgent({ q: 1, r: 1 });

      useAgentStore.getState().clear();

      expect(useAgentStore.getState().getAllAgents()).toEqual([]);
    });
  });
});
