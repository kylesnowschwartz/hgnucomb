/**
 * HUD Showcase Integration Test
 *
 * Visual showcase of HUD-first observability features:
 *   - Worker progress satellite ("0/3" below orchestrator badge, ticks up)
 *   - Status transition flash (green on done, red on error -- 400ms hex overlay)
 *   - Elapsed time satellite (ticking "Xm" above each hex badge)
 *   - Activity data from server broadcast (createdAt, lastActivityAt)
 *   - AgentDetailsWidget in MetaPanel (open MetaPanel to inspect)
 *
 * Spawns an orchestrator that spawns 3 workers with staggered behaviors:
 *   Worker 1 "Quick task": working 3s → done (green flash)
 *   Worker 2 "Status showcase": working 3s → waiting_input 8s → working 3s → done (green flash)
 *   Worker 3 "Error case": working 8s → error (red flash)
 *
 * Timing is designed so completions are visually spaced for human observation.
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { agentsByTypeCount } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';
import { TERMINAL_STATUSES } from '@shared/types';

// ============================================================================
// Orchestrator prompt
// ============================================================================

const ORCHESTRATOR_TASK = `You are an orchestrator. Execute these steps IN ORDER:

STEP 1: Spawn 3 workers (execute all 3 spawn_agent calls before proceeding)

Worker 1 - Call spawn_agent with:
  task="Quick task"
  instructions="Execute these steps exactly: 1) Call report_status with state='working' message='Processing quick task'. 2) Wait 3 seconds (pause, do nothing). 3) Call report_result with result='Quick task done'. 4) Call report_status with state='done'."

Worker 2 - Call spawn_agent with:
  task="Status showcase"
  instructions="Execute these steps exactly with pauses between each: 1) Call report_status with state='working' message='Starting analysis'. 2) Wait 3 seconds. 3) Call report_status with state='waiting_input' message='Need design clarification'. 4) Wait 8 seconds. 5) Call report_status with state='working' message='Resumed after input'. 6) Wait 3 seconds. 7) Call report_result with result='Status showcase complete'. 8) Call report_status with state='done'."

Worker 3 - Call spawn_agent with:
  task="Error case"
  instructions="Execute these steps exactly: 1) Call report_status with state='working' message='Attempting merge'. 2) Wait 8 seconds. 3) Call report_status with state='error' message='Cannot resolve merge conflict'. 4) Call report_result with result='Failed: unresolvable conflict'."

STEP 2: Wait for all workers to finish
- Call await_worker with workerId=<worker1 agentId>
- Call await_worker with workerId=<worker2 agentId>
- Call await_worker with workerId=<worker3 agentId>

STEP 3: Report done
- Call report_status with state="done" message="All 3 workers completed"

RULES:
- Do NOT report done until ALL 3 await_worker calls have returned
- Do NOT create any files
- Execute immediately without asking questions`;

// ============================================================================
// Test factory
// ============================================================================

export function createHudShowcaseTest(stores: ConditionStores): IntegrationTest {
  let orchestratorId: string | null = null;

  return {
    config: {
      name: 'HUD Showcase',
      description: 'Visual test: progress satellites, status flash, elapsed time, activity data',
      timeout: 6 * 60 * 1000,
    },
    steps: [
      // ---- Setup: spawn orchestrator and workers ----

      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: ORCHESTRATOR_TASK,
      },

      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator initialized',
          predicate: () => {
            const orch = stores.getAllAgents().find((a) => a.cellType === 'orchestrator');
            if (orch) {
              orchestratorId = orch.id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.claudeStartup,
        },
      },

      {
        type: 'wait_condition',
        condition: agentsByTypeCount(stores, 'worker', 3, TIMEOUTS.agentSpawn),
      },

      {
        type: 'assert',
        description: '3 workers parented to orchestrator (progress satellite shows 0/3)',
        predicate: () => {
          if (!orchestratorId) return false;
          const workers = stores
            .getAllAgents()
            .filter((a) => a.cellType === 'worker' && a.parentId === orchestratorId);
          return workers.length === 3;
        },
      },

      // ---- Verify activity data (elapsed time satellite) ----

      {
        type: 'wait_condition',
        condition: {
          description: 'server activity broadcast populates createdAt (elapsed time satellite)',
          predicate: () => {
            if (!orchestratorId) return false;
            const orch = stores.getAgent(orchestratorId);
            return orch?.createdAt != null && orch.createdAt > 0;
          },
          timeout: 15_000,
        },
      },

      {
        type: 'assert',
        description: 'orchestrator has createdAt + lastActivityAt from server',
        predicate: () => {
          if (!orchestratorId) return false;
          const orch = stores.getAgent(orchestratorId);
          return (
            orch?.createdAt != null &&
            orch.createdAt > 0 &&
            orch?.lastActivityAt != null &&
            orch.lastActivityAt > 0
          );
        },
      },

      // ---- Watch workers complete (progress satellite ticks, flashes fire) ----

      {
        type: 'wait_condition',
        condition: {
          description: 'first worker reaches terminal status (flash fires)',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            return workers.some((w) => TERMINAL_STATUSES.has(w.detailedStatus));
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      {
        type: 'assert',
        description: 'progress satellite shows partial completion (N/3 where 0 < N < 3)',
        predicate: () => {
          if (!orchestratorId) return false;
          const workers = stores
            .getAllAgents()
            .filter((a) => a.cellType === 'worker' && a.parentId === orchestratorId);
          const doneCount = workers.filter((w) =>
            TERMINAL_STATUSES.has(w.detailedStatus)
          ).length;
          return doneCount >= 1 && doneCount < 3;
        },
      },

      {
        type: 'wait_condition',
        condition: {
          description: 'all 3 workers in terminal status (progress satellite shows 3/3)',
          predicate: () => {
            if (!orchestratorId) return false;
            const workers = stores
              .getAllAgents()
              .filter((a) => a.cellType === 'worker' && a.parentId === orchestratorId);
            return (
              workers.length === 3 &&
              workers.every((w) => TERMINAL_STATUSES.has(w.detailedStatus))
            );
          },
          timeout: 3 * 60 * 1000, // workers are staggered, give them time
        },
      },

      {
        type: 'assert',
        description: 'final worker states: 2 done + 1 error',
        predicate: () => {
          if (!orchestratorId) return false;
          const workers = stores
            .getAllAgents()
            .filter((a) => a.cellType === 'worker' && a.parentId === orchestratorId);
          const doneCount = workers.filter((w) => w.detailedStatus === 'done').length;
          const errorCount = workers.filter((w) => w.detailedStatus === 'error').length;
          return doneCount === 2 && errorCount === 1;
        },
      },

      // ---- Orchestrator completes ----

      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator reports done (green flash on orchestrator cell)',
          predicate: () => {
            if (!orchestratorId) return false;
            return stores.getAgent(orchestratorId)?.detailedStatus === 'done';
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // ---- Final verification: all HUD data present ----

      {
        type: 'assert',
        description: 'all HUD data present: activity, progress 3/3, orchestrator done',
        predicate: () => {
          if (!orchestratorId) return false;
          const orch = stores.getAgent(orchestratorId);
          const workers = stores
            .getAllAgents()
            .filter((a) => a.cellType === 'worker' && a.parentId === orchestratorId);

          const hasActivity = orch?.createdAt != null && orch.lastActivityAt != null;
          const allTerminal =
            workers.length === 3 &&
            workers.every((w) => TERMINAL_STATUSES.has(w.detailedStatus));
          const orchDone = orch?.detailedStatus === 'done';

          return hasActivity && allTerminal && orchDone;
        },
      },
    ],
  };
}
