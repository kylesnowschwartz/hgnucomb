import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useAgentStore } from '@features/agents/agentStore';
import { clearAgentsFromLocalStorage } from '@features/agents/agentPersistence';
import { useTerminalStore } from '@features/terminal/terminalStore';
import { useEventLogStore } from '@features/events/eventLogStore';
import { useUIStore } from './uiStore';
import { useDraggable } from '@features/grid/useDraggable';
import {
  IntegrationTestRunner,
  type StoreAccess,
} from '@integration/IntegrationTestRunner';
import type { TestLogEntry, RunnerState } from '@integration/types';
import { TEST_REGISTRY, getTestById } from '@integration/registry';
import './ControlPanel.css';

// ============================================================================
// Log Entry Styling
// ============================================================================

function getLogClass(level: TestLogEntry['level']): string {
  switch (level) {
    case 'success':
      return 'control-panel__log-entry--success';
    case 'error':
      return 'control-panel__log-entry--error';
    case 'warn':
      return 'control-panel__log-entry--warn';
    default:
      return '';
  }
}

// ============================================================================
// Control Panel Component
// ============================================================================

/**
 * Floating control panel for running integration tests.
 * Spawns real Claude agents and verifies multi-agent coordination.
 */
export function ControlPanel() {
  // Integration test state
  const [runnerState, setRunnerState] = useState<RunnerState>({
    isRunning: false,
    currentStep: 0,
    totalSteps: 0,
    currentDescription: '',
    log: [],
  });
  const runnerRef = useRef<IntegrationTestRunner | null>(null);

  // Test selection state
  const [selectedTestId, setSelectedTestId] = useState(TEST_REGISTRY[0]?.id ?? '');

  // Log container ref for auto-scroll
  const logRef = useRef<HTMLDivElement>(null);

  // Draggable panel - starts bottom-right
  const { handleMouseDown, style: dragStyle } = useDraggable({
    initialX: window.innerWidth - 340,
    initialY: window.innerHeight - 320,
  });

  // Store access for integration runner
  const bridge = useTerminalStore((s) => s.bridge);
  const storeAccess: StoreAccess = useMemo(
    () => ({
      getAgent: useAgentStore.getState().getAgent,
      getAllAgents: useAgentStore.getState().getAllAgents,
      spawnAgent: useAgentStore.getState().spawnAgent,
      getEvents: () => useEventLogStore.getState().events,
      getSessionForAgent: useTerminalStore.getState().getSessionForAgent,
      selectAgent: useUIStore.getState().selectAgent,
    }),
    []
  );

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [runnerState.log]);

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const handleRun = useCallback(async () => {
    if (!bridge) {
      console.error('[ControlPanel] No bridge available for integration test');
      return;
    }

    if (runnerState.isRunning) return;

    const testEntry = getTestById(selectedTestId);
    if (!testEntry) {
      console.error('[ControlPanel] No test found for ID:', selectedTestId);
      return;
    }

    // Clear all state (server + client) for clean test run
    try {
      await bridge.clearSessions();
    } catch (err) {
      console.warn('[ControlPanel] Failed to clear server sessions:', err);
    }
    useAgentStore.getState().clear();
    useEventLogStore.getState().clear();
    clearAgentsFromLocalStorage();

    // Create runner if needed
    if (!runnerRef.current) {
      runnerRef.current = new IntegrationTestRunner(bridge, storeAccess);
    }

    const runner = runnerRef.current;

    // Subscribe to state changes
    const unsub = runner.onStateChange((state) => {
      setRunnerState(state);
    });

    // Run the selected test
    const test = testEntry.factory(storeAccess);
    try {
      const result = await runner.run(test);
      console.log('[ControlPanel] Test result:', result);
    } catch (err) {
      console.error('[ControlPanel] Test error:', err);
    } finally {
      unsub();
    }
  }, [bridge, storeAccess, runnerState.isRunning, selectedTestId]);

  const handleStop = useCallback(() => {
    if (runnerRef.current) {
      runnerRef.current.stop();
    }
  }, []);

  const handleReset = useCallback(async () => {
    if (!bridge || runnerState.isRunning) return;

    try {
      const cleared = await bridge.clearSessions();
      useAgentStore.getState().clear();
      useEventLogStore.getState().clear();
      useTerminalStore.getState().clear();
      useUIStore.getState().selectAgent(null);
      clearAgentsFromLocalStorage();
      console.log('[ControlPanel] Reset complete, cleared', cleared, 'session(s)');
    } catch (err) {
      console.error('[ControlPanel] Reset failed:', err);
    }
  }, [bridge, runnerState.isRunning]);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="control-panel" style={dragStyle}>
      {/* Header */}
      <div className="control-panel__header" onMouseDown={handleMouseDown}>
        <span className="control-panel__title">Integration Test</span>
      </div>

      {/* Test selector */}
      <div className="control-panel__selector">
        <select
          className="control-panel__select"
          value={selectedTestId}
          onChange={(e) => setSelectedTestId(e.target.value)}
          disabled={runnerState.isRunning}
        >
          {TEST_REGISTRY.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>

      {/* Log display */}
      <div className="control-panel__log" ref={logRef}>
        {runnerState.log.length === 0 ? (
          <div className="control-panel__log--empty">
            Select a test and click Run to start.
          </div>
        ) : (
          runnerState.log.map((entry, index) => (
            <div
              key={index}
              className={`control-panel__log-entry ${getLogClass(entry.level)}`}
            >
              <span className="control-panel__log-level">[{entry.level}]</span>
              <span className="control-panel__log-message">{entry.message}</span>
            </div>
          ))
        )}
      </div>

      {/* Progress bar */}
      {runnerState.isRunning && (
        <div className="control-panel__progress">
          <div
            className="control-panel__progress-bar"
            style={{
              width: `${(runnerState.currentStep / runnerState.totalSteps) * 100}%`,
            }}
          />
          <span className="control-panel__progress-text">
            Step {runnerState.currentStep}/{runnerState.totalSteps}
          </span>
        </div>
      )}

      {/* Control buttons */}
      <div className="control-panel__controls">
        <button
          className="control-panel__btn control-panel__btn--play"
          onClick={handleRun}
          disabled={runnerState.isRunning || !bridge}
        >
          {'\u25B6'} Run
        </button>
        <button
          className="control-panel__btn control-panel__btn--stop"
          onClick={handleStop}
          disabled={!runnerState.isRunning}
        >
          {'\u25A0'} Stop
        </button>
        <button
          className="control-panel__btn control-panel__btn--reset"
          onClick={handleReset}
          disabled={runnerState.isRunning || !bridge}
          title="Kill all sessions and reset to fresh slate"
        >
          {'\u21BA'} Reset
        </button>
      </div>
    </div>
  );
}
