import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { HexGrid } from '@features/grid/HexGrid';
import { ActionBar } from '@features/grid/ActionBar';
import { ControlPanel } from '@features/controls/ControlPanel';
import { StatusBar } from '@features/controls/StatusBar';
import { TerminalPanel } from '@features/terminal/TerminalPanel';
import { EventLog } from '@features/events/EventLog';
import { WebSocketBridge } from '@features/terminal/index';
import { useTerminalStore } from '@features/terminal/terminalStore';
import { calculateTerminalDimensions } from '@features/terminal/terminalConfig';
import { useUIStore } from '@features/controls/uiStore';
import { useAgentStore, type AgentState } from '@features/agents/agentStore';
import { agentToSnapshot } from '@features/agents/snapshot';
import { useEventLogStore } from '@features/events/eventLogStore';
import { useKeyboardNavigation, HelpModal } from '@features/keyboard';
import { useViewportStore } from '@features/grid/viewportStore';
import { useShallow } from 'zustand/shallow';
import { createMcpHandler, type McpHandlerDeps } from './handlers/mcpHandler';
import type { CellType, HexCoordinate, DetailedStatus } from '@shared/types';

// Animation duration for terminal panel slide (must match CSS)
const PANEL_ANIMATION_MS = 250;

type AnimPhase = 'unmounted' | 'entering' | 'open' | 'exiting';
type AnimAction = { type: 'ACTIVATE' } | { type: 'DEACTIVATE' } | { type: 'TICK' };

function animReducer(state: AnimPhase, action: AnimAction): AnimPhase {
  switch (action.type) {
    case 'ACTIVATE':
      // Start opening: enter the DOM in entering state
      return state === 'unmounted' || state === 'exiting' ? 'entering' : state;
    case 'DEACTIVATE':
      // Start closing: begin exit animation
      return state === 'open' || state === 'entering' ? 'exiting' : state;
    case 'TICK':
      // Progress to next state
      if (state === 'entering') return 'open';
      if (state === 'exiting') return 'unmounted';
      return state;
    default:
      return state;
  }
}

/**
 * Hook for managing mount/unmount animations with value caching.
 * Returns { shouldRender, isOpen, cachedValue } where:
 * - shouldRender: true when component should be in DOM
 * - isOpen: true when component should be in "open" visual state
 * - cachedValue: the last non-null value, persisted during exit animation
 *
 * Always starts unmounted - first activation triggers enter animation.
 */
function useAnimatedMount<T>(value: T | null, animationMs: number) {
  const isActive = value !== null;

  // Track phase and cached value together to avoid stale closure issues
  const [state, setState] = useState<{ phase: AnimPhase; cached: T | null }>({
    phase: 'unmounted',
    cached: null,
  });
  const initializedRef = useRef(false);

  // Handle activation/deactivation transitions (including initial)
  // Note: setState in effect is intentional for animation state machine - this is a valid pattern
  useEffect(() => {
    if (isActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((s) => ({ phase: animReducer(s.phase, { type: 'ACTIVATE' }), cached: value }));
    } else if (initializedRef.current) {
      // Only deactivate after first activation (avoid no-op on mount)
      // Keep cached value during exit
      setState((s) => ({ ...s, phase: animReducer(s.phase, { type: 'DEACTIVATE' }) }));
    }
    initializedRef.current = true;
  }, [isActive, value]);

  // Handle timed phase transitions
  useEffect(() => {
    if (state.phase === 'entering') {
      const frameId = requestAnimationFrame(() => {
        setState((s) => ({ ...s, phase: animReducer(s.phase, { type: 'TICK' }) }));
      });
      return () => cancelAnimationFrame(frameId);
    }
    if (state.phase === 'exiting') {
      const timer = setTimeout(() => {
        setState((s) => ({ ...s, phase: animReducer(s.phase, { type: 'TICK' }) }));
      }, animationMs);
      return () => clearTimeout(timer);
    }
  }, [state.phase, animationMs]);

  return {
    shouldRender: state.phase !== 'unmounted',
    isOpen: state.phase === 'open',
    cachedValue: state.cached,
  };
}

// Default panel dimensions (930px width = 115 columns at 8px cell width)
const DEFAULT_PANEL_WIDTH = Math.min(930, window.innerWidth * 0.5);
const DEFAULT_PANEL_HEIGHT = Math.min(600, window.innerHeight - 80);

