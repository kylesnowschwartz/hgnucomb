import { useEffect, useState, useCallback } from 'react';
import { HexGrid } from '@ui/HexGrid';
import { ControlPanel } from '@ui/ControlPanel';
import { TerminalPanel } from '@ui/TerminalPanel';
import { WebSocketBridge } from '@terminal/index';
import { useTerminalStore } from '@state/terminalStore';
import { useUIStore } from '@state/uiStore';
import { useAgentStore, type AgentState } from '@state/agentStore';
import type { AgentSnapshot } from '@shared/context';
import type { McpRequest, McpSpawnResponse, McpGetGridResponse, McpGridAgent } from '@terminal/types';
import type { HexCoordinate } from '@shared/types';
import { hexDistance, getHexRing } from '@shared/types';

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
  const { getAgent, getAllAgents, spawnAgent } = useAgentStore();

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
          const { callerId, q, r, cellType } = request.payload;

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

          // Spawn the agent
          const newAgentId = spawnAgent(targetHex, cellType);
          const response: McpSpawnResponse = {
            type: 'mcp.spawn.result',
            requestId: request.requestId,
            payload: { success: true, agentId: newAgentId, hex: targetHex },
          };
          bridge.sendMcpResponse(response);
          console.log('[App] MCP spawned agent:', newAgentId, 'at', targetHex);
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
      }
    };

    const unsub = bridge.onMcpRequest(handleMcpRequest);
    return unsub;
  }, [bridge, getAgent, getAllAgents, spawnAgent]);

  // When agent selected, ensure terminal session exists
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

    // Create new session for agent
    const agent = getAgent(selectedAgentId);
    if (!agent) {
      console.error('[App] Agent not found:', selectedAgentId);
      return;
    }

    // Orchestrators spawn Claude CLI, terminals spawn default shell
    const shell = agent.cellType === 'orchestrator' ? 'claude' : undefined;
    const env = {
      HGNUCOMB_AGENT_ID: agent.id,
      HGNUCOMB_HEX: `${agent.hex.q},${agent.hex.r}`,
      HGNUCOMB_CELL_TYPE: agent.cellType,
    };

    // Build snapshots for context generation (orchestrators only)
    const isOrchestrator = agent.cellType === 'orchestrator';
    const agentSnapshot: AgentSnapshot | undefined = isOrchestrator
      ? {
          agentId: agent.id,
          cellType: agent.cellType,
          hex: agent.hex,
          status: agent.status,
          connections: agent.connections,
        }
      : undefined;

    const allAgents: AgentSnapshot[] | undefined = isOrchestrator
      ? getAllAgents().map((a) => ({
          agentId: a.id,
          cellType: a.cellType,
          hex: a.hex,
          status: a.status,
          connections: a.connections,
        }))
      : undefined;

    bridge
      .createSession({ cols: 80, rows: 24, shell, env, agentSnapshot, allAgents })
      .then((session) => {
        addSession(session, selectedAgentId);
        setActiveSession(session.sessionId);

        // Always store data in buffer (even when panel is closed)
        bridge.onData(session.sessionId, (data) => {
          appendData(session.sessionId, data);
        });

        // Listen for exit
        bridge.onExit(session.sessionId, (exitCode) => {
          markExited(session.sessionId, exitCode);
        });
      })
      .catch((err) => {
        console.error('[App] Failed to create session:', err);
      });
  }, [
    selectedAgentId,
    bridge,
    connectionState,
    getSessionForAgent,
    getAgent,
    getAllAgents,
    addSession,
    appendData,
    setActiveSession,
    markExited,
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
      {activeSessionId && selectedAgentId && (
        <TerminalPanel sessionId={activeSessionId} onClose={handleCloseTerminal} />
      )}
    </>
  );
}

export default App;
