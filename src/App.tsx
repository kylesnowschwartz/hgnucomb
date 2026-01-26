import { useEffect, useState, useCallback } from 'react';
import { HexGrid } from '@ui/HexGrid';
import { ControlPanel } from '@ui/ControlPanel';
import { TerminalPanel } from '@ui/TerminalPanel';
import { WebSocketBridge } from '@terminal/index';
import { useTerminalStore } from '@state/terminalStore';
import { useUIStore } from '@state/uiStore';

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
    bridge
      .createSession({ cols: 80, rows: 24 })
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