function App() {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [showHelp, setShowHelp] = useState(false);

  // Terminal panel dimensions - persisted across open/close
  const [panelDimensions, setPanelDimensions] = useState({
    width: DEFAULT_PANEL_WIDTH,
    height: DEFAULT_PANEL_HEIGHT,
  });

  const {
    bridge,
    setBridge,
    setConnectionState,
    connectionState,
    addSession,
    appendData,
    markExited,
    removeSession,
    activeSessionId,
    setActiveSession,
    getSessionForAgent,
  } = useTerminalStore();

  const { selectedAgentId, selectAgent } = useUIStore();
  const { getAgent, getAllAgents, spawnAgent, removeAgent, updateAgentType, updateDetailedStatus } = useAgentStore();
  const { addStatusChange, addSpawn, addRemoval } = useEventLogStore();
  const panToHex = useViewportStore((s) => s.panToHex);
  const centerOnHex = useViewportStore((s) => s.centerOnHex);

  // Track which agents we've already initiated session creation for
  const sessionCreationInitiated = useRef<Set<string>>(new Set());

  // Subscribe to agents for auto-session creation
  const agents = useAgentStore(useShallow((s) => Array.from(s.agents.values())));

  // Rehydrate state from server on connect (tmux-like attach)
  const rehydrateFromServer = useCallback(async (ws: WebSocketBridge) => {
    try {
      console.log('[App] Rehydrating state from server...');
      const sessions = await ws.listSessions();

      // Server is truth - always clear client state first, then restore from server
      useAgentStore.getState().clear();
      sessionCreationInitiated.current.clear();
      // Note: clearing agentStore triggers localStorage persist (now empty)

      if (sessions.length === 0) {
        console.log('[App] No existing sessions to restore (server fresh)');
        return;
      }

      console.log('[App] Found', sessions.length, 'session(s) to restore');

      for (const session of sessions) {
        if (!session.agent) {
          console.log('[App] Session', session.sessionId, 'has no agent metadata, skipping');
          continue;
        }

        const meta = session.agent;

        // Restore agent to agentStore
        const agentId = useAgentStore.getState().spawnAgent(
          meta.hex,
          meta.cellType,
          {
            initialPrompt: meta.initialPrompt,
            parentId: meta.parentId,
            parentHex: meta.parentHex,
            task: meta.task,
            instructions: meta.instructions,
            taskDetails: meta.taskDetails,
          }
        );

        // The spawnAgent generates a new ID, but we need to use the original
        // Actually, we need to restore with the original agentId
        // Let me refactor: directly set in the store instead
        useAgentStore.setState((s) => {
          const agents = new Map(s.agents);
          // Remove the auto-generated agent
          agents.delete(agentId);
          // Add with original ID
          agents.set(meta.agentId, {
            id: meta.agentId,
            role: meta.cellType === 'orchestrator' ? 'orchestrator' : 'worker',
            cellType: meta.cellType,
            status: meta.status,
            detailedStatus: meta.detailedStatus ?? 'idle',
            statusMessage: meta.statusMessage,
            systemPrompt: '',
            hex: meta.hex,
            connections: meta.connections,
            initialPrompt: meta.initialPrompt,
            parentId: meta.parentId,
            parentHex: meta.parentHex,
            task: meta.task,
            instructions: meta.instructions,
            taskDetails: meta.taskDetails,
            inbox: [],
          });
          return { agents };
        });

        // Mark as initiated so we don't create a new session
        sessionCreationInitiated.current.add(meta.agentId);

        // Attach to existing session (don't create new one)
        ws.attachSession(session.sessionId);

        // Add to terminalStore
        addSession(
          { sessionId: session.sessionId, cols: session.cols, rows: session.rows },
          meta.agentId
        );

        // Replay buffered output
        if (session.buffer.length > 0) {
          const fullOutput = session.buffer.join('');
          appendData(session.sessionId, fullOutput);
          console.log('[App] Replayed', session.buffer.length, 'chunks for', meta.agentId);
        }

        // Set up data listener for new output
        ws.onData(session.sessionId, (data) => {
          appendData(session.sessionId, data);
        });

        // Set up exit listener
        ws.onExit(session.sessionId, (exitCode) => {
          markExited(session.sessionId, exitCode);
        });

        // Mark as exited if already exited
        if (session.exited) {
          markExited(session.sessionId, 0);
        }

        console.log('[App] Restored agent', meta.agentId, 'at', meta.hex);
      }

      console.log('[App] Rehydration complete');
    } catch (err) {
      console.error('[App] Failed to rehydrate from server:', err);
    }
  }, [addSession, appendData, markExited]);

  // Initialize bridge on mount
  useEffect(() => {
    const ws = new WebSocketBridge();
    setBridge(ws);

    const unsubConnection = ws.onConnectionChange((state) => {
      setConnectionState(state);
      console.log('[App] Connection state:', state);

      // Rehydrate when connected (handles both initial connect and reconnect)
      if (state === 'connected') {
        rehydrateFromServer(ws);
      }
    });

    ws.connect().catch((err) => {
      console.error('[App] Failed to connect:', err);
    });

    return () => {
      unsubConnection();
      ws.disconnect();
      setBridge(null);
    };
  }, [setBridge, setConnectionState, rehydrateFromServer]);

  // MCP handler dependencies - memoized to avoid recreating handler
  const mcpDeps: McpHandlerDeps = useMemo(
    () => ({
      getAgent,
      getAllAgents,
      spawnAgent,
      updateDetailedStatus,
      addStatusChange,
      addSpawn,
    }),
    [getAgent, getAllAgents, spawnAgent, updateDetailedStatus, addStatusChange, addSpawn]
  );

  // Handle MCP requests from orchestrator agents
  useEffect(() => {
    if (!bridge) return;
    const handler = createMcpHandler(mcpDeps, bridge);
    return bridge.onMcpRequest(handler);
  }, [bridge, mcpDeps]);

  // Handle server notifications (agent removal, status updates)
  useEffect(() => {
    if (!bridge) return;

    const handleNotification = (notification: unknown) => {
      if (typeof notification !== 'object' || notification === null) return;
      const msg = notification as { type: string; payload?: Record<string, unknown> };
      if (!msg.payload) return;

      // Handle cell type conversion (orchestrator/worker -> terminal)
      if (msg.type === 'cell.converted') {
        const { agentId, oldCellType, newCellType } = msg.payload as {
          agentId: string;
          oldCellType: string;
          newCellType: string;
          sessionId: string;
        };
        console.log(`[App] Cell converted: ${agentId} (${oldCellType} -> ${newCellType})`);

        // Update agent's cell type to terminal
        updateAgentType(agentId, newCellType as CellType);
        return;
      }

      // Handle agent removal
      if (msg.type === 'agent.removed') {
        const { agentId, reason, sessionId } = msg.payload as {
          agentId: string;
          reason: 'cleanup' | 'kill';
          sessionId?: string;
        };
        console.log(`[App] Agent removed: ${agentId} (${reason})`);

        // Remove from agent store
        removeAgent(agentId);

        // Remove associated terminal session
        if (sessionId) {
          removeSession(sessionId);
        } else {
          // Fallback: lookup session by agentId
          const session = getSessionForAgent(agentId);
          if (session) {
            removeSession(session.sessionId);
          }
        }

        // Log removal event
        addRemoval(agentId, reason);

        // Clear selection if this was the selected agent
        if (useUIStore.getState().selectedAgentId === agentId) {
          selectAgent(null);
        }
        return;
      }

      // Handle inbox sync from server (display only - server is source of truth)
      if (msg.type === 'inbox.sync') {
        const { agentId, messages } = msg.payload as {
          agentId: string;
          messages: import('@shared/protocol').AgentMessage[];
        };
        const agent = getAgent(agentId);
        if (agent) {
          useAgentStore.setState((s) => ({
            agents: new Map(s.agents).set(agentId, {
              ...agent,
              inbox: messages,
            }),
          }));
        }
        return;
      }

      // Handle broadcast event from server (for EventLog display)
      if (msg.type === 'mcp.broadcast.event') {
        const { senderId, senderHex, broadcastType, radius, recipientCount } = msg.payload as {
          senderId: string;
          senderHex: import('@shared/protocol').HexCoordinate;
          broadcastType: string;
          radius: number;
          recipientCount: number;
          recipients: string[];
        };
        useEventLogStore.getState().addBroadcast(senderId, senderHex, broadcastType, radius, recipientCount, null);
        return;
      }

      // Handle inferred status updates (from PTY activity detection)
      // Inferred status must NOT override sticky states that were explicitly reported
      // Exception: 'done' agents can transition back to 'working' via PTY activity
      if (msg.type === 'mcp.statusUpdate') {
        const { agentId, state } = msg.payload as {
          agentId: string;
          state: DetailedStatus;
          message?: string;
        };
        const agent = getAgent(agentId);
        const stickyStates: DetailedStatus[] = ['error', 'cancelled', 'waiting_input', 'waiting_permission', 'stuck'];
        if (agent && stickyStates.includes(agent.detailedStatus)) {
          return; // Don't override explicit status with inferred activity
        }
        updateDetailedStatus(agentId, state);
        return;
      }
    };

    return bridge.onNotification(handleNotification);
  }, [bridge, removeAgent, removeSession, getSessionForAgent, addRemoval, selectAgent, updateAgentType, updateDetailedStatus, getAgent]);

  // Create terminal session for an agent (without activating it)
  const createSessionForAgent = useCallback(
    async (agent: AgentState) => {
      if (!bridge) return;

      const isClaudeAgent = agent.cellType === 'orchestrator' || agent.cellType === 'worker';
      const shell = isClaudeAgent ? 'claude' : undefined;
      const env: Record<string, string> = {
        HGNUCOMB_AGENT_ID: agent.id,
        HGNUCOMB_HEX: `${agent.hex.q},${agent.hex.r}`,
        HGNUCOMB_CELL_TYPE: agent.cellType,
      };
      // Workers need parent ID to report results
      if (agent.parentId) {
        env.HGNUCOMB_PARENT_ID = agent.parentId;
      }

      // Always send agentSnapshot (needed for session persistence)
      // Only send allAgents for Claude agents (triggers context file generation)
      const agentSnapshot = agentToSnapshot(agent);
      const allAgentsSnapshot = isClaudeAgent
        ? getAllAgents().map(agentToSnapshot)
        : undefined;

      // Calculate initial terminal size from panel dimensions
      // This avoids the resize race where PTY starts at 80x24 but panel is narrower
      const { cols, rows } = calculateTerminalDimensions(
        panelDimensions.width,
        panelDimensions.height
      );

      try {
        const session = await bridge.createSession({
          cols,
          rows,
          shell,
          env,
          agentSnapshot,
          allAgents: allAgentsSnapshot,
          initialPrompt: agent.initialPrompt,
          task: agent.task,
          instructions: agent.instructions,
          taskDetails: agent.taskDetails,
          parentId: agent.parentId,
          parentHex: agent.parentHex,
          model: agent.model,
        });

        addSession(session, agent.id);

        // Always store data in buffer
        bridge.onData(session.sessionId, (data) => {
          appendData(session.sessionId, data);
        });

        // Listen for exit
        bridge.onExit(session.sessionId, (exitCode) => {
          markExited(session.sessionId, exitCode);
        });

        // If this agent is currently selected, activate the session
        // Use getState() to get current value, avoiding stale closure
        const currentSelectedId = useUIStore.getState().selectedAgentId;
        if (currentSelectedId === agent.id) {
          setActiveSession(session.sessionId);
        }

        console.log('[App] Auto-created session for agent:', agent.id, 'type:', agent.cellType);
        return session;
      } catch (err) {
        console.error('[App] Failed to create session for agent:', agent.id, err);
        // Remove from initiated set so we can retry
        sessionCreationInitiated.current.delete(agent.id);
        return null;
      }
    },
    [bridge, getAllAgents, addSession, appendData, markExited, setActiveSession, panelDimensions]
  );

  // Auto-create terminal sessions for Claude agents when they appear
  useEffect(() => {
    if (!bridge || connectionState !== 'connected') return;

    for (const agent of agents) {
      // Only auto-create for Claude agents (orchestrator/worker)
      const isClaudeAgent = agent.cellType === 'orchestrator' || agent.cellType === 'worker';
      if (!isClaudeAgent) continue;

      // Skip if already initiated or session exists
      if (sessionCreationInitiated.current.has(agent.id)) continue;
      if (getSessionForAgent(agent.id)) continue;

      // Mark as initiated BEFORE async call to prevent duplicates
      sessionCreationInitiated.current.add(agent.id);

      // Create session in background (don't await, don't activate)
      createSessionForAgent(agent);
    }
  }, [agents, bridge, connectionState, getSessionForAgent, createSessionForAgent]);

  // When agent selected, activate its session (create if needed for terminal cells)
  useEffect(() => {
    if (!selectedAgentId || !bridge || connectionState !== 'connected') {
      if (!selectedAgentId) {
        setActiveSession(null);
      }
      return;
    }

    // Check if session already exists for this agent
    const existingSession = getSessionForAgent(selectedAgentId);
    if (existingSession) {
      setActiveSession(existingSession.sessionId);
      return;
    }

    // Get agent to determine type
    const agent = getAgent(selectedAgentId);
    if (!agent) {
      console.error('[App] Agent not found:', selectedAgentId);
      return;
    }

    // Claude agents (orchestrator/worker) should already have auto-created sessions
    // createSessionForAgent will activate when complete if this agent is still selected
    const isClaudeAgent = agent.cellType === 'orchestrator' || agent.cellType === 'worker';
    if (isClaudeAgent) {
      // Session creating in background - createSessionForAgent activates when done
      return;
    }

    // Create session for non-Claude agents (plain terminals) on demand
    // Mark as initiated to prevent duplicates
    if (!sessionCreationInitiated.current.has(agent.id)) {
      sessionCreationInitiated.current.add(agent.id);
      createSessionForAgent(agent).then((session) => {
        if (session) {
          setActiveSession(session.sessionId);
        }
      });
    }
  }, [
    selectedAgentId,
    bridge,
    connectionState,
    getSessionForAgent,
    getAgent,
    setActiveSession,
    createSessionForAgent,
  ]);

  // Window resize handler
  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keyboard spawn handler - spawns agent and auto-opens terminal panel
  const handleKeyboardSpawn = useCallback(
    (cellType: CellType, hex: HexCoordinate) => {
      const newAgentId = spawnAgent(hex, cellType);
      addSpawn(newAgentId, cellType, hex);
      // Agent is registered synchronously, safe to select immediately
      selectAgent(newAgentId);
    },
    [spawnAgent, addSpawn, selectAgent]
  );

  // Keyboard kill handler
  const handleKeyboardKill = useCallback(
    (hex: HexCoordinate) => {
      const agents = getAllAgents();
      const agentAtHex = agents.find(
        (a) => a.hex.q === hex.q && a.hex.r === hex.r
      );
      if (agentAtHex) {
        useAgentStore.getState().removeAgent(agentAtHex.id);
      }
    },
    [getAllAgents]
  );

  // Show help handler
  const handleShowHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  // Keyboard navigation - routes keys through keymap based on mode
  useKeyboardNavigation({
    onSpawn: handleKeyboardSpawn,
    onKill: handleKeyboardKill,
    onShowHelp: handleShowHelp,
    onPanToHex: panToHex,
    onCenterOnHex: centerOnHex,
  });

  // Animated mount/unmount for terminal panel
  // Pass sessionId when panel should be open, null when closing
  // Hook caches the value during exit animation so we can still render with it
  const panelSessionId = activeSessionId && selectedAgentId ? activeSessionId : null;
  const {
    shouldRender: panelShouldRender,
    isOpen: panelOpen,
    cachedValue: cachedSessionId,
  } = useAnimatedMount(panelSessionId, PANEL_ANIMATION_MS);

  const handleCloseTerminal = useCallback(async () => {
    // Just deselect agent - keep session alive in background
    selectAgent(null);
    setActiveSession(null);
  }, [selectAgent, setActiveSession]);

  return (
    <>
      <HexGrid width={dimensions.width} height={dimensions.height} />
      <ActionBar />
      {import.meta.env.DEV && <ControlPanel />}
      {import.meta.env.DEV && <EventLog />}
      {panelShouldRender && cachedSessionId && (
        <TerminalPanel
          sessionId={cachedSessionId}
          onClose={handleCloseTerminal}
          isOpen={panelOpen}
          dimensions={panelDimensions}
          onDimensionsChange={setPanelDimensions}
        />
      )}
      <StatusBar />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </>
  );
}

export default App;
