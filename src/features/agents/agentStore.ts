import { create } from 'zustand';
import type { AgentRole } from '@protocol/types';
import type {
  HexCoordinate,
  AgentStatus,
  CellType,
  DetailedStatus,
} from '@shared/types';
import type { AgentMessage, AgentModel, AgentTelemetryData } from '@shared/protocol';
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
  /** Claude model override (opus/sonnet/haiku). Defaults: orchestrator=opus, worker=sonnet */
  model?: AgentModel;
  /** Target git repo for worker worktree (overrides project-level projectDir) */
  repoPath?: string;
  /** Message inbox for receiving results and broadcasts */
  inbox: AgentMessage[];
  // Activity data (populated by server agent.activity broadcast)
  /** Session creation timestamp (epoch ms) */
  createdAt?: number;
  /** Last PTY output timestamp (epoch ms) */
  lastActivityAt?: number;
  /** Number of git commits in agent's worktree branch */
  gitCommitCount?: number;
  /** Recent commit messages (last 3-5, one-line each) */
  gitRecentCommits?: string[];
  /** Transcript-derived telemetry (from agent.activity broadcast) */
  telemetry?: AgentTelemetryData;
}

export interface SpawnOptions {
  initialPrompt?: string;
  parentId?: string;
  parentHex?: HexCoordinate;
  task?: string;
  instructions?: string;
  taskDetails?: string;
  model?: AgentModel;
  /** Target git repo for worker worktree (overrides project-level projectDir) */
  repoPath?: string;
}

/** Transient flash state for status transition animations (done/error) */
export type FlashType = 'done' | 'error';

interface AgentStore {
  agents: Map<string, AgentState>;
  /** Active flashes: agentId -> flash type. Cleared by HexGrid after animation. */
  flashes: Map<string, FlashType>;
  clear: () => void;
  getAgent: (id: string) => AgentState | undefined;
  getAllAgents: () => AgentState[];
  // Direct spawn (for user-initiated placement, not event-driven)
  spawnAgent: (hex: HexCoordinate, cellType?: CellType, options?: SpawnOptions) => string;
  // Remove agent (for user-initiated kill)
  removeAgent: (id: string) => void;
  // Update agent's cell type (e.g., converting orchestrator to terminal on /exit)
  updateAgentType: (agentId: string, newCellType: CellType) => boolean;
  // Update detailed status (from report_status MCP tool)
  updateDetailedStatus: (agentId: string, status: DetailedStatus, message?: string) => DetailedStatus | undefined;
  // Inbox operations for bilateral communication
  addMessageToInbox: (agentId: string, message: AgentMessage) => boolean;
  getMessages: (agentId: string, since?: string) => AgentMessage[];
  // Flash operations (for hex cell transition animations)
  clearFlash: (agentId: string) => void;
  // Activity data (from server agent.activity broadcast)
  updateActivity: (agentId: string, data: {
    createdAt: number;
    lastActivityAt: number;
    gitCommitCount: number;
    gitRecentCommits: string[];
    telemetry?: AgentTelemetryData;
  }) => void;
  // Batched activity update — single set() for all agents, single re-render.
  // The per-agent updateActivity fires N set() calls for N agents, causing
  // N re-renders of every subscriber (HexGrid, MetaPanel, App). This batched
  // version collects all updates into one Map mutation.
  updateActivities: (updates: Array<{
    agentId: string;
    createdAt: number;
    lastActivityAt: number;
    gitCommitCount: number;
    gitRecentCommits: string[];
    telemetry?: AgentTelemetryData;
  }>) => void;
}

