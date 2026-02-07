/**
 * Test Registry - Catalog of available integration tests.
 *
 * Each test is registered with metadata and a factory function
 * that creates the test instance with store access.
 */

import type { IntegrationTest } from './types';
import type { ConditionStores } from './conditions';
import { createThreeWorkerTest, createOrchestratorStatusTest } from './scripts/threeWorkerTask';
import { createBilateralCommunicationTest, createTaskAssignmentTest } from './scripts/bilateralCommunication';
import { createMultiCycleDemoTest } from './scripts/multiCycleDemo';
import { createStagingWorkflowTest, createSimpleMergeTest } from './scripts/stagingWorkflow';
import { createCleanupCoordinationTest, createKillWorkerTest } from './scripts/cleanupCoordination';
import { createBadgeShowcaseTest } from './scripts/badgeShowcase';

export interface TestEntry {
  /** Unique identifier for the test */
  id: string;
  /** Human-readable name shown in UI */
  name: string;
  /** Description of what the test verifies */
  description: string;
  /** Factory function that creates the test with store access */
  factory: (stores: ConditionStores) => IntegrationTest;
}

/**
 * Registry of all available integration tests.
 * Order determines dropdown display order.
 */
export const TEST_REGISTRY: TestEntry[] = [
  {
    id: 'three-worker',
    name: 'Three Worker Spawn',
    description: 'Orchestrator spawns 3 workers and coordinates via broadcast',
    factory: createThreeWorkerTest,
  },
  {
    id: 'bilateral-communication',
    name: 'Bilateral Communication',
    description: 'Orchestrator spawns worker with task, worker reports result',
    factory: createBilateralCommunicationTest,
  },
  {
    id: 'task-assignment',
    name: 'Task Assignment',
    description: 'Verify worker receives task in context when spawned',
    factory: createTaskAssignmentTest,
  },
  {
    id: 'multi-cycle-demo',
    name: 'Multi-Cycle Demo',
    description: 'Full bilateral loop: spawn worker, receive result, spawn another, repeat',
    factory: createMultiCycleDemoTest,
  },
  {
    id: 'orchestrator-status',
    name: 'Orchestrator Status',
    description: 'Simple test: spawn orchestrator and verify status tracking',
    factory: createOrchestratorStatusTest,
  },
  {
    id: 'simple-merge',
    name: 'Simple Merge',
    description: 'Single worker merge: spawn, merge to staging, approval, merge to main',
    factory: createSimpleMergeTest,
  },
  {
    id: 'staging-workflow',
    name: 'Staging Workflow',
    description: 'Full merge workflow with conflict resolution and human approval',
    factory: createStagingWorkflowTest,
  },
  {
    id: 'cleanup-coordination',
    name: 'Cleanup Coordination',
    description: 'Orchestrator spawns worker, cleans up worktree, verifies UI removal',
    factory: createCleanupCoordinationTest,
  },
  {
    id: 'kill-worker',
    name: 'Kill Worker',
    description: 'Orchestrator spawns worker, forcibly kills it, verifies UI removal',
    factory: createKillWorkerTest,
  },
  {
    id: 'badge-showcase',
    name: 'Badge Showcase',
    description: 'Visual test: cycles worker through all 3 attention badge states (?, !, X)',
    factory: createBadgeShowcaseTest,
  },
];

/**
 * Get a test entry by ID.
 */
export function getTestById(id: string): TestEntry | undefined {
  return TEST_REGISTRY.find((t) => t.id === id);
}
