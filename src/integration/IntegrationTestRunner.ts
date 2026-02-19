/**
 * IntegrationTestRunner - orchestrates end-to-end multi-agent tests.
 *
 * Executes test scripts that:
 * 1. Spawn orchestrator agents (Claude CLI with MCP tools)
 * 2. Send TTY commands to trigger agent behaviors
 * 3. Wait for conditions (agent count, status reports, events)
 * 4. Verify expected outcomes
 */

import type { TerminalBridge } from '@features/terminal/TerminalBridge';
import type { HexCoordinate } from '@shared/types';
import { assertNever } from '@shared/exhaustive';
import type { AgentState, SpawnOptions } from '@features/agents/agentStore';
import type { LogEvent } from '@features/events/eventLogStore';
import type {
  IntegrationTest,
  TestResult,
  StepResult,
  WaitCondition,
  RunnerState,
  TestLogEntry,
} from './types';

// ============================================================================
// Timeouts
// ============================================================================

export const TIMEOUTS = {
  /** Wait for Claude CLI to initialize */
  claudeStartup: 30_000,
  /** Wait for spawned agents to appear */
  agentSpawn: 120_000,
  /** Wait for status reports */
  statusReports: 60_000,
  /** Default poll interval */
  pollInterval: 500,
} as const;

// ============================================================================
// Store Access Interface
// ============================================================================

// SpawnOptions imported from @features/agents/agentStore (canonical source)

/**
 * Interface for accessing Zustand stores during tests.
 * Decouples runner from specific store implementations.
 */
export interface StoreAccess {
  getAgent: (id: string) => AgentState | undefined;
  getAllAgents: () => AgentState[];
  spawnAgent: (hex: HexCoordinate, cellType: 'terminal' | 'orchestrator' | 'worker', options?: SpawnOptions) => string;
  getEvents: () => LogEvent[];
  getSessionForAgent: (agentId: string) => { sessionId: string } | undefined;
  selectAgent: (agentId: string | null) => void;
}

// ============================================================================
// IntegrationTestRunner
// ============================================================================

export class IntegrationTestRunner {
  private bridge: TerminalBridge;
  private stores: StoreAccess;
  private abortController: AbortController | null = null;
  private _state: RunnerState;
  private stateListeners: Set<(state: RunnerState) => void> = new Set();

  /** Track the last spawned orchestrator for send_command steps with empty agentId */
  private lastOrchestratorId: string | null = null;

