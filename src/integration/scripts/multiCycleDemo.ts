/**
 * Multi-Cycle Demo Integration Test
 *
 * Demonstrates full bilateral communication across multiple cycles:
 * 1. Orchestrator spawns worker 1 with task "Count files"
 * 2. Worker 1 reports result back to parent
 * 3. Orchestrator receives result via push notification (IMAP IDLE style)
 * 4. Orchestrator spawns worker 2 with task "Check disk space"
 * 5. Worker 2 reports result back to parent
 * 6. Orchestrator receives result via push notification
 * 7. Orchestrator reports done
 *
 * This shows the complete cycle: spawn -> task -> result -> push notify -> repeat
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';

/**
 * Orchestrator prompt for multi-cycle workflow.
 * Uses await_worker to poll until worker completes.
 *
 * CRITICAL: Do NOT report "done" until BOTH await_worker calls have returned.
 */
const ORCHESTRATOR_PROMPT = `You are an orchestrator. Execute these steps IN EXACT ORDER:

CYCLE 1:
1. spawn_agent with task="Count files" - save the agentId
2. await_worker with workerId=<that agentId> - WAIT for it to return
3. Log what await_worker returned

CYCLE 2:
4. spawn_agent with task="Check disk space" - save the agentId
5. await_worker with workerId=<that agentId> - WAIT for it to return
6. Log what await_worker returned

FINISH (only after BOTH await_worker calls have completed):
7. report_status with state="done" message="Both cycles complete"

RULES:
- Do NOT report "done" until BOTH await_worker calls have returned
- Do NOT create files
- Execute immediately`;

/**
 * Create the multi-cycle demo integration test.
 */
export function createMultiCycleDemoTest(stores: ConditionStores): IntegrationTest {
  let orchestratorId: string | null = null;
  let worker1Id: string | null = null;
  let worker2Id: string | null = null;

  return {
    config: {
      name: 'Multi-Cycle Demo',
      description: 'Full bilateral loop: spawn, task, result, push notification across 2 cycles',
      timeout: 8 * 60 * 1000, // 8 minutes total
    },
    steps: [
      // Step 1: Spawn orchestrator with multi-cycle prompt
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: ORCHESTRATOR_PROMPT,
      },

      // Step 2: Wait for orchestrator to be registered
      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator agent initialized',
          predicate: () => {
            const agents = stores.getAllAgents();
            const orchestrator = agents.find((a) => a.cellType === 'orchestrator');
            if (orchestrator) {
              orchestratorId = orchestrator.id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.claudeStartup,
        },
      },

      // Step 3: Wait for worker 1 to spawn with task
      {
        type: 'wait_condition',
        condition: {
          description: 'worker 1 spawned with task',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            if (workers.length >= 1) {
              const worker = workers[0];
              if (worker.task && worker.parentId === orchestratorId) {
                worker1Id = worker.id;
                return true;
              }
            }
            return false;
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Step 4: Assert worker 1 has correct parent
      {
        type: 'assert',
        description: 'worker 1 has correct parent',
        predicate: () => {
          if (!worker1Id || !orchestratorId) return false;
          const worker = stores.getAgent(worker1Id);
          return worker?.parentId === orchestratorId;
        },
      },

      // Step 5: Wait for worker 1 to report done
      {
        type: 'wait_condition',
        condition: {
          description: 'worker 1 reports done',
          predicate: () => {
            if (!worker1Id) return false;
            const worker = stores.getAgent(worker1Id);
            return worker?.detailedStatus === 'done';
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 6: Wait for worker 2 to spawn with task
      // (This implies orchestrator received worker 1's result and moved to cycle 2)
      {
        type: 'wait_condition',
        condition: {
          description: 'worker 2 spawned with task',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            // Worker 2 is the second worker (not worker 1)
            const worker2 = workers.find(
              (w) => w.id !== worker1Id && w.task && w.parentId === orchestratorId
            );
            if (worker2) {
              worker2Id = worker2.id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Step 7: Assert worker 2 has correct parent
      {
        type: 'assert',
        description: 'worker 2 has correct parent',
        predicate: () => {
          if (!worker2Id || !orchestratorId) return false;
          const worker = stores.getAgent(worker2Id);
          return worker?.parentId === orchestratorId;
        },
      },

      // Step 8: Wait for worker 2 to report done
      {
        type: 'wait_condition',
        condition: {
          description: 'worker 2 reports done',
          predicate: () => {
            if (!worker2Id) return false;
            const worker = stores.getAgent(worker2Id);
            return worker?.detailedStatus === 'done';
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 9: Wait for orchestrator to report done
      // (This implies it received and processed both workers' results)
      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator reports done',
          predicate: () => {
            if (!orchestratorId) return false;
            const agent = stores.getAgent(orchestratorId);
            return agent?.detailedStatus === 'done';
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 10: Assert 2 workers exist with done status
      {
        type: 'assert',
        description: '2 workers exist with done status',
        predicate: () => {
          const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
          if (workers.length !== 2) return false;
          return workers.every((w) => w.detailedStatus === 'done');
        },
      },

      // Step 11: Final verification - all agents completed successfully
      // Note: inbox is auto-consumed, so we verify via status not inbox contents
      {
        type: 'assert',
        description: 'all agents completed successfully',
        predicate: () => {
          if (!orchestratorId) return false;
          const orchestrator = stores.getAgent(orchestratorId);
          const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
          return (
            orchestrator?.detailedStatus === 'done' &&
            workers.length === 2 &&
            workers.every((w) => w.detailedStatus === 'done')
          );
        },
      },
    ],
  };
}
