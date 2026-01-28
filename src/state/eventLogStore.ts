/**
 * Unified event log store for broadcasts and lifecycle events.
 *
 * Provides a single timeline for all agent activity:
 * - Broadcasts (spatial messages between agents)
 * - Lifecycle events (spawn, kill, status change)
 */

import { create } from 'zustand';
import type { HexCoordinate } from '@shared/types';
import type { DetailedStatus } from '@terminal/types';

// ============================================================================
// Event Types
// ============================================================================

interface BaseEvent {
  id: string;
  timestamp: string;
}

export interface BroadcastEvent extends BaseEvent {
  kind: 'broadcast';
  senderId: string;
  senderHex: HexCoordinate;
  broadcastType: string;
  radius: number;
  recipientCount: number;
  payloadPreview: string;
}

export interface SpawnEvent extends BaseEvent {
  kind: 'spawn';
  agentId: string;
  cellType: 'terminal' | 'orchestrator' | 'worker';
  hex: HexCoordinate;
}

export interface KillEvent extends BaseEvent {
  kind: 'kill';
  agentId: string;
}

export interface StatusChangeEvent extends BaseEvent {
  kind: 'status_change';
  agentId: string;
  previousStatus?: DetailedStatus;
  newStatus: DetailedStatus;
  message?: string;
}

export interface MessageReceivedEvent extends BaseEvent {
  kind: 'message_received';
  recipientId: string;
  senderId: string;
  messageType: 'result' | 'broadcast';
  payloadPreview: string;
}

export type LogEvent = BroadcastEvent | SpawnEvent | KillEvent | StatusChangeEvent | MessageReceivedEvent;

// ============================================================================
// Store
// ============================================================================

interface EventLogStore {
  events: LogEvent[];
  maxEvents: number;

  // Actions
  addEvent: (event: Omit<LogEvent, 'id' | 'timestamp'>) => void;
  addBroadcast: (
    senderId: string,
    senderHex: HexCoordinate,
    broadcastType: string,
    radius: number,
    recipientCount: number,
    payload: unknown
  ) => void;
  addSpawn: (agentId: string, cellType: 'terminal' | 'orchestrator' | 'worker', hex: HexCoordinate) => void;
  addKill: (agentId: string) => void;
  addStatusChange: (
    agentId: string,
    newStatus: DetailedStatus,
    message?: string,
    previousStatus?: DetailedStatus
  ) => void;
  addMessageReceived: (
    recipientId: string,
    senderId: string,
    messageType: 'result' | 'broadcast',
    payload: unknown
  ) => void;
  clear: () => void;
}

let eventCounter = 0;

function nextEventId(): string {
  return `evt-${++eventCounter}-${Date.now()}`;
}

function truncatePayload(payload: unknown, maxLen = 80): string {
  try {
    const str = JSON.stringify(payload);
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  } catch {
    return '[unserializable]';
  }
}

export const useEventLogStore = create<EventLogStore>()((set) => ({
  events: [],
  maxEvents: 500,

  addEvent: (eventData) => {
    const event = {
      ...eventData,
      id: nextEventId(),
      timestamp: new Date().toISOString(),
    } as LogEvent;

    set((state) => {
      const events = [...state.events, event];
      // Trim to maxEvents (FIFO)
      if (events.length > state.maxEvents) {
        return { events: events.slice(-state.maxEvents) };
      }
      return { events };
    });
  },

  addBroadcast: (senderId, senderHex, broadcastType, radius, recipientCount, payload) => {
    set((state) => {
      const event: BroadcastEvent = {
        id: nextEventId(),
        timestamp: new Date().toISOString(),
        kind: 'broadcast',
        senderId,
        senderHex,
        broadcastType,
        radius,
        recipientCount,
        payloadPreview: truncatePayload(payload),
      };
      const events = [...state.events, event];
      if (events.length > state.maxEvents) {
        return { events: events.slice(-state.maxEvents) };
      }
      return { events };
    });
  },

  addSpawn: (agentId, cellType, hex) => {
    set((state) => {
      const event: SpawnEvent = {
        id: nextEventId(),
        timestamp: new Date().toISOString(),
        kind: 'spawn',
        agentId,
        cellType,
        hex,
      };
      const events = [...state.events, event];
      if (events.length > state.maxEvents) {
        return { events: events.slice(-state.maxEvents) };
      }
      return { events };
    });
  },

  addKill: (agentId) => {
    set((state) => {
      const event: KillEvent = {
        id: nextEventId(),
        timestamp: new Date().toISOString(),
        kind: 'kill',
        agentId,
      };
      const events = [...state.events, event];
      if (events.length > state.maxEvents) {
        return { events: events.slice(-state.maxEvents) };
      }
      return { events };
    });
  },

  addStatusChange: (agentId, newStatus, message, previousStatus) => {
    set((state) => {
      const event: StatusChangeEvent = {
        id: nextEventId(),
        timestamp: new Date().toISOString(),
        kind: 'status_change',
        agentId,
        newStatus,
        message,
        previousStatus,
      };
      const events = [...state.events, event];
      if (events.length > state.maxEvents) {
        return { events: events.slice(-state.maxEvents) };
      }
      return { events };
    });
  },

  addMessageReceived: (recipientId, senderId, messageType, payload) => {
    set((state) => {
      const event: MessageReceivedEvent = {
        id: nextEventId(),
        timestamp: new Date().toISOString(),
        kind: 'message_received',
        recipientId,
        senderId,
        messageType,
        payloadPreview: truncatePayload(payload),
      };
      const events = [...state.events, event];
      if (events.length > state.maxEvents) {
        return { events: events.slice(-state.maxEvents) };
      }
      return { events };
    });
  },

  clear: () => set({ events: [] }),
}));
