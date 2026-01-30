/**
 * Cleanup Coordination Integration Test
 *
 * Tests the cleanup flow when orchestrator removes workers:
 * 1. Spawn orchestrator with task prompt
 * 2. Orchestrator spawns a worker
 * 3. Worker completes and reports result
 * 4. Orchestrator calls cleanup_worker_worktree
 * 5. Verify worker is removed from grid (broadcast received)
 * 6. Verify terminal session is cleaned up
 * 7. Verify removal event is logged
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';

/**
 * Task prompt for cleanup test orchestrator.
 * Spawns worker, waits for completion, then cleans up the worktree.
 */
const CLEANUP_ORCHESTRATOR_TASK = `You are an orchestrator testing cleanup coordination. Execute these steps IN ORDER:

STEP 1: Spawn a worker
- Call spawn_agent with task="Test cleanup" and instructions="Report 'cleanup test complete' to your parent via report_result, then report_status done."
- Save the agentId from the response

STEP 2: Wait for worker completion
- Call await_worker with workerId=<the agentId from step 1>
- This will block until the worker finishes

STEP 3: Clean up the worker's worktree
- Call cleanup_worker_worktree with workerId=<the agentId from step 1>
- This removes the worker's git worktree and branch

STEP 4: Report done
- Call report_status with state="done"

RULES:
- Do NOT report "done" until cleanup_worker_worktree has completed
- Do NOT create files
- Execute immediately`;

/**
 * Task prompt for kill test orchestrator.
 * Spawns worker, then immediately kills it (simulating timeout/abort scenario).
 */
const KILL_ORCHESTRATOR_TASK = `You are an orchestrator testing worker termination. Execute these steps IN ORDER:

STEP 1: Spawn a worker
- Call spawn_agent with task="Long running task" and instructions="Sleep for 60 seconds then report done."
- Save the agentId from the response

STEP 2: Wait briefly for worker to initialize
- Wait a few seconds for the worker to start

STEP 3: Kill the worker (abort scenario)
- Call kill_worker with workerId=<the agentId from step 1>
- This forcibly terminates the worker's PTY session

STEP 4: Report done
- Call report_status with state="done"

RULES:
- Do NOT wait for worker completion - kill it proactively
- Do NOT create files
- Execute immediately`;

/**
 * Create the cleanup coordination test.
 * Tests cleanup_worker_worktree flow.
 */
export function createCleanupCoordinationTest(stores: ConditionStores): IntegrationTest {
  let orchestratorId: string | null = null;
  let workerId: string | null = null;

  return {
    config: {
      name: 'Cleanup Coordination',
      description: 'Orchestrator spawns worker, cleans up worktree, verifies UI removal',
      timeout: 5 * 60 * 1000, // 5 minutes
    },
    steps: [
      // Step 1: Spawn orchestrator with cleanup task
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: CLEANUP_ORCHESTRATOR_TASK,
      },

      // Step 2: Wait for orchestrator to initialize
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

      // Step 3: Wait for worker to spawn
      {
        type: 'wait_condition',
        condition: {
          description: 'worker agent spawned',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            if (workers.length > 0) {
              workerId = workers[0].id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Step 4: Verify worker has session
      {
        type: 'assert',
        description: 'worker has terminal session',
        predicate: () => {
          if (!workerId) return false;
          const session = stores.getSessionForAgent(workerId);
          return session !== undefined;
        },
      },

      // Step 5: Wait for worker to report done
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

      // Step 6: Wait for worker to be removed from grid (cleanup broadcast received)
      {
        type: 'wait_condition',
        condition: {
          description: 'worker removed from grid after cleanup',
          predicate: () => {
            if (!workerId) return false;
            // Agent should no longer exist
            const worker = stores.getAgent(workerId);
            return worker === undefined;
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 7: Verify terminal session is gone
      {
        type: 'assert',
        description: 'worker terminal session removed',
        predicate: () => {
          if (!workerId) return false;
          const session = stores.getSessionForAgent(workerId);
          return session === undefined;
        },
      },

      // Step 8: Verify removal event logged
      {
        type: 'assert',
        description: 'removal event logged',
        predicate: () => {
          const events = stores.getEvents();
          return events.some(
            (e) => e.kind === 'removal' && e.reason === 'cleanup'
          );
        },
      },

      // Step 9: Wait for orchestrator to report done
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

      // Final assertion: orchestrator still exists, worker gone
      {
        type: 'assert',
        description: 'orchestrator active, worker removed',
        predicate: () => {
          if (!orchestratorId || !workerId) return false;
          const orchestrator = stores.getAgent(orchestratorId);
          const worker = stores.getAgent(workerId);
          return orchestrator !== undefined && worker === undefined;
        },
      },
    ],
  };
}

/**
 * Create the kill worker test.
 * Tests kill_worker flow (forcible termination).
 */
export function createKillWorkerTest(stores: ConditionStores): IntegrationTest {
  let orchestratorId: string | null = null;
  let workerId: string | null = null;

  return {
    config: {
      name: 'Kill Worker',
      description: 'Orchestrator spawns worker, forcibly kills it, verifies UI removal',
      timeout: 4 * 60 * 1000, // 4 minutes
    },
    steps: [
      // Step 1: Spawn orchestrator with kill task
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: KILL_ORCHESTRATOR_TASK,
      },

      // Step 2: Wait for orchestrator to initialize
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

      // Step 3: Wait for worker to spawn
      {
        type: 'wait_condition',
        condition: {
          description: 'worker agent spawned',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            if (workers.length > 0) {
              workerId = workers[0].id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Step 4: Verify worker has session
      {
        type: 'assert',
        description: 'worker has terminal session',
        predicate: () => {
          if (!workerId) return false;
          const session = stores.getSessionForAgent(workerId);
          return session !== undefined;
        },
      },

      // Step 5: Wait for worker to be killed and removed from grid
      {
        type: 'wait_condition',
        condition: {
          description: 'worker killed and removed from grid',
          predicate: () => {
            if (!workerId) return false;
            const worker = stores.getAgent(workerId);
            return worker === undefined;
          },
          timeout: TIMEOUTS.statusReports,
        },
      },

      // Step 6: Verify terminal session is gone
      {
        type: 'assert',
        description: 'worker terminal session removed',
        predicate: () => {
          if (!workerId) return false;
          const session = stores.getSessionForAgent(workerId);
          return session === undefined;
        },
      },

      // Step 7: Verify kill removal event logged
      {
        type: 'assert',
        description: 'kill removal event logged',
        predicate: () => {
          const events = stores.getEvents();
          return events.some(
            (e) => e.kind === 'removal' && e.reason === 'kill'
          );
        },
      },

      // Step 8: Wait for orchestrator to report done
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
    ],
  };
}
