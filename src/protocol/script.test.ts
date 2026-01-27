/**
 * Tests for ScriptPlayer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScriptPlayer, buildDemoScript, type ScriptEvent } from './script';
import { createMessage, resetMessageCounter, type Message } from './types';

describe('ScriptPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMessageCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create a simple test script
  function makeTestScript(delays: number[]): ScriptEvent[] {
    resetMessageCounter();
    return delays.map((delay, i) =>
      ({
        delay,
        event: createMessage('agent.spawn', 'hub', 'broadcast', {
          agentId: `agent-${i}`,
          role: 'worker',
          systemPrompt: `Agent ${i}`,
          hex: { q: i, r: 0 },
          connections: [],
        }),
      }) satisfies ScriptEvent
    );
  }

  describe('subscribe', () => {
    it('receives events during playback', async () => {
      const script = makeTestScript([0, 0, 0]);
      const player = new ScriptPlayer(script);
      const received: Message[] = [];

      player.subscribe((event) => received.push(event));

      const playPromise = player.play();
      await vi.runAllTimersAsync();
      await playPromise;

      expect(received).toHaveLength(3);
      expect(received.map((e) => e.id)).toEqual(['evt-001', 'evt-002', 'evt-003']);
    });

    it('returns unsubscribe function', async () => {
      const script = makeTestScript([0, 100, 0]);
      const player = new ScriptPlayer(script);
      const received: Message[] = [];

      const unsubscribe = player.subscribe((event) => received.push(event));

      const playPromise = player.play();

      // First event fires immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(received).toHaveLength(1);

      // Unsubscribe before second event
      unsubscribe();

      await vi.runAllTimersAsync();
      await playPromise;

      // Should only have received the first event
      expect(received).toHaveLength(1);
    });

    it('supports multiple subscribers', async () => {
      const script = makeTestScript([0]);
      const player = new ScriptPlayer(script);
      const received1: Message[] = [];
      const received2: Message[] = [];

      player.subscribe((event) => received1.push(event));
      player.subscribe((event) => received2.push(event));

      const playPromise = player.play();
      await vi.runAllTimersAsync();
      await playPromise;

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });
  });

  describe('play', () => {
    it('emits events in order', async () => {
      const script = makeTestScript([0, 0, 0]);
      const player = new ScriptPlayer(script);
      const received: string[] = [];

      player.subscribe((event) => received.push(event.id));

      const playPromise = player.play();
      await vi.runAllTimersAsync();
      await playPromise;

      expect(received).toEqual(['evt-001', 'evt-002', 'evt-003']);
    });

    it('respects delay timing', async () => {
      const script = makeTestScript([0, 100, 100]);
      const player = new ScriptPlayer(script);
      const timestamps: number[] = [];

      player.subscribe(() => timestamps.push(Date.now()));

      const playPromise = player.play();

      // First event at t=0
      await vi.advanceTimersByTimeAsync(0);
      expect(timestamps).toHaveLength(1);

      // Second event at t=100
      await vi.advanceTimersByTimeAsync(100);
      expect(timestamps).toHaveLength(2);

      // Third event at t=200
      await vi.advanceTimersByTimeAsync(100);
      expect(timestamps).toHaveLength(3);

      await playPromise;

      // Verify timing deltas
      expect(timestamps[1] - timestamps[0]).toBe(100);
      expect(timestamps[2] - timestamps[1]).toBe(100);
    });

    it('sets playing state correctly', async () => {
      const script = makeTestScript([100]);
      const player = new ScriptPlayer(script);

      expect(player.playing).toBe(false);

      const playPromise = player.play();
      expect(player.playing).toBe(true);

      await vi.runAllTimersAsync();
      await playPromise;

      expect(player.playing).toBe(false);
    });

    it('ignores duplicate play calls while playing', async () => {
      const script = makeTestScript([100, 100]);
      const player = new ScriptPlayer(script);
      const received: Message[] = [];

      player.subscribe((event) => received.push(event));

      const play1 = player.play();
      const play2 = player.play(); // Should be ignored

      await vi.runAllTimersAsync();
      await play1;
      await play2;

      // Should only play once, not twice
      expect(received).toHaveLength(2);
    });
  });

  describe('stop', () => {
    it('cancels playback mid-stream', async () => {
      const script = makeTestScript([0, 100, 100]);
      const player = new ScriptPlayer(script);
      const received: Message[] = [];

      player.subscribe((event) => received.push(event));

      const playPromise = player.play();

      // First event fires immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(received).toHaveLength(1);

      // Stop before second event
      player.stop();

      await vi.runAllTimersAsync();
      await playPromise;

      // Only first event should have been received
      expect(received).toHaveLength(1);
      expect(player.playing).toBe(false);
    });

    it('is safe to call when not playing', () => {
      const player = new ScriptPlayer([]);
      expect(() => player.stop()).not.toThrow();
    });
  });

  describe('buildDemoScript', () => {
    it('creates 14 events', () => {
      const script = buildDemoScript(0);
      // 5 spawns + 3 assigns + 3 progress + 3 completes = 14
      expect(script).toHaveLength(14);
    });

    it('uses provided delay between events', () => {
      const script = buildDemoScript(500);
      // First event has delay 0, rest have delay 500
      expect(script[0].delay).toBe(0);
      expect(script[1].delay).toBe(500);
      expect(script[13].delay).toBe(500);
    });

    it('produces deterministic event IDs', () => {
      const script1 = buildDemoScript(0);
      const script2 = buildDemoScript(0);

      expect(script1.map((e) => e.event.id)).toEqual(script2.map((e) => e.event.id));
    });

    it('contains expected event types', () => {
      const script = buildDemoScript(0);
      const types = script.map((e) => e.event.type);

      expect(types).toEqual([
        'agent.spawn', // orchestrator
        'agent.spawn', // worker-1
        'agent.spawn', // worker-2
        'agent.spawn', // worker-3
        'agent.spawn', // specialist-1
        'task.assign', // task-1
        'task.assign', // task-2
        'task.assign', // task-3
        'task.progress', // task-1 50%
        'task.progress', // task-2 50%
        'task.progress', // task-3 75%
        'task.complete', // task-1
        'task.complete', // task-3
        'task.complete', // task-2
      ]);
    });

    it('places agents at correct hex coordinates', () => {
      const script = buildDemoScript(0);
      const spawns = script
        .filter((e) => e.event.type === 'agent.spawn')
        .map((e) => {
          const payload = e.event.payload as { agentId: string; hex: { q: number; r: number } };
          return { id: payload.agentId, hex: payload.hex };
        });

      // Orchestrator at center, workers/specialist in ring 1
      expect(spawns).toEqual([
        { id: 'orchestrator-1', hex: { q: 0, r: 0 } },
        { id: 'worker-1', hex: { q: 1, r: 0 } },
        { id: 'worker-2', hex: { q: 0, r: 1 } },
        { id: 'worker-3', hex: { q: -1, r: 1 } },
        { id: 'specialist-1', hex: { q: -1, r: 0 } },
      ]);
    });
  });
});
