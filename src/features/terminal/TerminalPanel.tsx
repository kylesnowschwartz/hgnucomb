/**
 * Floating terminal panel with xterm.js.
 *
 * Renders left half of screen, wired to WebSocketBridge for real PTY sessions.
 * Close via header X button or grid click-away.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
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
  const [isFocused, setIsFocused] = useState(false);

  // Draggable panel - starts top-left
  const { handleMouseDown, style: dragStyle } = useDraggable({ initialX: 20, initialY: 20 });

  // Re-focus terminal to ensure keyboard input reaches xterm.js
  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  // Track focus state for visual feedback
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleFocusIn = () => setIsFocused(true);
    const handleFocusOut = (e: FocusEvent) => {
      // Only unfocus if focus moved outside the panel entirely
      if (!container.contains(e.relatedTarget as Node)) {
        setIsFocused(false);
      }
    };

    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleFocusOut);

    return () => {
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Re-focus terminal on any keydown when panel is open but unfocused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If terminal exists and focus is outside the panel, refocus
      if (terminalRef.current && !containerRef.current?.contains(document.activeElement)) {
        terminalRef.current.focus();
        // For Escape specifically, we need to send it manually since the focus
        // happens after the keydown event
        if (e.key === 'Escape') {
          // Send escape character to terminal
          bridge?.write(sessionId, '\x1b');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionId, bridge]);

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

    // Snapshot the buffer BEFORE setting up data handlers to avoid duplicates
    // Any data that arrives after this will be handled by the live data handler
    const session = getSession(sessionId);
    const bufferSnapshot = session?.buffer ? [...session.buffer] : [];

    // Wire data handlers to catch any incoming data
    const unsubData = bridge.onData(sessionId, (data) => {
      terminal.write(data);
    });

    // Wire data: terminal -> bridge
    const disposeOnData = terminal.onData((data) => {
      bridge.write(sessionId, data);
    });

    // Wait for layout to settle, then fit and replay buffer at correct size
    // Using requestAnimationFrame ensures the DOM is painted before we measure
    requestAnimationFrame(() => {
      if (!terminalRef.current) return; // Component unmounted

      fitAddon.fit();
      bridge.resize(sessionId, terminal.cols, terminal.rows);

      // Replay the buffer snapshot AFTER fitting so content renders at correct size
      // New data arriving after the snapshot is handled by the live data handler
      if (bufferSnapshot.length) {
        for (const chunk of bufferSnapshot) {
          terminal.write(chunk);
        }
      }

      terminal.focus();
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

  const panelClasses = `terminal-panel ${isFocused ? 'terminal-panel--focused' : ''}`;

  return (
    <div className={panelClasses} style={dragStyle}>
      <div
        className="terminal-panel__header"
        onMouseDown={handleMouseDown}
        onMouseUp={focusTerminal} // Re-focus after drag
      >
        <span className="terminal-panel__title">Terminal - {sessionId}</span>
        <button className="terminal-panel__close" onClick={onClose}>
          &times;
        </button>
      </div>
      <div
        className="terminal-panel__body"
        ref={containerRef}
        onClick={focusTerminal} // Re-focus on click
      />
    </div>
  );
}
