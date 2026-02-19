import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { HexGrid } from '@features/grid/HexGrid';
import { ActionBar } from '@features/grid/ActionBar';
import { ControlPanel } from '@features/controls/ControlPanel';
import { StatusBar } from '@features/controls/StatusBar';
import { TerminalPanel } from '@features/terminal/TerminalPanel';
import { WebSocketBridge } from '@features/terminal/index';
import { useTerminalStore, appendToBuffer } from '@features/terminal/terminalStore';
import { calculateTerminalDimensions } from '@features/terminal/terminalConfig';
import { useUIStore } from '@features/controls/uiStore';
import { useAgentStore, type AgentState } from '@features/agents/agentStore';
import { agentToSnapshot } from '@features/agents/snapshot';
import { useAgentSessionData } from '@features/agents/selectors';
import { useEventLogStore } from '@features/events/eventLogStore';
import { useKeyboardNavigation, HelpModal } from '@features/keyboard';
import { usePwaLifecycle } from '@features/pwa';
import { useViewportStore } from '@features/grid/viewportStore';
import { useProjectStore } from '@features/project/projectStore';
import { MetaPanel } from '@features/meta/MetaPanel';
import { createMcpHandler, type McpHandlerDeps } from './handlers/mcpHandler';
import { createNotificationHandler, type NotificationHandlerDeps } from './handlers/notificationHandler';
import type { AgentMessage } from '@shared/protocol';
import type { CellType, HexCoordinate } from '@shared/types';
import { assertNever } from '@shared/exhaustive';

// Activate persistence subscriptions (side-effect imports)
import '@features/agents/agentPersistence';
import '@features/project/projectPersistence';

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
      return assertNever(action);
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

// Default panel dimensions: wide and short, anchored bottom-left to maximize canvas
const DEFAULT_PANEL_WIDTH = Math.min(1100, window.innerWidth * 0.6);
const DEFAULT_PANEL_HEIGHT = Math.min(400, window.innerHeight * 0.45);

