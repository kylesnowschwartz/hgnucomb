import { create } from 'zustand';
import type {
  Message,
  AgentStatus,
  AgentRole,
  SpawnPayload,
  StatusPayload,
  DespawnPayload,
} from '@protocol/types';
import type { HexCoordinate } from '@shared/types';

export interface AgentState {
  id: string;
  role: AgentRole;
  status: AgentStatus;
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
            status: 'idle',
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
}));
