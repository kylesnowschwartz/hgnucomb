/**
 * Floating terminal panel with xterm.js.
 *
 * Renders left half of screen, wired to WebSocketBridge for real PTY sessions.
 * Close via header X button or grid click-away.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTerminalStore } from './terminalStore';
import { useDraggable } from '@features/grid/useDraggable';
import { xtermTheme } from '@theme/catppuccin-mocha';
import './fonts.css';
import './TerminalPanel.css';

// Catppuccin Latte theme with transparent background for panel integration
const TERMINAL_THEME = {
  ...xtermTheme,
  background: 'transparent',
};

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

  // Draggable panel - starts top-left
  const { handleMouseDown, style: dragStyle } = useDraggable({ initialX: 20, initialY: 20 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !bridge) return;

    // Create terminal with Nerd Font and Tokyo Night theme
    const terminal = new Terminal({
      fontFamily: '"JetBrainsMono Nerd Font", "SF Mono", Consolas, monospace',
      fontSize: 14,
      theme: TERMINAL_THEME,
      allowTransparency: true,
      cursorBlink: true,
      // xterm.js specific options for better rendering
      customGlyphs: true, // Use built-in box drawing glyphs
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Open terminal to DOM
    terminal.open(container);

    // Enable GPU-accelerated rendering
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      // WebGL context lost - fall back to canvas renderer
      webglAddon.dispose();
    });
    terminal.loadAddon(webglAddon);

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
      // Sync PTY size after fit
      bridge.resize(sessionId, terminal.cols, terminal.rows);
    }, 0);

    // Wire data: bridge -> terminal (buffer storage handled by App.tsx)
    const unsubData = bridge.onData(sessionId, (data) => {
      terminal.write(data);
    });

    // Wire data: terminal -> bridge
    const disposeOnData = terminal.onData((data) => {
      bridge.write(sessionId, data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        bridge.resize(sessionId, terminalRef.current.cols, terminalRef.current.rows);
      }
    });
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      disposeOnData.dispose();
      unsubData();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, bridge, onClose, getSession]);

  return (
    <div className="terminal-panel" style={dragStyle}>
      <div className="terminal-panel__header" onMouseDown={handleMouseDown}>
        <span className="terminal-panel__title">Terminal - {sessionId}</span>
        <button className="terminal-panel__close" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="terminal-panel__body" ref={containerRef} />
    </div>
  );
}