function App() {
  usePwaLifecycle();

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

  // Granular selectors: only subscribe to values that drive renders.
  // Actions are accessed via getState() in callbacks to avoid re-render cascades.
  const bridge = useTerminalStore((s) => s.bridge);
  const connectionState = useTerminalStore((s) => s.connectionState);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);

  const selectedAgentId = useUIStore((s) => s.selectedAgentId);
  const panToHex = useViewportStore((s) => s.panToHex);
  const centerOnHex = useViewportStore((s) => s.centerOnHex);

  // Track which agents we've already initiated session creation for
  const sessionCreationInitiated = useRef<Set<string>>(new Set());

  // Subscribe to agents for auto-session creation — only re-renders on agent
  // add/remove or cellType change (not activity broadcasts or status transitions)
  const agentSessionData = useAgentSessionData();

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

      const { addSession, markExited } = useTerminalStore.getState();

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

        // Replay buffered output (into module-level buffer, not Zustand)
        if (session.buffer.length > 0) {
          const fullOutput = session.buffer.join('');
          appendToBuffer(session.sessionId, fullOutput);
          console.log('[App] Replayed', session.buffer.length, 'chunks for', meta.agentId);
        }

        // Set up data listener for new output
        ws.onData(session.sessionId, (data) => {
          appendToBuffer(session.sessionId, data);
        });

        // Set up exit listener
        ws.onExit(session.sessionId, (exitCode) => {
          useTerminalStore.getState().markExited(session.sessionId, exitCode);
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
  }, []);

  // Initialize bridge on mount
  // Subscribe to server.info BEFORE connect() to avoid the race where the
  // server sends it immediately on WebSocket open but the notification
  // effect hasn't subscribed yet (React batches effects).
  useEffect(() => {
    const ws = new WebSocketBridge();
    useTerminalStore.getState().setBridge(ws);

    // Must be registered before connect() - server sends server.info on open
    const unsubNotifications = ws.onNotification((notification: unknown) => {
      if (typeof notification !== 'object' || notification === null) return;
      const msg = notification as { type: string; payload?: Record<string, unknown> };
      if (msg.type === 'server.info' && msg.payload) {
        const { defaultProjectDir } = msg.payload as { toolDir: string; defaultProjectDir: string };
        useProjectStore.getState().setServerDefault(defaultProjectDir);
      }
    });

    const unsubConnection = ws.onConnectionChange((state) => {
      useTerminalStore.getState().setConnectionState(state);
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
      unsubNotifications();
      unsubConnection();
      ws.disconnect();
      useTerminalStore.getState().setBridge(null);
    };
  }, [rehydrateFromServer]);

  // MCP handler dependencies - stable refs via getState(), never changes
  const mcpDeps: McpHandlerDeps = useMemo(
    () => ({
      getAgent: (id) => useAgentStore.getState().getAgent(id),
      getAllAgents: () => useAgentStore.getState().getAllAgents(),
      spawnAgent: (hex, cellType, options) =>
        useAgentStore.getState().spawnAgent(hex, cellType, options),
      addSpawn: (agentId, cellType, hex) =>
        useEventLogStore.getState().addSpawn(agentId, cellType, hex),
    }),
    []
  );

  // Notification handler dependencies - stable refs via getState(), never changes
  const notificationDeps: NotificationHandlerDeps = useMemo(
    () => ({
      getAgent: (id) => useAgentStore.getState().getAgent(id),
      updateAgentType: (agentId, newCellType) =>
        useAgentStore.getState().updateAgentType(agentId, newCellType),
      removeAgent: (id) => useAgentStore.getState().removeAgent(id),
      updateDetailedStatus: (agentId, status, message) =>
        useAgentStore.getState().updateDetailedStatus(agentId, status, message),
      updateActivities: (updates) =>
        useAgentStore.getState().updateActivities(updates),
      setAgentInbox: (agentId: string, messages: AgentMessage[]) => {
        const agent = useAgentStore.getState().getAgent(agentId);
        if (!agent) return;
        useAgentStore.setState((s) => ({
          agents: new Map(s.agents).set(agentId, { ...agent, inbox: messages }),
        }));
      },
      removeSession: (sessionId) =>
        useTerminalStore.getState().removeSession(sessionId),
      getSessionForAgent: (agentId) =>
        useTerminalStore.getState().getSessionForAgent(agentId),
      addRemoval: (agentId, reason) =>
        useEventLogStore.getState().addRemoval(agentId, reason),
      addMessageReceived: (recipientId, senderId, messageType, payload) =>
        useEventLogStore.getState().addMessageReceived(recipientId, senderId, messageType, payload),
      addBroadcast: (senderId, senderHex, broadcastType, radius, recipientCount, payload) =>
        useEventLogStore.getState().addBroadcast(senderId, senderHex, broadcastType, radius, recipientCount, payload),
      addStatusChange: (agentId, newStatus, message, previousStatus) =>
        useEventLogStore.getState().addStatusChange(agentId, newStatus, message, previousStatus),
      getSelectedAgentId: () => useUIStore.getState().selectedAgentId,
      selectAgent: (agentId) => useUIStore.getState().selectAgent(agentId),
    }),
    []
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
    const handler = createNotificationHandler(notificationDeps);
    return bridge.onNotification(handler);
  }, [bridge, notificationDeps]);

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
        ? useAgentStore.getState().getAllAgents().map(agentToSnapshot)
        : undefined;

      // Calculate initial terminal size from panel dimensions
      // This avoids the resize race where PTY starts at 80x24 but panel is narrower
      const { cols, rows } = calculateTerminalDimensions(
        panelDimensions.width,
        panelDimensions.height
      );

      // Agent-specific repoPath takes precedence over project-level projectDir.
      // This lets orchestrators in non-git dirs target specific repos for workers.
      const projectDir = agent.repoPath
        ?? useProjectStore.getState().effectiveProject()
        ?? undefined;

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
          projectDir,
        });

        useTerminalStore.getState().addSession(session, agent.id);

        // Always store data in buffer (outside Zustand — no re-renders)
        bridge.onData(session.sessionId, (data) => {
          appendToBuffer(session.sessionId, data);
        });

        // Listen for exit
        bridge.onExit(session.sessionId, (exitCode) => {
          useTerminalStore.getState().markExited(session.sessionId, exitCode);
        });

        // If this agent is currently selected, activate the session
        const currentSelectedId = useUIStore.getState().selectedAgentId;
        if (currentSelectedId === agent.id) {
          useTerminalStore.getState().setActiveSession(session.sessionId);
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
    [bridge, panelDimensions]
  );

  // Auto-create terminal sessions for Claude agents when they appear.
  // Uses projected agentSessionData (id + cellType) for reactivity — only fires
  // when agents are added/removed, not on activity broadcasts or status transitions.
  // Reads full AgentState imperatively for createSessionForAgent.
  useEffect(() => {
    if (!bridge || connectionState !== 'connected') return;

    for (const data of agentSessionData) {
      // Only auto-create for Claude agents (orchestrator/worker)
      const isClaudeAgent = data.cellType === 'orchestrator' || data.cellType === 'worker';
      if (!isClaudeAgent) continue;

      // Skip if already initiated or session exists
      if (sessionCreationInitiated.current.has(data.id)) continue;
      if (useTerminalStore.getState().getSessionForAgent(data.id)) continue;

      // Read full agent state for session creation
      const agent = useAgentStore.getState().getAgent(data.id);
      if (!agent) continue;

      // Mark as initiated BEFORE async call to prevent duplicates
      sessionCreationInitiated.current.add(data.id);

      // Create session in background (don't await, don't activate)
      createSessionForAgent(agent);
    }
  }, [agentSessionData, bridge, connectionState, createSessionForAgent]);

  // When agent selected, activate its session (create if needed for terminal cells)
  useEffect(() => {
    if (!selectedAgentId || !bridge || connectionState !== 'connected') {
      if (!selectedAgentId) {
        useTerminalStore.getState().setActiveSession(null);
      }
      return;
    }

    // Check if session already exists for this agent
    const existingSession = useTerminalStore.getState().getSessionForAgent(selectedAgentId);
    if (existingSession) {
      useTerminalStore.getState().setActiveSession(existingSession.sessionId);
      return;
    }

    // Get agent to determine type
    const agent = useAgentStore.getState().getAgent(selectedAgentId);
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
          useTerminalStore.getState().setActiveSession(session.sessionId);
        }
      });
    }
  }, [
    selectedAgentId,
    bridge,
    connectionState,
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
      const newAgentId = useAgentStore.getState().spawnAgent(hex, cellType);
      useEventLogStore.getState().addSpawn(newAgentId, cellType, hex);
      // Agent is registered synchronously, safe to select immediately
      useUIStore.getState().selectAgent(newAgentId);
    },
    []
  );

  // Keyboard kill handler - disposes server session then removes client state
  const handleKeyboardKill = useCallback(
    (hex: HexCoordinate) => {
      const allAgents = useAgentStore.getState().getAllAgents();
      const agentAtHex = allAgents.find(
        (a) => a.hex.q === hex.q && a.hex.r === hex.r
      );
      if (agentAtHex) {
        // Tell server to kill the PTY and clean up session/metadata/worktree
        useTerminalStore.getState().removeSessionForAgent(agentAtHex.id);
        // Remove from client-side agent store
        useAgentStore.getState().removeAgent(agentAtHex.id);
      }
    },
    []
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
    useUIStore.getState().selectAgent(null);
    useTerminalStore.getState().setActiveSession(null);
  }, []);

  return (
    <>
      <HexGrid width={dimensions.width} height={dimensions.height} />
      <MetaPanel />
      <ActionBar />
      {import.meta.env.DEV && <ControlPanel />}
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
