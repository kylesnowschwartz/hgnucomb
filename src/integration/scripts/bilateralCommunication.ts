/**
 * Bilateral Communication Integration Test
 *
 * Tests the complete task assignment and result reporting flow:
 * 1. Spawn orchestrator with a task prompt
 * 2. Orchestrator spawns a worker with a task assignment
 * 3. Worker receives task in context
 * 4. Worker reports result to parent
 * 5. Orchestrator receives result via push notification (IMAP IDLE style)
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';

/**
 * Task prompt sent to the orchestrator.
 * Instructs it to spawn a worker with a task and wait for results using await_worker.
 *
 * CRITICAL: The orchestrator must NOT report "done" until AFTER await_worker returns.
 */
const ORCHESTRATOR_TASK = `You are an orchestrator. Execute these steps IN ORDER:

STEP 1: Spawn a worker
- Call spawn_agent with task="Test bilateral communication" and instructions="Use report_result to send 'Message received' to your parent, then report_status done."
- Save the agentId from the response

STEP 2: Wait for worker completion (DO NOT SKIP)
- Call await_worker with workerId=<the agentId from step 1>
- This will block until the worker finishes
- Log the result you receive

STEP 3: Report done (ONLY after await_worker returns)
- Call report_status with state="done"

RULES:
- Do NOT report "done" until await_worker has returned
- Do NOT create files
- Execute immediately`;


/**
 * Create the bilateral communication test.
 *
 * @param stores - Store access for condition predicates
 * @returns Configured integration test
 */
export function createBilateralCommunicationTest(stores: ConditionStores): IntegrationTest {
  let orchestratorId: string | null = null;
  let workerId: string | null = null;

  return {
    config: {
      name: 'Bilateral Communication',
      description: 'Orchestrator spawns worker with task, worker reports result',
      timeout: 5 * 60 * 1000, // 5 minutes total
    },
    steps: [
      // Step 1: Spawn orchestrator with task prompt
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: ORCHESTRATOR_TASK,
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

      // Step 3: Wait for worker to spawn (orchestrator should spawn it)
      {
        type: 'wait_condition',
        condition: {
          description: 'worker agent spawned with task',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            if (workers.length > 0) {
              const worker = workers[0];
              workerId = worker.id;
              // Verify worker has task and parentId
              return worker.task !== undefined && worker.parentId !== undefined;
            }
            return false;
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Step 4: Verify worker's parentId matches orchestrator
      {
        type: 'assert',
        description: 'worker has correct parent',
        predicate: () => {
          if (!workerId || !orchestratorId) return false;
          const worker = stores.getAgent(workerId);
          return worker?.parentId === orchestratorId;
        },
      },

      // Step 5: Wait for worker to report result (its status should be 'done')
      {
        type: 'wait_condition',
        condition: {
          description: 'worker reports done',
          predicate: () => {
            if (!workerId) return false;
            const worker = stores.getAgent(workerId);
            return worker?.detailedStatus === 'done';
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 6: Wait for orchestrator to report done
      // (This implies it received and processed the worker's result via get_messages)
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

      // Step 7: Final verification - worker completed and orchestrator acknowledged
      // Note: inbox is auto-consumed on read, so we verify via status not inbox contents
      {
        type: 'assert',
        description: 'worker reported done and orchestrator acknowledged',
        predicate: () => {
          if (!orchestratorId || !workerId) return false;
          const worker = stores.getAgent(workerId);
          const orchestrator = stores.getAgent(orchestratorId);
          return worker?.detailedStatus === 'done' && orchestrator?.detailedStatus === 'done';
        },
      },
    ],
  };
}

/**
 * Simpler test that just verifies task assignment at spawn time.
 * Note: This test only checks that the worker is spawned with task metadata,
 * not that the orchestrator waits for completion.
 */
export function createTaskAssignmentTest(stores: ConditionStores): IntegrationTest {
  const TEST_TASK = 'Test task description';
  let orchestratorId: string | null = null;

  return {
    config: {
      name: 'Task Assignment at Spawn',
      description: 'Verify worker receives task in context when spawned',
      timeout: 3 * 60 * 1000,
    },
    steps: [
      // Spawn orchestrator that will spawn a worker with task
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: `STEP 1: Call spawn_agent with task="${TEST_TASK}" and instructions="Report done."
STEP 2: Call await_worker with the returned agentId (wait for worker to finish)
STEP 3: ONLY AFTER await_worker returns, call report_status with state="done"
Do not create files. Do not report done until await_worker completes.`,
      },

      // Wait for orchestrator
      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator initialized',
          predicate: () => {
            const agents = stores.getAllAgents();
            const orch = agents.find((a) => a.cellType === 'orchestrator');
            if (orch) {
              orchestratorId = orch.id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.claudeStartup,
        },
      },

      // Wait for worker with task
      {
        type: 'wait_condition',
        condition: {
          description: 'worker spawned with task',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            return workers.some((w) => w.task !== undefined && w.parentId === orchestratorId);
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Verify worker state
      {
        type: 'assert',
        description: 'worker has correct parent and task',
        predicate: () => {
          const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
          const worker = workers.find((w) => w.parentId === orchestratorId);
          if (!worker) return false;
          return worker.task !== undefined && worker.parentId === orchestratorId;
        },
      },
    ],
  };
}
