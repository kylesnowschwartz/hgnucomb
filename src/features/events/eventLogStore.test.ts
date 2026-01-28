import { describe, it, expect, beforeEach } from 'vitest';
import { useEventLogStore } from './eventLogStore';
import type { BroadcastEvent, KillEvent, SpawnEvent } from './eventLogStore';

describe('eventLogStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useEventLogStore.getState().clear();
  });

  // ==========================================================================
  // Event ID format
  // ==========================================================================

  describe('event ID generation', () => {
    it('generates ID in format evt-{counter}-{timestamp}', () => {
      useEventLogStore.getState().addSpawn('agent-1', 'terminal', { q: 0, r: 0 });

      const events = useEventLogStore.getState().events;
      expect(events[0].id).toMatch(/^evt-\d+-\d+$/);
    });

    it('IDs are unique across rapid creation (counter increments)', () => {
      useEventLogStore.getState().addSpawn('agent-1', 'terminal', { q: 0, r: 0 });
      useEventLogStore.getState().addSpawn('agent-2', 'terminal', { q: 1, r: 0 });
      useEventLogStore.getState().addSpawn('agent-3', 'terminal', { q: 2, r: 0 });

      const events = useEventLogStore.getState().events;
      const ids = events.map((e) => e.id);
      const unique = new Set(ids);

      expect(unique.size).toBe(ids.length);
    });

    it('events have ISO 8601 timestamps', () => {
      useEventLogStore.getState().addSpawn('agent-1', 'terminal', { q: 0, r: 0 });

      const events = useEventLogStore.getState().events;
      expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ==========================================================================
  // truncatePayload (tested indirectly through addBroadcast)
  // ==========================================================================

  describe('truncatePayload', () => {
    it('at exactly 80 chars returns string unchanged', () => {
      // Create an object that serializes to exactly 80 chars
      const payload = { msg: 'a'.repeat(70) }; // {"msg":"aaa..."} = ~80 chars
      useEventLogStore.getState().addBroadcast(
        'agent-1',
        { q: 0, r: 0 },
        'test',
        1,
        0,
        payload
      );

      const events = useEventLogStore.getState().events;
      const broadcast = events[0] as BroadcastEvent;
      // If <= 80, no ellipsis
      if (JSON.stringify(payload).length <= 80) {
        expect(broadcast.payloadPreview).not.toContain('...');
      }
    });

    it('at 81+ chars truncates and adds ellipsis', () => {
      // Create a long payload
      const payload = { message: 'x'.repeat(100) };
      useEventLogStore.getState().addBroadcast(
        'agent-1',
        { q: 0, r: 0 },
        'test',
        1,
        0,
        payload
      );

      const events = useEventLogStore.getState().events;
      const broadcast = events[0] as BroadcastEvent;
      expect(broadcast.payloadPreview).toContain('...');
      expect(broadcast.payloadPreview.length).toBeLessThanOrEqual(83); // 80 + "..."
    });

    it('handles non-JSON-serializable objects', () => {
      // Circular reference - intentionally using Record to create unserializable object
      const payload: Record<string, unknown> = {};
      payload.self = payload;

      useEventLogStore.getState().addBroadcast(
        'agent-1',
        { q: 0, r: 0 },
        'test',
        1,
        0,
        payload
      );

      const events = useEventLogStore.getState().events;
      const broadcast = events[0] as BroadcastEvent;
      expect(broadcast.payloadPreview).toBe('[unserializable]');
    });
  });

  // ==========================================================================
  // FIFO eviction
  // ==========================================================================

  describe('FIFO eviction', () => {
    it('at maxEvents (500) keeps last 500 via slice(-500)', () => {
      // Add 510 events
      for (let i = 0; i < 510; i++) {
        useEventLogStore.getState().addKill(`agent-${i}`);
      }

      const events = useEventLogStore.getState().events;
      expect(events.length).toBe(500);

      // First event should be agent-10 (0-9 were evicted)
      expect((events[0] as KillEvent).agentId).toBe('agent-10');
      // Last event should be agent-509
      expect((events[499] as KillEvent).agentId).toBe('agent-509');
    });
  });

  // ==========================================================================
  // addBroadcast
  // ==========================================================================

  describe('addBroadcast', () => {
    it('creates BroadcastEvent with correct fields', () => {
      useEventLogStore.getState().addBroadcast(
        'agent-1',
        { q: 3, r: -2 },
        'announcement',
        5,
        3,
        { message: 'hello' }
      );

      const events = useEventLogStore.getState().events;
      expect(events.length).toBe(1);

      const event = events[0];
      expect(event.kind).toBe('broadcast');
      if (event.kind === 'broadcast') {
        expect(event.senderId).toBe('agent-1');
        expect(event.senderHex).toEqual({ q: 3, r: -2 });
        expect(event.broadcastType).toBe('announcement');
        expect(event.radius).toBe(5);
        expect(event.recipientCount).toBe(3);
        expect(event.payloadPreview).toContain('hello');
      }
    });
  });

  // ==========================================================================
  // addSpawn
  // ==========================================================================

  describe('addSpawn', () => {
    it('creates SpawnEvent with cellType and hex', () => {
      useEventLogStore.getState().addSpawn('agent-123', 'orchestrator', { q: 1, r: 2 });

      const events = useEventLogStore.getState().events;
      expect(events.length).toBe(1);

      const event = events[0];
      expect(event.kind).toBe('spawn');
      if (event.kind === 'spawn') {
        expect(event.agentId).toBe('agent-123');
        expect(event.cellType).toBe('orchestrator');
        expect(event.hex).toEqual({ q: 1, r: 2 });
      }
    });
  });

  // ==========================================================================
  // addKill
  // ==========================================================================

  describe('addKill', () => {
    it('creates KillEvent with agentId', () => {
      useEventLogStore.getState().addKill('agent-456');

      const events = useEventLogStore.getState().events;
      expect(events.length).toBe(1);

      const event = events[0];
      expect(event.kind).toBe('kill');
      if (event.kind === 'kill') {
        expect(event.agentId).toBe('agent-456');
      }
    });
  });

  // ==========================================================================
  // addStatusChange
  // ==========================================================================

  describe('addStatusChange', () => {
    it('creates StatusChangeEvent with newStatus', () => {
      useEventLogStore.getState().addStatusChange('agent-1', 'working', 'Processing');

      const events = useEventLogStore.getState().events;
      expect(events.length).toBe(1);

      const event = events[0];
      expect(event.kind).toBe('statusChange');
      if (event.kind === 'statusChange') {
        expect(event.agentId).toBe('agent-1');
        expect(event.newStatus).toBe('working');
        expect(event.message).toBe('Processing');
      }
    });

    it('includes previousStatus when provided', () => {
      useEventLogStore.getState().addStatusChange('agent-1', 'done', 'Complete', 'working');

      const events = useEventLogStore.getState().events;
      const event = events[0];

      if (event.kind === 'statusChange') {
        expect(event.previousStatus).toBe('working');
        expect(event.newStatus).toBe('done');
      }
    });

    it('previousStatus is undefined when not provided', () => {
      useEventLogStore.getState().addStatusChange('agent-1', 'idle');

      const events = useEventLogStore.getState().events;
      const event = events[0];

      if (event.kind === 'statusChange') {
        expect(event.previousStatus).toBeUndefined();
      }
    });
  });

  // ==========================================================================
  // addMessageReceived
  // ==========================================================================

  describe('addMessageReceived', () => {
    it('creates MessageReceivedEvent with correct fields', () => {
      useEventLogStore.getState().addMessageReceived(
        'orchestrator-1',
        'worker-1',
        'result',
        { analysis: 'complete', score: 95 }
      );

      const events = useEventLogStore.getState().events;
      expect(events.length).toBe(1);

      const event = events[0];
      expect(event.kind).toBe('messageReceived');
      if (event.kind === 'messageReceived') {
        expect(event.recipientId).toBe('orchestrator-1');
        expect(event.senderId).toBe('worker-1');
        expect(event.messageType).toBe('result');
        expect(event.payloadPreview).toContain('analysis');
      }
    });

    it('handles broadcast message type', () => {
      useEventLogStore.getState().addMessageReceived(
        'agent-1',
        'agent-2',
        'broadcast',
        { announcement: 'starting work' }
      );

      const events = useEventLogStore.getState().events;
      const event = events[0];

      if (event.kind === 'messageReceived') {
        expect(event.messageType).toBe('broadcast');
      }
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================

  describe('clear', () => {
    it('resets events to empty array', () => {
      useEventLogStore.getState().addSpawn('agent-1', 'terminal', { q: 0, r: 0 });
      useEventLogStore.getState().addKill('agent-1');
      expect(useEventLogStore.getState().events.length).toBe(2);

      useEventLogStore.getState().clear();

      expect(useEventLogStore.getState().events).toEqual([]);
    });
  });

  // ==========================================================================
  // addEvent (generic)
  // ==========================================================================

  describe('addEvent', () => {
    it('adds event with auto-generated id and timestamp', () => {
      useEventLogStore.getState().addEvent({
        kind: 'spawn',
        agentId: 'agent-test',
        cellType: 'worker',
        hex: { q: 5, r: -3 },
      } as Omit<SpawnEvent, 'id' | 'timestamp'>);

      const events = useEventLogStore.getState().events;
      expect(events.length).toBe(1);
      expect(events[0].id).toBeDefined();
      expect(events[0].timestamp).toBeDefined();
    });
  });
});
