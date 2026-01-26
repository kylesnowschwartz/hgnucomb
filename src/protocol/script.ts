/**
 * ScriptPlayer for timed event simulation.
 *
 * Plays back a sequence of events with configurable delays to simulate
 * multi-agent workflows without real Claude integration.
 *
 * @see .agent-history/tasks/in-progress/context-packet-task2-event-script.md
 */

import {
  type Message,
  type SpawnPayload,
  type TaskAssignPayload,
  type TaskProgressPayload,
  type TaskCompletePayload,
  createMessage,
  resetMessageCounter,
} from './types';

// ============================================================================
// Types
// ============================================================================

/** A single event in a script with its delay offset */
export interface ScriptEvent {
  /** Milliseconds to wait before emitting this event */
  delay: number;
  /** The event to emit */
  event: Message;
}

/** Callback signature for event handlers */
export type EventHandler = (event: Message) => void;

// ============================================================================
// ScriptPlayer
// ============================================================================

/**
 * Plays a sequence of timed events.
 *
 * Usage:
 * ```ts
 * const player = new ScriptPlayer(DEMO_SCRIPT);
 * player.subscribe((event) => console.log(event));
 * await player.play();
 * ```
 */
export class ScriptPlayer {
  private script: ScriptEvent[];
  private handlers: Set<EventHandler> = new Set();
  private abortController: AbortController | null = null;
  private isPlaying = false;

  constructor(script: ScriptEvent[]) {
    this.script = script;
  }

  /**
   * Subscribe to events emitted during playback.
   * @returns Unsubscribe function
   */
  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Whether playback is currently in progress.
   */
  get playing(): boolean {
    return this.isPlaying;
  }

  /**
   * Play through the entire script with delays.
   * Resolves when playback completes or is stopped.
   */
  async play(): Promise<void> {
    if (this.isPlaying) {
      return;
    }

    this.isPlaying = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    for (const { delay, event } of this.script) {
      if (signal.aborted) {
        break;
      }

      // Wait for delay
      await this.delay(delay, signal);

      if (signal.aborted) {
        break;
      }

      // Emit to all handlers
      this.emit(event);
    }

    this.isPlaying = false;
    this.abortController = null;
  }

  /**
   * Stop playback immediately.
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private emit(event: Message): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (ms === 0) {
        resolve();
        return;
      }

      const timeout = setTimeout(resolve, ms);

      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
    });
  }
}

// ============================================================================
// Demo Script
// ============================================================================

/**
 * Build the demo script with fresh message IDs.
 * Must be called each time you need a fresh script to get consistent evt-001, evt-002, etc.
 */
export function buildDemoScript(delayMs: number = 2000): ScriptEvent[] {
  resetMessageCounter();

  return [
    // t=0s: Spawn orchestrator
    {
      delay: 0,
      event: createMessage<'agent.spawn'>('agent.spawn', 'hub', 'broadcast', {
        agentId: 'orchestrator-1',
        role: 'orchestrator',
        systemPrompt: 'Coordinate worker agents to complete tasks',
        hex: { q: 0, r: 0 },
        connections: ['worker-1', 'worker-2'],
      } satisfies SpawnPayload),
    },
    // t=2s: Spawn worker-1
    {
      delay: delayMs,
      event: createMessage<'agent.spawn'>('agent.spawn', 'hub', 'broadcast', {
        agentId: 'worker-1',
        role: 'worker',
        systemPrompt: 'Execute assigned tasks',
        hex: { q: 1, r: 0 },
        connections: ['orchestrator-1'],
      } satisfies SpawnPayload),
    },
    // t=4s: Spawn worker-2
    {
      delay: delayMs,
      event: createMessage<'agent.spawn'>('agent.spawn', 'hub', 'broadcast', {
        agentId: 'worker-2',
        role: 'worker',
        systemPrompt: 'Execute assigned tasks',
        hex: { q: -1, r: 0 },
        connections: ['orchestrator-1'],
      } satisfies SpawnPayload),
    },
    // t=6s: Assign task-1 to worker-1
    {
      delay: delayMs,
      event: createMessage<'task.assign'>('task.assign', 'orchestrator-1', 'worker-1', {
        taskId: 'task-1',
        agentId: 'worker-1',
        description: 'Process data batch A',
      } satisfies TaskAssignPayload),
    },
    // t=8s: Assign task-2 to worker-2
    {
      delay: delayMs,
      event: createMessage<'task.assign'>('task.assign', 'orchestrator-1', 'worker-2', {
        taskId: 'task-2',
        agentId: 'worker-2',
        description: 'Process data batch B',
      } satisfies TaskAssignPayload),
    },
    // t=10s: Progress on task-1
    {
      delay: delayMs,
      event: createMessage<'task.progress'>('task.progress', 'worker-1', 'orchestrator-1', {
        taskId: 'task-1',
        progress: 0.5,
        message: 'Halfway through batch A',
      } satisfies TaskProgressPayload),
    },
    // t=12s: Progress on task-2
    {
      delay: delayMs,
      event: createMessage<'task.progress'>('task.progress', 'worker-2', 'orchestrator-1', {
        taskId: 'task-2',
        progress: 0.5,
        message: 'Halfway through batch B',
      } satisfies TaskProgressPayload),
    },
    // t=14s: Complete task-1
    {
      delay: delayMs,
      event: createMessage<'task.complete'>('task.complete', 'worker-1', 'orchestrator-1', {
        taskId: 'task-1',
        result: { recordsProcessed: 1000 },
      } satisfies TaskCompletePayload),
    },
    // t=16s: Complete task-2
    {
      delay: delayMs,
      event: createMessage<'task.complete'>('task.complete', 'worker-2', 'orchestrator-1', {
        taskId: 'task-2',
        result: { recordsProcessed: 1200 },
      } satisfies TaskCompletePayload),
    },
  ];
}

/**
 * Pre-built demo script with 2-second delays.
 * 9 events, 16 seconds total playback.
 */
export const DEMO_SCRIPT: ScriptEvent[] = buildDemoScript(2000);
