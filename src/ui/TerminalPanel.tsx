/**
 * Floating terminal panel with xterm.js.
 *
 * Renders left half of screen, wired to WebSocketBridge for real PTY sessions.
 * Press Escape to close.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTerminalStore } from '@state/terminalStore';
import './TerminalPanel.css';

interface TerminalPanelProps {
  sessionId: string;
  onClose: () => void;
}

export function TerminalPanel({ sessionId, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const bridge = useTerminalStore((s) => s.bridge);
  const getSession = useTerminalStore((s) => s.getSession);
  const appendData = useTerminalStore((s) => s.appendData);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !bridge) return;

    // Create terminal with transparent background
    const terminal = new Terminal({
      fontFamily: '"SF Mono", Consolas, monospace',
      fontSize: 14,
      theme: {
        background: 'transparent',
        foreground: '#f8f8f8',
      },
      allowTransparency: true,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Open terminal to DOM
    terminal.open(container);

    // Replay existing buffer (for reopened sessions)
    const session = getSession(sessionId);
    if (session?.buffer.length) {
      for (const chunk of session.buffer) {
        terminal.write(chunk);
      }
    }

    // Layout must settle before fitting
    setTimeout(() => {
      fitAddon.fit();
      terminal.focus();
    }, 0);

    // Wire data: bridge -> terminal AND store in buffer
    const unsubData = bridge.onData(sessionId, (data) => {
      terminal.write(data);
      appendData(sessionId, data);
    });

    // Wire data: terminal -> bridge
    const disposeOnData = terminal.onData((data) => {
      bridge.write(sessionId, data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        const { cols, rows } = terminal;
        bridge.resize(sessionId, cols, rows);
      }
    });
    resizeObserver.observe(container);

    // Escape key to close
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      resizeObserver.disconnect();
      disposeOnData.dispose();
      unsubData();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, bridge, onClose, getSession, appendData]);

  return (
    <div className="terminal-panel">
      <div className="terminal-panel__header">
        <span className="terminal-panel__title">Terminal - {sessionId}</span>
        <button className="terminal-panel__close" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="terminal-panel__body" ref={containerRef} />
    </div>
  );
}
