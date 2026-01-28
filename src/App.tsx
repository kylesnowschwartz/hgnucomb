import { useEffect, useState, useCallback, useRef } from 'react';
import { HexGrid } from '@ui/HexGrid';
import { ControlPanel } from '@ui/ControlPanel';
import { TerminalPanel } from '@ui/TerminalPanel';
import { EventLog } from '@ui/EventLog';
import { WebSocketBridge } from '@terminal/index';
import { useTerminalStore } from '@state/terminalStore';
import { useUIStore } from '@state/uiStore';
import { useAgentStore, type AgentState } from '@state/agentStore';
import type {
  McpRequest,
  McpSpawnResponse,
  McpGetGridResponse,
  McpGridAgent,
  McpBroadcastResponse,
  McpReportStatusResponse,
  McpReportResultResponse,
  McpGetMessagesResponse,
  AgentMessage,
} from '@terminal/types';
import type { HexCoordinate } from '@shared/types';
import { hexDistance, getHexRing } from '@shared/types';
import { agentToSnapshot } from '@shared/snapshot';
import { useEventLogStore } from '@state/eventLogStore';
import { useShallow } from 'zustand/shallow';

/**
 * Find nearest empty hex to a given position using ring expansion.
 * Searches distance 1, then 2, etc. until an empty hex is found.
 */
