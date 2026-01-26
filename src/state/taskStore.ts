import { create } from 'zustand';
import type {
  Message,
  TaskAssignPayload,
  TaskProgressPayload,
  TaskCompletePayload,
  TaskFailPayload,
} from '@protocol/types';

export type TaskStatus = 'assigned' | 'in_progress' | 'complete' | 'failed';

export interface TaskState {
  id: string;
  agentId: string;
  description: string;
  status: TaskStatus;
  progress: number;
  message?: string;
  error?: string;
}

interface TaskStore {
  tasks: Map<string, TaskState>;
  processEvent: (event: Message) => void;
  getTasksByAgent: (agentId: string) => TaskState[];
  clear: () => void;
}

export const useTaskStore = create<TaskStore>()((set, get) => ({
  tasks: new Map(),

  processEvent: (event) => {
    if (!event.type.startsWith('task.')) return;

    set((s) => {
      const next = new Map(s.tasks);
      switch (event.type) {
        case 'task.assign': {
          const p = event.payload as TaskAssignPayload;
          next.set(p.taskId, {
            id: p.taskId,
            agentId: p.agentId,
            description: p.description,
            status: 'assigned',
            progress: 0,
          });
          break;
        }
        case 'task.progress': {
          const p = event.payload as TaskProgressPayload;
          const existing = next.get(p.taskId);
          if (existing) {
            next.set(p.taskId, { ...existing, status: 'in_progress', progress: p.progress, message: p.message });
          }
          break;
        }
        case 'task.complete': {
          const p = event.payload as TaskCompletePayload;
          const existing = next.get(p.taskId);
          if (existing) {
            next.set(p.taskId, { ...existing, status: 'complete', progress: 1.0 });
          }
          break;
        }
        case 'task.fail': {
          const p = event.payload as TaskFailPayload;
          const existing = next.get(p.taskId);
          if (existing) {
            next.set(p.taskId, { ...existing, status: 'failed', error: p.error });
          }
          break;
        }
      }
      return { tasks: next };
    });
  },

  getTasksByAgent: (agentId) => Array.from(get().tasks.values()).filter((t) => t.agentId === agentId),
  clear: () => set({ tasks: new Map() }),
}));
