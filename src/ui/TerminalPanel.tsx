/**
 * Floating terminal panel with xterm.js.
 *
 * Renders left half of screen, wired to WebSocketBridge for real PTY sessions.
 * Press Escape to close.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTerminalStore } from '@state/terminalStore';
import './fonts.css';
import './TerminalPanel.css';

// Tokyo Night theme - matches popular terminal/editor themes
const TERMINAL_THEME = {
  foreground: '#c0caf5',
  background: 'transparent',
  cursor: '#c0caf5',
  cursorAccent: '#1a1b26',
  selectionBackground: '#33467c',
  selectionForeground: '#c0caf5',
  // Normal colors
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  // Bright colors
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
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
  const appendData = useTerminalStore((s) => s.appendData);

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
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        bridge.resize(sessionId, terminalRef.current.cols, terminalRef.current.rows);
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
