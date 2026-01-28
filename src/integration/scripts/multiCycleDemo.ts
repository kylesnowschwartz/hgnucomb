/**
 * Multi-Cycle Demo Integration Test
 *
 * Demonstrates full bilateral communication across multiple cycles:
 * 1. Orchestrator spawns worker 1 with task "Count files"
 * 2. Worker 1 reports result back to parent
 * 3. Orchestrator polls inbox, receives result
 * 4. Orchestrator spawns worker 2 with task "Check disk space"
 * 5. Worker 2 reports result back to parent
 * 6. Orchestrator polls inbox, receives result
 * 7. Orchestrator reports done
 *
 * This shows the complete cycle: spawn -> task -> result -> inbox -> repeat
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';

/**
 * Orchestrator prompt for multi-cycle workflow.
 * Uses explicit waits and inbox polling between cycles.
 */
const ORCHESTRATOR_PROMPT = `You are an orchestrator running a multi-cycle test.

Execute these steps IN ORDER:

CYCLE 1:
1. Use spawn_agent with task="Count files" to spawn worker 1
2. Wait 10 seconds for the worker to complete
3. Use get_messages to poll your inbox for the result
4. Log what you received (if anything)

CYCLE 2:
5. Use spawn_agent with task="Check disk space" to spawn worker 2
6. Wait 10 seconds for the worker to complete
7. Use get_messages to poll your inbox for the result
8. Log what you received (if anything)

FINISH:
9. Use report_status with status="done" and message="Both cycles complete"

CRITICAL RULES:
- Do NOT create any files
- Do NOT modify any code
- Only use MCP tools: spawn_agent, get_messages, report_status
- Execute immediately without questions
- Wait the full 10 seconds between spawning and polling

Begin now.`;

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
      description: 'Full bilateral loop: spawn, task, result, inbox polling across 2 cycles',
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

      // Step 6: Wait for orchestrator to have result from worker 1
      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator inbox has result from worker 1',
          predicate: () => {
            if (!orchestratorId || !worker1Id) return false;
            const orchestrator = stores.getAgent(orchestratorId);
            if (!orchestrator?.inbox) return false;
            return orchestrator.inbox.some(
              (m) => m.from === worker1Id && m.type === 'result'
            );
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 7: Wait for worker 2 to spawn with task
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

      // Step 8: Assert worker 2 has correct parent
      {
        type: 'assert',
        description: 'worker 2 has correct parent',
        predicate: () => {
          if (!worker2Id || !orchestratorId) return false;
          const worker = stores.getAgent(worker2Id);
          return worker?.parentId === orchestratorId;
        },
      },

      // Step 9: Wait for worker 2 to report done
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

      // Step 10: Wait for orchestrator to have result from worker 2
      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator inbox has result from worker 2',
          predicate: () => {
            if (!orchestratorId || !worker2Id) return false;
            const orchestrator = stores.getAgent(orchestratorId);
            if (!orchestrator?.inbox) return false;
            return orchestrator.inbox.some(
              (m) => m.from === worker2Id && m.type === 'result'
            );
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 11: Wait for orchestrator to report done
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

      // Step 12: Assert 2 workers exist with done status
      {
        type: 'assert',
        description: '2 workers exist with done status',
        predicate: () => {
          const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
          if (workers.length !== 2) return false;
          return workers.every((w) => w.detailedStatus === 'done');
        },
      },

      // Step 13: Assert orchestrator inbox has 2 result messages
      {
        type: 'assert',
        description: 'orchestrator inbox has 2 result messages',
        predicate: () => {
          if (!orchestratorId) return false;
          const orchestrator = stores.getAgent(orchestratorId);
          if (!orchestrator?.inbox) return false;
          const resultMessages = orchestrator.inbox.filter((m) => m.type === 'result');
          return resultMessages.length === 2;
        },
      },
    ],
  };
}
