/**
 * Staging Workflow Integration Test
 *
 * Tests the complete orchestrator staging workflow including merge conflict resolution:
 * 1. Orchestrator spawns 2 workers with conflicting file tasks
 * 2. Workers make changes and report results
 * 3. Orchestrator awaits both workers
 * 4. Orchestrator merges first worker (succeeds)
 * 5. Orchestrator attempts to merge second worker (may conflict)
 * 6. Orchestrator handles conflict resolution
 * 7. Orchestrator asks human for approval (AskUserQuestion)
 * 8. Human approves
 * 9. Orchestrator merges staging to main
 *
 * This exercises the FSM hooks that enforce workflow completion.
 */

import type { IntegrationTest } from '../types';
import type { ConditionStores } from '../conditions';
import { TIMEOUTS } from '../IntegrationTestRunner';

/**
 * Task prompt for orchestrator.
 * Instructs it to spawn workers that will modify the same file,
 * creating a merge conflict scenario.
 */
const ORCHESTRATOR_TASK = `You are an orchestrator testing the staging workflow.

GOAL: Test merge conflict resolution by having two workers modify the same file.

STEP 1: Spawn Worker A
- Call spawn_agent with:
  task="Modify test file - add line A"
  instructions="Create or modify .hgnucomb/test-staging.txt to add the line 'Worker A was here'. Commit your changes. Then call report_result with result='Added line A' and report_status done."

STEP 2: Spawn Worker B
- Call spawn_agent with:
  task="Modify test file - add line B"
  instructions="Create or modify .hgnucomb/test-staging.txt to add the line 'Worker B was here'. Commit your changes. Then call report_result with result='Added line B' and report_status done."

STEP 3: Await Worker A
- Call await_worker with workerId=<Worker A's agentId>
- Note the result

STEP 4: Await Worker B
- Call await_worker with workerId=<Worker B's agentId>
- Note the result

STEP 5: Merge Worker A to staging
- Call merge_worker_to_staging with workerId=<Worker A's agentId>
- This should succeed

STEP 6: Merge Worker B to staging
- Call merge_worker_to_staging with workerId=<Worker B's agentId>
- This may report a merge conflict - if so, resolve it in your staging worktree by:
  1. Read the conflicted file
  2. Edit it to include BOTH workers' lines
  3. Run: git add .hgnucomb/test-staging.txt && git commit -m "Resolve merge conflict"

STEP 7: Request human approval
- Call AskUserQuestion with:
  questions: [{
    question: "Workers have been merged to staging. Ready to merge to main?",
    header: "Approval",
    multiSelect: false,
    options: [
      { label: "Merge to main", description: "Approve and merge changes to main branch" },
      { label: "Abort", description: "Do not merge, discard staging changes" }
    ]
  }]

STEP 8: Based on human response
- If approved: Call merge_staging_to_main
- If aborted: Skip merge

STEP 9: Cleanup workers
- Call cleanup_worker_worktree for both workers

STEP 10: Report done
- Call report_status with state="done"

RULES:
- Execute steps in order
- Do NOT skip the AskUserQuestion step
- Do NOT report done until all steps complete
- Handle merge conflicts gracefully`;

/**
 * Create the staging workflow test.
 */
