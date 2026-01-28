import { create } from 'zustand';
import type {
  AgentStatus,
  AgentRole,
  CellType,
} from '@protocol/types';
import type { HexCoordinate } from '@shared/types';
import type { DetailedStatus, AgentMessage } from '@terminal/types';
import { useEventLogStore } from './eventLogStore';

export interface AgentState {
  id: string;
  role: AgentRole;
  cellType: CellType;
  status: AgentStatus;
  /** Fine-grained 7-state status for orchestrators */
  detailedStatus: DetailedStatus;
  /** Optional status message from report_status */
  statusMessage?: string;
  systemPrompt: string;
  hex: HexCoordinate;
  connections: string[];
  /** Optional initial prompt passed as CLI arg when spawning Claude */
  initialPrompt?: string;
  /** Parent agent ID (for workers spawned by orchestrators) */
  parentId?: string;
  /** Parent agent hex position (stored at spawn time, not looked up) */
  parentHex?: HexCoordinate;
  /** Task assigned to this worker (short description) */
  task?: string;
  /** Instructions for worker (prompt sent to Claude) */
  instructions?: string;
  taskDetails?: string;
  /** Message inbox for receiving results and broadcasts */
  inbox: AgentMessage[];
}

export interface SpawnOptions {
  initialPrompt?: string;
  parentId?: string;
  parentHex?: HexCoordinate;
  task?: string;
  instructions?: string;
  taskDetails?: string;
}

interface AgentStore {
  agents: Map<string, AgentState>;
  clear: () => void;
  getAgent: (id: string) => AgentState | undefined;
  getAllAgents: () => AgentState[];
  // Direct spawn (for user-initiated placement, not event-driven)
  spawnAgent: (hex: HexCoordinate, cellType?: CellType, options?: SpawnOptions) => string;
  // Remove agent (for user-initiated kill)
  removeAgent: (id: string) => void;
  // Update detailed status (from report_status MCP tool)
  updateDetailedStatus: (agentId: string, status: DetailedStatus, message?: string) => DetailedStatus | undefined;
  // Inbox operations for bilateral communication
  addMessageToInbox: (agentId: string, message: AgentMessage) => boolean;
  getMessages: (agentId: string, since?: string) => AgentMessage[];
}

export const useAgentStore = create<AgentStore>()((set, get) => ({
  agents: new Map(),

  clear: () => set({ agents: new Map() }),
  getAgent: (id) => get().agents.get(id),
  getAllAgents: () => Array.from(get().agents.values()),

  spawnAgent: (hex, cellType = 'terminal', options = {}) => {
    const { initialPrompt, parentId, parentHex, task, instructions, taskDetails } = options;
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Role maps from cellType: orchestrator cells are orchestrators, terminal cells are workers
    const role: AgentRole = cellType === 'orchestrator' ? 'orchestrator' : 'worker';
    set((s) => ({
      agents: new Map(s.agents).set(id, {
        id,
        role,
        cellType,
        status: 'idle',
        detailedStatus: 'idle',
        systemPrompt: '',
        hex,
        connections: parentId ? [parentId] : [],
        initialPrompt,
        parentId,
        parentHex,
        task,
        instructions,
        taskDetails,
        inbox: [],
      }),
    }));
    console.log('[AgentStore] User spawned agent:', id, 'type:', cellType, 'at', hex, parentId ? `parent: ${parentId}` : '', task ? `task: ${task}` : '');
    return id;
  },

  removeAgent: (id) => {
    set((s) => {
      const next = new Map(s.agents);
      next.delete(id);
      return { agents: next };
    });
    console.log('[AgentStore] Removed agent:', id);
  },

  updateDetailedStatus: (agentId, status, message) => {
    const existing = get().agents.get(agentId);
    if (!existing) {
      console.warn('[AgentStore] Cannot update status: agent not found:', agentId);
      return undefined;
    }
    const previousStatus = existing.detailedStatus;
    set((s) => ({
      agents: new Map(s.agents).set(agentId, {
        ...existing,
        detailedStatus: status,
        statusMessage: message,
      }),
    }));
    console.log('[AgentStore] Status updated:', agentId, previousStatus, '->', status);
    return previousStatus;
  },

  addMessageToInbox: (agentId, message) => {
    const existing = get().agents.get(agentId);
    if (!existing) {
      console.warn('[AgentStore] Cannot add message: agent not found:', agentId);
      return false;
    }
    set((s) => ({
      agents: new Map(s.agents).set(agentId, {
        ...existing,
        inbox: [...existing.inbox, message],
      }),
    }));
    console.log('[AgentStore] Message added to inbox:', agentId, 'from:', message.from, 'type:', message.type);
    // Log to event store for visibility in EventLog
    useEventLogStore.getState().addMessageReceived(
      agentId,
      message.from,
      message.type,
      message.payload
    );
    return true;
  },

  getMessages: (agentId, since) => {
    const existing = get().agents.get(agentId);
    if (!existing) {
      console.warn('[AgentStore] Cannot get messages: agent not found:', agentId);
      return [];
    }

    let messagesToReturn: AgentMessage[];
    let remainingMessages: AgentMessage[];

    if (!since) {
      // Return all messages, clear inbox
      messagesToReturn = existing.inbox;
      remainingMessages = [];
    } else {
      // Return messages after timestamp, keep older ones
      const sinceTime = new Date(since).getTime();
      messagesToReturn = existing.inbox.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
      remainingMessages = existing.inbox.filter((m) => new Date(m.timestamp).getTime() <= sinceTime);
    }

    // Auto-consume: remove returned messages from inbox
    if (messagesToReturn.length > 0) {
      set((s) => ({
        agents: new Map(s.agents).set(agentId, {
          ...existing,
          inbox: remainingMessages,
        }),
      }));
      console.log('[AgentStore] Consumed', messagesToReturn.length, 'messages from inbox:', agentId);
    }

    return messagesToReturn;
  },
}));