  constructor(bridge: TerminalBridge, stores: StoreAccess) {
    this.bridge = bridge;
    this.stores = stores;
    this._state = {
      isRunning: false,
      currentStep: 0,
      totalSteps: 0,
      currentDescription: '',
      log: [],
    };
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  get state(): RunnerState {
    return this._state;
  }

  private setState(updates: Partial<RunnerState>): void {
    this._state = { ...this._state, ...updates };
    this.notifyListeners();
  }

  private log(level: TestLogEntry['level'], message: string): void {
    const entry: TestLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    this._state.log = [...this._state.log, entry];
    this.notifyListeners();
    console.log(`[IntegrationTest] [${level}] ${message}`);
  }

  onStateChange(listener: (state: RunnerState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.stateListeners) {
      listener(this._state);
    }
  }

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  /**
   * Spawn an orchestrator at the given hex coordinates.
   * Also selects the agent to open the terminal panel.
   * Returns the agent ID once created.
   */
  async spawnOrchestrator(hex: HexCoordinate, initialPrompt?: string): Promise<string> {
    this.log('info', `Spawning orchestrator at (${hex.q}, ${hex.r})${initialPrompt ? ' with initial prompt' : ''}`);
    const agentId = this.stores.spawnAgent(hex, 'orchestrator', { initialPrompt });
    this.lastOrchestratorId = agentId;

    // Select the agent to open the terminal panel
    this.stores.selectAgent(agentId);
    this.log('success', `Orchestrator ${agentId} created and selected`);
    return agentId;
  }

  /**
   * Send a command string to an agent's TTY.
   * If agentId is empty, uses the last spawned orchestrator.
   */
  async sendCommand(agentId: string, command: string): Promise<void> {
    // Use last orchestrator if agentId not specified
    const targetId = agentId || this.lastOrchestratorId;
    if (!targetId) {
      throw new Error('No agent ID specified and no orchestrator has been spawned');
    }

    const session = this.stores.getSessionForAgent(targetId);
    if (!session) {
      throw new Error(`No session found for agent ${targetId}`);
    }
    this.log('info', `Sending command to ${targetId}: ${command.slice(0, 50)}...`);
    // Claude CLI multiline input: text, then Enter to finalize line, then Ctrl+D to submit
    this.bridge.write(session.sessionId, command + '\r\x04');
  }

  // --------------------------------------------------------------------------
  // Wait Conditions
  // --------------------------------------------------------------------------

  /**
   * Wait for a condition to become true, polling at intervals.
   */
  async waitFor(condition: WaitCondition): Promise<void> {
    const startTime = Date.now();
    const pollInterval = condition.pollInterval ?? TIMEOUTS.pollInterval;

    this.log('info', `Waiting: ${condition.description}`);

    return new Promise((resolve, reject) => {
      const check = () => {
        // Check abort
        if (this.abortController?.signal.aborted) {
          reject(new Error('Test aborted'));
          return;
        }

        // Check condition
        if (condition.predicate()) {
          this.log('success', `Condition met: ${condition.description}`);
          resolve();
          return;
        }

        // Check timeout
        if (Date.now() - startTime > condition.timeout) {
          reject(new Error(`Timeout waiting for: ${condition.description}`));
          return;
        }

        // Poll again
        setTimeout(check, pollInterval);
      };

      check();
    });
  }

  /**
   * Wait for a specific agent count.
   */
  async waitForAgentCount(count: number, timeout = TIMEOUTS.agentSpawn): Promise<void> {
    await this.waitFor({
      description: `${count} agents on grid`,
      predicate: () => this.stores.getAllAgents().length >= count,
      timeout,
    });
  }

  /**
   * Wait for a specific agent to report a status.
   */
  async waitForStatus(
    agentId: string,
    status: AgentState['detailedStatus'],
    timeout = TIMEOUTS.statusReports
  ): Promise<void> {
    await this.waitFor({
      description: `Agent ${agentId} status === ${status}`,
      predicate: () => {
        const agent = this.stores.getAgent(agentId);
        return agent?.detailedStatus === status;
      },
      timeout,
    });
  }

  /**
   * Wait for workers to spawn (agents with cellType === 'worker').
   */
  async waitForWorkerCount(count: number, timeout = TIMEOUTS.agentSpawn): Promise<void> {
    await this.waitFor({
      description: `${count} worker agents on grid`,
      predicate: () => {
        const workers = this.stores.getAllAgents().filter((a) => a.cellType === 'worker');
        return workers.length >= count;
      },
      timeout,
    });
  }

  // --------------------------------------------------------------------------
  // Test Execution
  // --------------------------------------------------------------------------

  /**
   * Run a complete integration test.
   */
  async run(test: IntegrationTest): Promise<TestResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];

    this.abortController = new AbortController();
    this.setState({
      isRunning: true,
      currentStep: 0,
      totalSteps: test.steps.length,
      currentDescription: test.config.description,
      log: [],
    });

    this.log('info', `Starting test: ${test.config.name}`);

    try {
      for (let i = 0; i < test.steps.length; i++) {
        if (this.abortController.signal.aborted) {
          throw new Error('Test aborted');
        }

        const step = test.steps[i]!; // Loop bounded by test.steps.length
        this.setState({ currentStep: i + 1 });
        const stepStart = Date.now();

        try {
          await this.executeStep(step);
          stepResults.push({
            step,
            success: true,
            duration: Date.now() - stepStart,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.log('error', `Step failed: ${error}`);
          stepResults.push({
            step,
            success: false,
            error,
            duration: Date.now() - stepStart,
          });

          // Stop on first failure
          return {
            config: test.config,
            success: false,
            steps: stepResults,
            totalDuration: Date.now() - startTime,
            error,
          };
        }
      }

      this.log('success', `Test passed: ${test.config.name}`);

      return {
        config: test.config,
        success: true,
        steps: stepResults,
        totalDuration: Date.now() - startTime,
      };
    } finally {
      this.setState({ isRunning: false });
      this.abortController = null;
    }
  }

  private async executeStep(step: IntegrationTest['steps'][number]): Promise<void> {
    switch (step.type) {
      case 'spawn_orchestrator': {
        await this.spawnOrchestrator(step.hex, step.initialPrompt);
        // Wait a moment for the agent to be fully registered
        await this.delay(100);
        break;
      }

      case 'send_command': {
        await this.sendCommand(step.agentId, step.command);
        if (step.delay) {
          await this.delay(step.delay);
        }
        break;
      }

      case 'wait_condition': {
        await this.waitFor(step.condition);
        break;
      }

      case 'assert': {
        this.log('info', `Assert: ${step.description}`);
        if (!step.predicate()) {
          throw new Error(`Assertion failed: ${step.description}`);
        }
        this.log('success', `Assertion passed: ${step.description}`);
        break;
      }

      default:
        assertNever(step);
    }
  }

  /**
   * Stop a running test.
   */
  stop(): void {
    if (this.abortController) {
      this.log('warn', 'Test aborted by user');
      this.abortController.abort();
    }
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
