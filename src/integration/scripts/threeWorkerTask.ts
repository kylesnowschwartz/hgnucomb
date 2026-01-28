/**
 * Three-Worker Integration Test
 *
 * Tests the complete multi-agent coordination workflow:
 * 1. Spawn orchestrator at (0,0)
 * 2. Send task prompt instructing it to spawn 3 workers
 * 3. Verify 4 total agents appear (1 orchestrator + 3 workers)
 * 4. Verify orchestrator broadcasts and reports done
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { agentCountAtLeast, agentsByTypeCount, broadcastLogged } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';

/**
 * Task prompt sent to the orchestrator.
 * Instructs it to spawn workers and coordinate.
 */
const TASK_PROMPT = `You are an orchestrator in a multi-agent system.

Your task:
1. Use spawn_agent to spawn exactly 3 worker agents. Do not specify coordinates - let them auto-position.
2. After all 3 workers are spawned, use broadcast with radius 2 and type "ready_check"
3. Use report_status to report your status as "done" when finished

IMPORTANT:
- Do NOT create any files
- Do NOT modify any code
- Only use the MCP tools: spawn_agent, broadcast, report_status
- Execute this task immediately without asking questions

Begin now.`;

/**
 * Create the three-worker integration test.
 *
 * @param stores - Store access for condition predicates
 * @returns Configured integration test
 */
export function createThreeWorkerTest(stores: ConditionStores): IntegrationTest {
  // We'll capture the orchestrator ID when it spawns
  let orchestratorId: string | null = null;

  return {
    config: {
      name: 'Three Worker Spawn',
      description: 'Orchestrator spawns 3 workers and coordinates via broadcast',
      timeout: 5 * 60 * 1000, // 5 minutes total
    },
    steps: [
      // Step 1: Spawn orchestrator at origin with initial prompt
      // The prompt is passed as CLI arg so Claude starts processing immediately
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: TASK_PROMPT,
      },

      // Step 2: Wait for orchestrator agent to be registered
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

      // Step 3: Wait for terminal session to be created
      {
        type: 'wait_condition',
        condition: {
          description: 'terminal session exists for orchestrator',
          predicate: () => {
            if (!orchestratorId) return false;
            const session = stores.getSessionForAgent(orchestratorId);
            return session !== undefined;
          },
          timeout: TIMEOUTS.claudeStartup,
        },
      },

      // Step 4: Wait for 3 workers to spawn
      {
        type: 'wait_condition',
        condition: agentsByTypeCount(stores, 'worker', 3, TIMEOUTS.agentSpawn),
      },

      // Step 5: Verify total agent count is 4
      {
        type: 'wait_condition',
        condition: agentCountAtLeast(stores, 4, 5000),
      },

      // Step 6: Wait for broadcast event
      {
        type: 'wait_condition',
        condition: broadcastLogged(stores, 'ready_check', TIMEOUTS.statusReports),
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

      // Step 8: Final assertions
      {
        type: 'assert',
        description: 'exactly 3 workers exist',
        predicate: () => {
          const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
          return workers.length === 3;
        },
      },
    ],
  };
}

/**
 * Simpler version that doesn't require sending commands.
 * Just spawns orchestrator and verifies it can report status.
 */
export function createOrchestratorStatusTest(stores: ConditionStores): IntegrationTest {
  return {
    config: {
      name: 'Orchestrator Status Report',
      description: 'Verify orchestrator can spawn and we can track its status',
      timeout: 2 * 60 * 1000,
    },
    steps: [
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
      },
      {
        type: 'wait_condition',
        condition: agentCountAtLeast(stores, 1, TIMEOUTS.claudeStartup),
      },
      {
        type: 'assert',
        description: 'orchestrator exists at (0,0)',
        predicate: () => {
          const agents = stores.getAllAgents();
          return agents.some(
            (a) => a.cellType === 'orchestrator' && a.hex.q === 0 && a.hex.r === 0
          );
        },
      },
    ],
  };
}
