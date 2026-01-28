/**
 * Integration test infrastructure exports.
 */

// Core runner
export { IntegrationTestRunner, TIMEOUTS } from './IntegrationTestRunner';
export type { StoreAccess } from './IntegrationTestRunner';

// Types
export type {
  IntegrationTest,
  IntegrationTestConfig,
  TestStep,
  TestResult,
  StepResult,
  WaitCondition,
  RunnerState,
  TestLogEntry,
  SpawnOrchestratorStep,
  SendCommandStep,
  WaitConditionStep,
  AssertStep,
} from './types';

// Condition helpers
export {
  agentCountEquals,
  agentCountAtLeast,
  agentsByTypeCount,
  agentStatusIs,
  allAgentsOfTypeHaveStatus,
  eventLogged,
  broadcastLogged,
  statusChangeLogged,
  allConditions,
  anyCondition,
  delay,
} from './conditions';
export type { ConditionStores } from './conditions';

// Test scripts
export { createThreeWorkerTest, createOrchestratorStatusTest } from './scripts/threeWorkerTask';