export function createStagingWorkflowTest(stores: ConditionStores): IntegrationTest {
  let orchestratorId: string | null = null;
  let workerAId: string | null = null;
  let workerBId: string | null = null;

  return {
    config: {
      name: 'Staging Workflow',
      description: 'Full merge workflow: spawn workers, merge to staging, resolve conflicts, get approval, merge to main',
      timeout: 10 * 60 * 1000, // 10 minutes - this is a complex workflow
    },
    steps: [
      // Step 1: Spawn orchestrator
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: ORCHESTRATOR_TASK,
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

      // Step 3: Wait for Worker A to spawn
      {
        type: 'wait_condition',
        condition: {
          description: 'Worker A spawned',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            if (workers.length >= 1) {
              workerAId = workers[0].id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Step 4: Wait for Worker B to spawn
      {
        type: 'wait_condition',
        condition: {
          description: 'Worker B spawned',
          predicate: () => {
            const workers = stores.getAllAgents().filter((a) => a.cellType === 'worker');
            if (workers.length >= 2) {
              workerBId = workers[1].id;
              return true;
            }
            return false;
          },
          timeout: TIMEOUTS.agentSpawn,
        },
      },

      // Step 5: Verify both workers have correct parent
      {
        type: 'assert',
        description: 'both workers have orchestrator as parent',
        predicate: () => {
          if (!workerAId || !workerBId || !orchestratorId) return false;
          const workerA = stores.getAgent(workerAId);
          const workerB = stores.getAgent(workerBId);
          return workerA?.parentId === orchestratorId && workerB?.parentId === orchestratorId;
        },
      },

      // Step 6: Wait for Worker A to complete
      {
        type: 'wait_condition',
        condition: {
          description: 'Worker A reports done',
          predicate: () => {
            if (!workerAId) return false;
            const worker = stores.getAgent(workerAId);
            return worker?.detailedStatus === 'done';
          },
          timeout: TIMEOUTS.statusReports * 2, // Workers need time to boot, modify, commit
        },
      },

      // Step 7: Wait for Worker B to complete
      {
        type: 'wait_condition',
        condition: {
          description: 'Worker B reports done',
          predicate: () => {
            if (!workerBId) return false;
            const worker = stores.getAgent(workerBId);
            return worker?.detailedStatus === 'done';
          },
          timeout: TIMEOUTS.statusReports * 2,
        },
      },

      // Step 8: Wait for orchestrator to complete
      // The hooks will enforce that the orchestrator:
      // - Awaits both workers
      // - Merges or discards them
      // - Gets approval before merge_staging_to_main
      // - Calls merge_staging_to_main if workers were merged
      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator reports done (workflow complete)',
          predicate: () => {
            if (!orchestratorId) return false;
            const orchestrator = stores.getAgent(orchestratorId);
            return orchestrator?.detailedStatus === 'done';
          },
          timeout: 5 * 60 * 1000, // 5 minutes for full workflow including human approval
        },
      },

      // Step 9: Final assertions
      {
        type: 'assert',
        description: 'all agents completed successfully',
        predicate: () => {
          if (!orchestratorId || !workerAId || !workerBId) return false;
          const orchestrator = stores.getAgent(orchestratorId);
          const workerA = stores.getAgent(workerAId);
          const workerB = stores.getAgent(workerBId);
          return (
            orchestrator?.detailedStatus === 'done' &&
            workerA?.detailedStatus === 'done' &&
            workerB?.detailedStatus === 'done'
          );
        },
      },
    ],
  };
}

/**
 * Simpler test that just tests the merge workflow without conflicts.
 * Single worker, merge to staging, approval, merge to main.
 */
export function createSimpleMergeTest(stores: ConditionStores): IntegrationTest {
  let orchestratorId: string | null = null;
  let workerId: string | null = null;

  const SIMPLE_TASK = `You are testing the merge workflow.

STEP 1: Spawn a worker
- Call spawn_agent with:
  task="Create test file"
  instructions="Create file .hgnucomb/test-simple-merge.txt with content 'Hello from worker'. Commit with message 'Add test file'. Call report_result with result='File created' and report_status done."

STEP 2: Await worker
- Call await_worker with the workerId

STEP 3: Merge worker to staging
- Call merge_worker_to_staging

STEP 4: Ask for approval
- Call AskUserQuestion asking if ready to merge to main

STEP 5: Merge to main (if approved)
- Call merge_staging_to_main

STEP 6: Cleanup
- Call cleanup_worker_worktree

STEP 7: Done
- Call report_status with state="done"

Execute immediately.`;

  return {
    config: {
      name: 'Simple Merge',
      description: 'Single worker, merge to staging, approval, merge to main',
      timeout: 5 * 60 * 1000,
    },
    steps: [
      {
        type: 'spawn_orchestrator',
        hex: { q: 0, r: 0 },
        initialPrompt: SIMPLE_TASK,
      },

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

      {
        type: 'wait_condition',
        condition: {
          description: 'worker spawned',
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

      {
        type: 'wait_condition',
        condition: {
          description: 'worker reports done',
          predicate: () => {
            if (!workerId) return false;
            const worker = stores.getAgent(workerId);
            return worker?.detailedStatus === 'done';
          },
          timeout: TIMEOUTS.statusReports * 2,
        },
      },

      {
        type: 'wait_condition',
        condition: {
          description: 'orchestrator reports done',
          predicate: () => {
            if (!orchestratorId) return false;
            const orch = stores.getAgent(orchestratorId);
            return orch?.detailedStatus === 'done';
          },
          timeout: 5 * 60 * 1000,
        },
      },

      {
        type: 'assert',
        description: 'workflow completed',
        predicate: () => {
          if (!orchestratorId || !workerId) return false;
          const orch = stores.getAgent(orchestratorId);
          const worker = stores.getAgent(workerId);
          return orch?.detailedStatus === 'done' && worker?.detailedStatus === 'done';
        },
      },
    ],
  };
}