export const useAgentStore = create<AgentStore>()((set, get) => ({
  agents: new Map(),
  flashes: new Map(),

  clear: () => set({ agents: new Map(), flashes: new Map() }),
  getAgent: (id) => get().agents.get(id),
  getAllAgents: () => Array.from(get().agents.values()),

  spawnAgent: (hex, cellType = 'terminal', options = {}) => {
    const { initialPrompt, parentId, parentHex, task, instructions, taskDetails, model, repoPath } = options;
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Role maps from cellType: orchestrator cells are orchestrators, terminal cells are workers
    const role: AgentRole = cellType === 'orchestrator' ? 'orchestrator' : 'worker';
    set((s) => ({
      agents: new Map(s.agents).set(id, {
        id,
        role,
        cellType,
        status: 'idle',
        detailedStatus: cellType === 'terminal' ? 'idle' : 'pending',
        systemPrompt: '',
        hex,
        connections: parentId ? [parentId] : [],
        initialPrompt,
        parentId,
        parentHex,
        task,
        instructions,
        taskDetails,
        model,
        repoPath,
        inbox: [],
      }),
    }));
    return id;
  },

  removeAgent: (id) => {
    set((s) => {
      const next = new Map(s.agents);
      next.delete(id);
      return { agents: next };
    });
  },

  updateAgentType: (agentId, newCellType) => {
    const existing = get().agents.get(agentId);
    if (!existing) return false;
    set((s) => ({
      agents: new Map(s.agents).set(agentId, {
        ...existing,
        cellType: newCellType,
        role: newCellType === 'orchestrator' ? 'orchestrator' : 'worker',
      }),
    }));
    return true;
  },

  updateDetailedStatus: (agentId, status, message) => {
    const existing = get().agents.get(agentId);
    if (!existing) return undefined;
    const previousStatus = existing.detailedStatus;

    // Trigger flash on terminal status transitions (done/error)
    const flashType: FlashType | null =
      status === 'done' && previousStatus !== 'done' ? 'done' :
      status === 'error' && previousStatus !== 'error' ? 'error' :
      null;

    set((s) => {
      const newFlashes = flashType ? new Map(s.flashes).set(agentId, flashType) : s.flashes;
      return {
        agents: new Map(s.agents).set(agentId, {
          ...existing,
          detailedStatus: status,
          statusMessage: message,
        }),
        flashes: newFlashes,
      };
    });
    return previousStatus;
  },

  addMessageToInbox: (agentId, message) => {
    const existing = get().agents.get(agentId);
    if (!existing) return false;
    set((s) => ({
      agents: new Map(s.agents).set(agentId, {
        ...existing,
        inbox: [...existing.inbox, message],
      }),
    }));
    return true;
  },

  clearFlash: (agentId) => {
    set((s) => {
      const next = new Map(s.flashes);
      next.delete(agentId);
      return { flashes: next };
    });
  },

  updateActivity: (agentId, data) => {
    const existing = get().agents.get(agentId);
    if (!existing) return;
    set((s) => ({
      agents: new Map(s.agents).set(agentId, {
        ...existing,
        createdAt: data.createdAt,
        lastActivityAt: data.lastActivityAt,
        gitCommitCount: data.gitCommitCount,
        gitRecentCommits: data.gitRecentCommits,
        // Only overwrite telemetry when present (old broadcasts may lack it)
        ...(data.telemetry ? { telemetry: data.telemetry } : {}),
      }),
    }));
  },

  updateActivities: (updates) => {
    set((s) => {
      const agents = new Map(s.agents);
      for (const data of updates) {
        const existing = agents.get(data.agentId);
        if (!existing) continue;
        agents.set(data.agentId, {
          ...existing,
          createdAt: data.createdAt,
          lastActivityAt: data.lastActivityAt,
          gitCommitCount: data.gitCommitCount,
          gitRecentCommits: data.gitRecentCommits,
          ...(data.telemetry ? { telemetry: data.telemetry } : {}),
        });
      }
      return { agents };
    });
  },

  getMessages: (agentId, since) => {
    const existing = get().agents.get(agentId);
    if (!existing) return [];

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
    }

    return messagesToReturn;
  },
}));
