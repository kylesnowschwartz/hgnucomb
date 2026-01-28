/**
 * Tests for Event Protocol types.
 *
 * Validates message creation and JSON serialization.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMessage,
  resetMessageCounter,
  type Message,
} from './types';

describe('Event Protocol Types', () => {
  beforeEach(() => {
    resetMessageCounter();
  });

  describe('agent.spawn message', () => {
    it('creates a valid spawn message', () => {
      const message = createMessage('agent.spawn', 'hub', 'broadcast', {
        agentId: 'orchestrator-1',
        role: 'orchestrator',
        systemPrompt: 'You coordinate the team...',
        hex: { q: 0, r: 0 },
        connections: ['worker-1', 'worker-2'],
      });

      expect(message.id).toBe('evt-001');
      expect(message.type).toBe('agent.spawn');
      expect(message.from).toBe('hub');
      expect(message.to).toBe('broadcast');
      expect(message.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(message.payload.agentId).toBe('orchestrator-1');
      expect(message.payload.role).toBe('orchestrator');
      expect(message.payload.hex).toEqual({ q: 0, r: 0 });
    });
  });

  describe('agent.status message', () => {
    it('creates a valid status message', () => {
      const message = createMessage('agent.status', 'worker-1', 'hub', {
        agentId: 'worker-1',
        status: 'working',
        message: 'Processing task',
      });

      expect(message.id).toBe('evt-001');
      expect(message.type).toBe('agent.status');
      expect(message.from).toBe('worker-1');
      expect(message.to).toBe('hub');
      expect(message.payload.status).toBe('working');
      expect(message.payload.message).toBe('Processing task');
    });
  });

  describe('agent.despawn message', () => {
    it('creates a valid despawn message', () => {
      const message = createMessage('agent.despawn', 'hub', 'broadcast', {
        agentId: 'worker-2',
        reason: 'completed',
      });

      expect(message.id).toBe('evt-001');
      expect(message.type).toBe('agent.despawn');
      expect(message.payload.agentId).toBe('worker-2');
      expect(message.payload.reason).toBe('completed');
    });
  });

  describe('JSON serialization', () => {
    it('roundtrips through JSON correctly', () => {
      const original = createMessage('agent.spawn', 'hub', 'broadcast', {
        agentId: 'test-agent',
        role: 'worker',
        systemPrompt: 'Test prompt with "quotes" and special chars: <>&',
        hex: { q: 2, r: -1 },
        connections: [],
      });

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json) as Message<'agent.spawn'>;

      expect(parsed.id).toBe(original.id);
      expect(parsed.type).toBe(original.type);
      expect(parsed.from).toBe(original.from);
      expect(parsed.to).toBe(original.to);
      expect(parsed.timestamp).toBe(original.timestamp);
      expect(parsed.payload).toEqual(original.payload);
    });

    it('preserves all payload fields through serialization', () => {
      const message = createMessage('agent.status', 'agent-1', 'hub', {
        agentId: 'agent-1',
        status: 'blocked',
        message: 'Waiting for dependencies',
      });
      const roundtripped = JSON.parse(JSON.stringify(message));

      expect(roundtripped.payload.agentId).toBe('agent-1');
      expect(roundtripped.payload.status).toBe('blocked');
      expect(roundtripped.payload.message).toBe('Waiting for dependencies');
    });
  });

  describe('message counter', () => {
    it('increments message IDs sequentially', () => {
      const m1 = createMessage('agent.status', 'a', 'hub', {
        agentId: 'a',
        status: 'idle',
      });
      const m2 = createMessage('agent.status', 'b', 'hub', {
        agentId: 'b',
        status: 'working',
      });
      const m3 = createMessage('agent.status', 'c', 'hub', {
        agentId: 'c',
        status: 'blocked',
      });

      expect(m1.id).toBe('evt-001');
      expect(m2.id).toBe('evt-002');
      expect(m3.id).toBe('evt-003');
    });
  });
});
