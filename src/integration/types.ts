/**
 * Types for integration testing infrastructure.
 *
 * Integration tests exercise the real multi-agent workflow:
 * 1. Spawn orchestrator with Claude CLI
 * 2. Send TTY commands to trigger spawn_agent calls
 * 3. Verify workers spawn and report status
 */

import type { HexCoordinate } from '@shared/types';
import type { CellType } from '@shared/context';
import type { DetailedStatus } from '@terminal/types';

// ============================================================================
// Test Configuration
// ============================================================================

export interface IntegrationTestConfig {
  /** Test name for logging */
  name: string;
  /** Description of what this test verifies */
  description: string;
  /** Timeout for entire test run (ms) */
  timeout: number;
}

// ============================================================================
// Wait Conditions
// ============================================================================

/**
 * Generic wait condition - poll until predicate returns true or timeout.
 */
export interface WaitCondition {
  /** Human-readable description for logging */
  description: string;
  /** Function that returns true when condition is met */
  predicate: () => boolean;
  /** Max time to wait (ms) */
  timeout: number;
  /** Poll interval (ms), default 500 */
  pollInterval?: number;
}

// ============================================================================
// Test Steps
// ============================================================================

export type TestStepType =
  | 'spawn_orchestrator'
  | 'send_command'
  | 'wait_condition'
  | 'assert';

export interface SpawnOrchestratorStep {
  type: 'spawn_orchestrator';
  /** Hex coordinates for the orchestrator */
  hex: HexCoordinate;
  /** Optional initial prompt passed as CLI arg to Claude */
  initialPrompt?: string;
}

export interface SendCommandStep {
  type: 'send_command';
  /** Agent ID to send command to */
  agentId: string;
  /** Command string to write to TTY */
  command: string;
  /** Delay after sending (ms), default 0 */
  delay?: number;
}

export interface WaitConditionStep {
  type: 'wait_condition';
  /** The condition to wait for */
  condition: WaitCondition;
}

export interface AssertStep {
  type: 'assert';
  /** Human-readable assertion description */
  description: string;
  /** Function that returns true if assertion passes */
  predicate: () => boolean;
}

export type TestStep =
  | SpawnOrchestratorStep
  | SendCommandStep
  | WaitConditionStep
  | AssertStep;

// ============================================================================
// Test Script
// ============================================================================

export interface IntegrationTest {
  config: IntegrationTestConfig;
  steps: TestStep[];
}

// ============================================================================
// Test Results
// ============================================================================

export type StepResult = {
  step: TestStep;
  success: boolean;
  error?: string;
  duration: number;
};

export interface TestResult {
  config: IntegrationTestConfig;
  success: boolean;
  steps: StepResult[];
  totalDuration: number;
  error?: string;
}

// ============================================================================
// Runner State
// ============================================================================

export interface RunnerState {
  isRunning: boolean;
  currentStep: number;
  totalSteps: number;
  currentDescription: string;
  log: TestLogEntry[];
}

export interface TestLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

// ============================================================================
// Agent State Query Helpers
// ============================================================================

export interface AgentQuery {
  cellType?: CellType;
  status?: DetailedStatus;
  minCount?: number;
  maxCount?: number;
}
