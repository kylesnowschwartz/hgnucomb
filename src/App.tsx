import { useEffect, useState, useCallback } from 'react';
import { HexGrid } from '@ui/HexGrid';
import { ControlPanel } from '@ui/ControlPanel';
import { TerminalPanel } from '@ui/TerminalPanel';
import { WebSocketBridge } from '@terminal/index';
import { useTerminalStore } from '@state/terminalStore';

function App() {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const {
    setBridge,
    setConnectionState,
    addSession,
    removeSession,
    markExited,
    activeSessionId,
    setActiveSession,
    bridge,
  } = useTerminalStore();

  // Initialize bridge and create session on mount
  useEffect(() => {
    const ws = new WebSocketBridge();
    setBridge(ws);

    // Track connection state
    const unsubConnection = ws.onConnectionChange((state) => {
      setConnectionState(state);
      console.log('[App] Connection state:', state);
    });

    // Connect and create initial session
    ws.connect()
      .then(async () => {
        console.log('[App] Connected to terminal server');
        const session = await ws.createSession({ cols: 80, rows: 24 });
        addSession(session);

        // Listen for exit events
        ws.onExit(session.sessionId, (exitCode) => {
          markExited(session.sessionId, exitCode);
        });
      })
      .catch((err) => {
        console.error('[App] Failed to connect:', err);
      });

    return () => {
      unsubConnection();
      ws.disconnect();
      setBridge(null);
    };
  }, [setBridge, setConnectionState, addSession, markExited]);

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
    if (!bridge || !activeSessionId) return;

    try {
      await bridge.disposeSession(activeSessionId);
      removeSession(activeSessionId);
      setActiveSession(null);
    } catch (err) {
      console.error('[App] Failed to dispose session:', err);
    }
  }, [bridge, activeSessionId, removeSession, setActiveSession]);

  return (
    <>
      <HexGrid width={dimensions.width} height={dimensions.height} />
      <ControlPanel />
      {activeSessionId && (
        <TerminalPanel sessionId={activeSessionId} onClose={handleCloseTerminal} />
      )}
    </>
  );
}

export default App;
