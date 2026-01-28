import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { HexGrid } from '@features/grid/HexGrid';
import { ControlPanel } from '@features/controls/ControlPanel';
import { TerminalPanel } from '@features/terminal/TerminalPanel';
import { EventLog } from '@features/events/EventLog';
import { WebSocketBridge } from '@features/terminal/index';
import { useTerminalStore } from '@features/terminal/terminalStore';
import { useUIStore } from '@features/controls/uiStore';
import { useAgentStore, type AgentState } from '@features/agents/agentStore';
import { agentToSnapshot } from '@features/agents/snapshot';
import { useEventLogStore } from '@features/events/eventLogStore';
import { useShallow } from 'zustand/shallow';
import { createMcpHandler, type McpHandlerDeps } from './handlers/mcpHandler';

function App() {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const {
    bridge,
    setBridge,
    setConnectionState,
    connectionState,
    addSession,
    appendData,
    markExited,
    activeSessionId,
    setActiveSession,
    getSessionForAgent,
  } = useTerminalStore();

  const { selectedAgentId, selectAgent, selectedHex, clearSelection } = useUIStore();
  const { getAgent, getAllAgents, spawnAgent, updateDetailedStatus, addMessageToInbox, getMessages } = useAgentStore();
  const { addBroadcast, addStatusChange, addSpawn } = useEventLogStore();

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
      addMessageToInbox,
      getMessages,
      addBroadcast,
      addStatusChange,
      addSpawn,
    }),
    [getAgent, getAllAgents, spawnAgent, updateDetailedStatus, addMessageToInbox, getMessages, addBroadcast, addStatusChange, addSpawn]
  );

  // Handle MCP requests from orchestrator agents
  useEffect(() => {
    if (!bridge) return;
    const handler = createMcpHandler(mcpDeps, bridge);
    return bridge.onMcpRequest(handler);
  }, [bridge, mcpDeps]);

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

      try {
        const session = await bridge.createSession({
          cols: 80,
          rows: 24,
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
    [bridge, getAllAgents, addSession, appendData, markExited, setActiveSession]
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

  // Keyboard shortcuts for hex selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: clear selection (only when panel not open)
      if (e.key === 'Escape' && !activeSessionId) {
        clearSelection();
        return;
      }

      // Enter: open panel for agent at selected hex (no-op if empty)
      if (e.key === 'Enter' && selectedHex) {
        const agents = getAllAgents();
        const agentAtHex = agents.find(
          (a) => a.hex.q === selectedHex.q && a.hex.r === selectedHex.r
        );
        if (agentAtHex) {
          selectAgent(agentAtHex.id);
        }
        // Silent no-op if cell is empty - user must double-click to spawn first
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedHex, activeSessionId, clearSelection, selectAgent, getAllAgents]);

  const handleCloseTerminal = useCallback(async () => {
    // Just deselect agent - keep session alive in background
    selectAgent(null);
    setActiveSession(null);
  }, [selectAgent, setActiveSession]);

  return (
    <>
      <HexGrid width={dimensions.width} height={dimensions.height} />
      <ControlPanel />
      <EventLog />
      {activeSessionId && selectedAgentId && (
        <TerminalPanel sessionId={activeSessionId} onClose={handleCloseTerminal} />
      )}
    </>
  );
}

export default App;
