import { create } from 'zustand';
import type {
  Message,
  AgentStatus,
  AgentRole,
  CellType,
  SpawnPayload,
  StatusPayload,
  DespawnPayload,
} from '@protocol/types';
import type { HexCoordinate } from '@shared/types';
import type { DetailedStatus } from '@terminal/types';

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
}

interface AgentStore {
  agents: Map<string, AgentState>;
  processEvent: (event: Message) => void;
  clear: () => void;
  getAgent: (id: string) => AgentState | undefined;
  getAllAgents: () => AgentState[];
  // Direct spawn (for user-initiated placement, not event-driven)
  spawnAgent: (hex: HexCoordinate, cellType?: CellType) => string;
  // Remove agent (for user-initiated kill)
  removeAgent: (id: string) => void;
  // Update detailed status (from report_status MCP tool)
  updateDetailedStatus: (agentId: string, status: DetailedStatus, message?: string) => DetailedStatus | undefined;
}

export const useAgentStore = create<AgentStore>()((set, get) => ({
  agents: new Map(),

  processEvent: (event) => {
    switch (event.type) {
      case 'agent.spawn': {
        const p = event.payload as SpawnPayload;
        set((s) => ({
          agents: new Map(s.agents).set(p.agentId, {
            id: p.agentId,
            role: p.role,
            cellType: p.role === 'orchestrator' ? 'orchestrator' : 'terminal',
            status: 'idle',
            detailedStatus: 'idle',
            systemPrompt: p.systemPrompt,
            hex: p.hex,
            connections: p.connections,
          }),
        }));
        console.log('[AgentStore] Spawned:', p.agentId);
        break;
      }
      case 'agent.status': {
        const p = event.payload as StatusPayload;
        const existing = get().agents.get(p.agentId);
        if (existing) {
          set((s) => ({
            agents: new Map(s.agents).set(p.agentId, { ...existing, status: p.status }),
          }));
        }
        break;
      }
      case 'agent.despawn': {
        const p = event.payload as DespawnPayload;
        set((s) => {
          const next = new Map(s.agents);
          next.delete(p.agentId);
          return { agents: next };
        });
        break;
      }
    }
  },

  clear: () => set({ agents: new Map() }),
  getAgent: (id) => get().agents.get(id),
  getAllAgents: () => Array.from(get().agents.values()),

  spawnAgent: (hex, cellType = 'terminal') => {
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
        connections: [],
      }),
    }));
    console.log('[AgentStore] User spawned agent:', id, 'type:', cellType, 'at', hex);
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
}));