function findNearestEmptyHex(center: HexCoordinate, agents: AgentState[]): HexCoordinate {
  const occupied = new Set(agents.map((a) => `${a.hex.q},${a.hex.r}`));

  // Try rings of increasing distance
  for (let radius = 1; radius <= 10; radius++) {
    const ring = getHexRing(center, radius);
    for (const hex of ring) {
      if (!occupied.has(`${hex.q},${hex.r}`)) {
        return hex;
      }
    }
  }

  // Fallback: return adjacent hex even if occupied (shouldn't happen)
  return { q: center.q + 1, r: center.r };
}

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

  const { selectedAgentId, selectAgent } = useUIStore();
  const { getAgent, getAllAgents, spawnAgent, updateDetailedStatus, addMessageToInbox, getMessages } = useAgentStore();
  const { addBroadcast, addStatusChange, addSpawn } = useEventLogStore();

  // Track which agents we've already initiated session creation for
  const sessionCreationInitiated = useRef<Set<string>>(new Set());

  // Subscribe to agents for auto-session creation
  const agents = useAgentStore(useShallow((s) => Array.from(s.agents.values())));

  // Initialize bridge on mount
  useEffect(() => {
    const ws = new WebSocketBridge();
    setBridge(ws);

    const unsubConnection = ws.onConnectionChange((state) => {
      setConnectionState(state);
      console.log('[App] Connection state:', state);
    });

    ws.connect().catch((err) => {
      console.error('[App] Failed to connect:', err);
    });

    return () => {
      unsubConnection();
      ws.disconnect();
      setBridge(null);
    };
  }, [setBridge, setConnectionState]);

  // Handle MCP requests from orchestrator agents
  useEffect(() => {
    if (!bridge) return;

    const handleMcpRequest = (request: McpRequest) => {
      console.log('[App] MCP request:', request.type, request.payload);

      switch (request.type) {
        case 'mcp.spawn': {
          const { callerId, q, r, cellType, task, instructions, taskDetails } = request.payload;

          // Validate caller exists and is orchestrator
          const caller = getAgent(callerId);
          if (!caller) {
            const response: McpSpawnResponse = {
              type: 'mcp.spawn.result',
              requestId: request.requestId,
              payload: { success: false, error: `Caller agent not found: ${callerId}` },
            };
            bridge.sendMcpResponse(response);
            return;
          }

          if (caller.cellType !== 'orchestrator') {
            const response: McpSpawnResponse = {
              type: 'mcp.spawn.result',
              requestId: request.requestId,
              payload: { success: false, error: 'Only orchestrators can spawn agents' },
            };
            bridge.sendMcpResponse(response);
            return;
          }

          // Determine hex position
          let targetHex = { q: q ?? 0, r: r ?? 0 };
          if (q === undefined || r === undefined) {
            // Auto-position near caller using ring expansion
            targetHex = findNearestEmptyHex(caller.hex, getAllAgents());
          }

          // Check if hex is occupied
          const agents = getAllAgents();
          const occupied = agents.some(
            (a) => a.hex.q === targetHex.q && a.hex.r === targetHex.r
          );
          if (occupied) {
            const response: McpSpawnResponse = {
              type: 'mcp.spawn.result',
              requestId: request.requestId,
              payload: {
                success: false,
                error: `Hex (${targetHex.q}, ${targetHex.r}) is already occupied`,
              },
            };
            bridge.sendMcpResponse(response);
            return;
          }

          // Spawn the agent with task assignment and instructions
          // Store parentHex at spawn time - don't rely on lookup later
          const newAgentId = spawnAgent(targetHex, cellType, {
            parentId: callerId,
            parentHex: caller.hex,
            task,
            instructions,
            taskDetails,
          });
          addSpawn(newAgentId, cellType, targetHex);
          const response: McpSpawnResponse = {
            type: 'mcp.spawn.result',
            requestId: request.requestId,
            payload: { success: true, agentId: newAgentId, hex: targetHex },
          };
          bridge.sendMcpResponse(response);
          console.log('[App] MCP spawned agent:', newAgentId, 'at', targetHex, task ? `task: ${task}` : '', instructions ? 'with instructions' : '');
          break;
        }

        case 'mcp.getGrid': {
          const { callerId, maxDistance = 5 } = request.payload;

          // Validate caller exists
          const caller = getAgent(callerId);
          if (!caller) {
            const response: McpGetGridResponse = {
              type: 'mcp.getGrid.result',
              requestId: request.requestId,
              payload: { success: false, error: `Caller agent not found: ${callerId}` },
            };
            bridge.sendMcpResponse(response);
            return;
          }

          // Get agents within distance
          const agents = getAllAgents();
          const nearbyAgents: McpGridAgent[] = agents
            .map((a) => ({
              agentId: a.id,
              cellType: a.cellType,
              hex: a.hex,
              status: a.status,
              distance: hexDistance(caller.hex, a.hex),
            }))
            .filter((a) => a.distance <= maxDistance)
            .sort((a, b) => a.distance - b.distance);

          const response: McpGetGridResponse = {
            type: 'mcp.getGrid.result',
            requestId: request.requestId,
            payload: { success: true, agents: nearbyAgents },
          };
          bridge.sendMcpResponse(response);
          break;
        }

        case 'mcp.broadcast': {
          const { callerId, radius, broadcastType, broadcastPayload } = request.payload;

          // Validate caller exists
          const caller = getAgent(callerId);
          if (!caller) {
            const response: McpBroadcastResponse = {
              type: 'mcp.broadcast.result',
              requestId: request.requestId,
              payload: { success: false, delivered: 0, recipients: [], error: `Caller agent not found: ${callerId}` },
            };
            bridge.sendMcpResponse(response);
            return;
          }

          // Find agents within radius (excluding sender)
          const agents = getAllAgents();
          const recipients = agents
            .filter((a) => a.id !== callerId)
            .filter((a) => hexDistance(caller.hex, a.hex) <= radius)
            .map((a) => a.id);

          // Log the broadcast event
          addBroadcast(callerId, caller.hex, broadcastType, radius, recipients.length, broadcastPayload);

          // Deliver to recipient inboxes
          for (const recipientId of recipients) {
            const broadcastMessage: AgentMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              from: callerId,
              type: 'broadcast',
              payload: { broadcastType, broadcastPayload },
              timestamp: new Date().toISOString(),
            };
            addMessageToInbox(recipientId, broadcastMessage);
          }

          const response: McpBroadcastResponse = {
            type: 'mcp.broadcast.result',
            requestId: request.requestId,
            payload: { success: true, delivered: recipients.length, recipients },
          };
          bridge.sendMcpResponse(response);
          console.log('[App] Broadcast from', callerId, 'type:', broadcastType, 'delivered:', recipients.length);
          break;
        }

        case 'mcp.reportStatus': {
          const { callerId, state, message } = request.payload;

          // Update agent status
          const previousStatus = updateDetailedStatus(callerId, state, message);

          if (previousStatus === undefined) {
            const response: McpReportStatusResponse = {
              type: 'mcp.reportStatus.result',
              requestId: request.requestId,
              payload: { success: false, error: `Agent not found: ${callerId}` },
            };
            bridge.sendMcpResponse(response);
            return;
          }

          // Log the status change
          addStatusChange(callerId, state, message, previousStatus);

          const response: McpReportStatusResponse = {
            type: 'mcp.reportStatus.result',
            requestId: request.requestId,
            payload: { success: true },
          };
          bridge.sendMcpResponse(response);
          console.log('[App] Status update:', callerId, previousStatus, '->', state);
          break;
        }

        case 'mcp.reportResult': {
          const { callerId, parentId, result, success, message } = request.payload;

          // Validate parent exists
          const parent = getAgent(parentId);
          if (!parent) {
            const response: McpReportResultResponse = {
              type: 'mcp.reportResult.result',
              requestId: request.requestId,
              payload: { success: false, error: `Parent agent not found: ${parentId}` },
            };
            bridge.sendMcpResponse(response);
            return;
          }

          // Create message for parent's inbox
          const agentMessage: AgentMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            from: callerId,
            type: 'result',
            payload: { result, success, message },
            timestamp: new Date().toISOString(),
          };

          // Add to parent's inbox
          const added = addMessageToInbox(parentId, agentMessage);
          if (!added) {
            const response: McpReportResultResponse = {
              type: 'mcp.reportResult.result',
              requestId: request.requestId,
              payload: { success: false, error: `Failed to add message to parent inbox` },
            };
            bridge.sendMcpResponse(response);
            return;
          }

          const response: McpReportResultResponse = {
            type: 'mcp.reportResult.result',
            requestId: request.requestId,
            payload: { success: true },
          };
          bridge.sendMcpResponse(response);
          console.log('[App] Result reported from', callerId, 'to parent', parentId, 'success:', success);
          break;
        }

        case 'mcp.getMessages': {
          const { callerId, since } = request.payload;

          // Get messages from caller's inbox
          const messages = getMessages(callerId, since);

          const response: McpGetMessagesResponse = {
            type: 'mcp.getMessages.result',
            requestId: request.requestId,
            payload: { success: true, messages },
          };
          bridge.sendMcpResponse(response);
          console.log('[App] Get messages for', callerId, 'count:', messages.length);
          break;
        }
      }
    };

    const unsub = bridge.onMcpRequest(handleMcpRequest);
    return unsub;
  }, [bridge, getAgent, getAllAgents, spawnAgent, updateDetailedStatus, addBroadcast, addStatusChange, addSpawn, addMessageToInbox, getMessages]);

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

      // Build snapshots for context generation (Claude agents only)
      const agentSnapshot = isClaudeAgent
        ? agentToSnapshot(agent)
        : undefined;

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
