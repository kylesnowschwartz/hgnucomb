/**
 * Bilateral Communication Integration Test
 *
 * Tests the complete task assignment and result reporting flow:
 * 1. Spawn orchestrator with a task prompt
 * 2. Orchestrator spawns a worker with a task assignment
 * 3. Worker receives task in context
 * 4. Worker reports result to parent
 * 5. Orchestrator polls and receives the result
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';

/**
 * Task prompt sent to the orchestrator.
 * Instructs it to spawn a worker with a task and wait for results.
 */
const ORCHESTRATOR_TASK = `You are an orchestrator in a multi-agent test system.

Your task:
1. Spawn exactly ONE worker agent using spawn_agent with:
   - task="Test bilateral communication"
   - instructions="You are a test worker. Confirm you received this message. Use report_result to send result 'Message received successfully' to your parent. Then use report_status with state='done'."
2. Wait 10 seconds for the worker to complete
3. Poll your inbox using get_messages to check for the worker's result
4. Report your status as "done" using report_status

IMPORTANT:
- Do NOT create any files
- Do NOT modify any code
- Only use MCP tools: spawn_agent, get_messages, report_status
- Execute immediately without asking questions

Begin now.`;

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

      // Step 6: Verify orchestrator received message in inbox
      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator has message in inbox',
          predicate: () => {
            if (!orchestratorId) return false;
            const orchestrator = stores.getAgent(orchestratorId);
            return !!(orchestrator?.inbox && orchestrator.inbox.length > 0);
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 7: Wait for orchestrator to report done
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

      // Step 8: Final verification
      {
        type: 'assert',
        description: 'message in inbox is a result from worker',
        predicate: () => {
          if (!orchestratorId || !workerId) return false;
          const orchestrator = stores.getAgent(orchestratorId);
          if (!orchestrator?.inbox || orchestrator.inbox.length === 0) return false;
          const resultMsg = orchestrator.inbox.find(
            (m) => m.from === workerId && m.type === 'result'
          );
          return resultMsg !== undefined ? true : false;
        },
      },
    ],
  };
}

/**
 * Simpler test that just verifies task assignment at spawn time.
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
        initialPrompt: `Spawn one worker with task="${TEST_TASK}" and instructions="Acknowledge task receipt. Report done." then report_status done. Do not create files.`,
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
