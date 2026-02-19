/**
 * Badge Showcase Integration Test
 *
 * Visual showcase of all three attention badge states:
 *   waiting_input  → yellow "?" badge
 *   waiting_permission → peach "!" badge
 *   stuck → red "X" badge
 *
 * Spawns an orchestrator that spawns a single worker.
 * The worker cycles through each attention state with 5s pauses
 * so the operator can visually verify each badge renders correctly.
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';

const BADGE_HOLD_MS = 5000; // How long each badge stays visible

const ORCHESTRATOR_TASK = `You are an orchestrator. Execute these steps IN ORDER:

STEP 1: Spawn a worker
- Call spawn_agent with task="Badge showcase" and instructions="Cycle through attention states for visual testing. Execute EXACTLY these steps in order, waiting 5 seconds between each:
1. Call report_status with state='waiting_input' message='Need clarification on requirements'
2. Wait 5 seconds (do nothing, just pause)
3. Call report_status with state='waiting_permission' message='Approve write to config.json?'
4. Wait 5 seconds
5. Call report_status with state='stuck' message='Cannot resolve dependency conflict'
6. Wait 5 seconds
7. Call report_status with state='working' message='Resumed after help'
8. Wait 3 seconds
9. Call report_result with result='Badge showcase complete - all states displayed'
10. Call report_status with state='done'"
- Save the agentId

STEP 2: Wait for worker
- Call await_worker with workerId=<the agentId from step 1>

STEP 3: Report done
- Call report_status with state="done"

RULES:
- Do NOT report done until await_worker returns
- Do NOT create files
- Execute immediately`;

export function createBadgeShowcaseTest(stores: ConditionStores): IntegrationTest {
  let orchestratorId: string | null = null;
  let workerId: string | null = null;

  return {
    config: {
      name: 'Badge Showcase',
      description: 'Visual test: cycles worker through all 3 attention badge states',
      timeout: 5 * 60 * 1000,
    },
    steps: [
      // Step 1: Spawn orchestrator
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: ORCHESTRATOR_TASK,
      },

      // Step 2: Wait for orchestrator
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

      // Step 3: Wait for worker to spawn
      {
        type: 'wait_condition',
        condition: {
          description: 'worker spawned',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            if (workers.length > 0) {
              workerId = workers[0]!.id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Step 4: Wait for waiting_input (yellow ? badge)
      {
        type: 'wait_condition',
        condition: {
          description: 'worker shows waiting_input (yellow ? badge)',
          predicate: () => {
            if (!workerId) return false;
            const worker = stores.getAgent(workerId);
            return worker?.detailedStatus === 'waiting_input';
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 5: Verify waiting_input badge is visible
      {
        type: 'assert',
        description: 'worker status is waiting_input',
        predicate: () => {
          if (!workerId) return false;
          const worker = stores.getAgent(workerId);
          return worker?.detailedStatus === 'waiting_input';
        },
      },

      // Step 6: Wait for waiting_permission (peach ! badge)
      {
        type: 'wait_condition',
        condition: {
          description: 'worker shows waiting_permission (peach ! badge)',
          predicate: () => {
            if (!workerId) return false;
            const worker = stores.getAgent(workerId);
            return worker?.detailedStatus === 'waiting_permission';
          },
          timeout: BADGE_HOLD_MS + TIMEOUTS.statusReports,
        },
      },

      // Step 7: Verify waiting_permission badge
      {
        type: 'assert',
        description: 'worker status is waiting_permission',
        predicate: () => {
          if (!workerId) return false;
          const worker = stores.getAgent(workerId);
          return worker?.detailedStatus === 'waiting_permission';
        },
      },

      // Step 8: Wait for stuck (red X badge)
      {
        type: 'wait_condition',
        condition: {
          description: 'worker shows stuck (red X badge)',
          predicate: () => {
            if (!workerId) return false;
            const worker = stores.getAgent(workerId);
            return worker?.detailedStatus === 'stuck';
          },
          timeout: BADGE_HOLD_MS + TIMEOUTS.statusReports,
        },
      },

      // Step 9: Verify stuck badge
      {
        type: 'assert',
        description: 'worker status is stuck',
        predicate: () => {
          if (!workerId) return false;
          const worker = stores.getAgent(workerId);
          return worker?.detailedStatus === 'stuck';
        },
      },

      // Step 10: Wait for worker done
      {
        type: 'wait_condition',
        condition: {
          description: 'worker reports done',
          predicate: () => {
            if (!workerId) return false;
            const worker = stores.getAgent(workerId);
            return worker?.detailedStatus === 'done';
          },
          timeout: BADGE_HOLD_MS + TIMEOUTS.statusReports,
        },
      },

      // Step 11: Wait for orchestrator done
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

      // Step 12: Final verification
      {
        type: 'assert',
        description: 'all attention states were displayed and test completed',
        predicate: () => {
          if (!orchestratorId || !workerId) return false;
          const worker = stores.getAgent(workerId);
          const orch = stores.getAgent(orchestratorId);
          return worker?.detailedStatus === 'done' && orch?.detailedStatus === 'done';
        },
      },
    ],
  };
}
