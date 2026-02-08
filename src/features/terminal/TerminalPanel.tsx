/**
 * Floating terminal panel with xterm.js.
 *
 * Features:
 * - Slide-out drawer animation from left
 * - Draggable via header
 * - Resizable via corner handle
 * Close via header X button or grid click-away.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTerminalStore } from './terminalStore';
import { TERMINAL_FONT } from './terminalConfig';
import { xtermTheme } from '@theme/catppuccin-mocha';
import './fonts.css';
import './TerminalPanel.css';

// Use the Catppuccin theme directly (no transparency - better WebGL compatibility)
const TERMINAL_THEME = xtermTheme;

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

interface PanelDimensions {
  width: number;
  height: number;
}

interface TerminalPanelProps {
  sessionId: string;
  onClose: () => void;
  isOpen?: boolean;
  /** Panel dimensions - controlled by parent for persistence */
  dimensions: PanelDimensions;
  onDimensionsChange: (dims: PanelDimensions) => void;
}

export function TerminalPanel({
  sessionId,
  onClose,
  isOpen = true,
  dimensions,
  onDimensionsChange,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const bridge = useTerminalStore((s) => s.bridge);
  const getSession = useTerminalStore((s) => s.getSession);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Panel position (internal state - resets on remount)
  const [position, setPosition] = useState({ x: 20, y: 20 });

  // Drag state
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Resize state
  const isResizing = useRef(false);
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Handle drag start on header
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position.x, position.y]);

  // Handle resize start on corner
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: dimensions.width,
      height: dimensions.height,
    };
  }, [dimensions.width, dimensions.height]);

  // Global mouse move/up for drag and resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        const newX = e.clientX - dragOffset.current.x;
        const newY = e.clientY - dragOffset.current.y;
        // Clamp to viewport bounds
        const clampedX = Math.max(0, Math.min(newX, window.innerWidth - 100));
        const clampedY = Math.max(0, Math.min(newY, window.innerHeight - 50));
        setPosition({ x: clampedX, y: clampedY });
      }

      if (isResizing.current) {
        const deltaX = e.clientX - resizeStart.current.x;
        const deltaY = e.clientY - resizeStart.current.y;
        const newWidth = Math.max(MIN_WIDTH, resizeStart.current.width + deltaX);
        const newHeight = Math.max(MIN_HEIGHT, resizeStart.current.height + deltaY);
        // Clamp to viewport
        const maxWidth = window.innerWidth - position.x - 20;
        const maxHeight = window.innerHeight - position.y - 20;
        onDimensionsChange({
          width: Math.min(newWidth, maxWidth),
          height: Math.min(newHeight, maxHeight),
        });
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      isResizing.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [position.x, position.y, onDimensionsChange]);

  // Re-focus terminal to ensure keyboard input reaches xterm.js
  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  // Handle image drag-and-drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only unset if leaving the panel entirely (not just entering a child element)
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (!bridge) return;

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      console.log('[TerminalPanel] No image files in drop');
      return;
    }

    for (const file of imageFiles) {
      try {
        // Read file as base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        console.log(`[TerminalPanel] Uploading image: ${file.name}`);

        // Upload to server - path is automatically injected into stdin
        await bridge.uploadImage(sessionId, {
          filename: file.name,
          data: base64,
          mimeType: file.type,
        });

        console.log(`[TerminalPanel] Image uploaded: ${file.name}`);
      } catch (err) {
        console.error(`[TerminalPanel] Failed to upload ${file.name}:`, err);
      }
    }
  }, [sessionId, bridge]);

  // Refit terminal when dimensions change
  useEffect(() => {
    if (fitAddonRef.current && terminalRef.current && bridge) {
      fitAddonRef.current.fit();
      bridge.resize(sessionId, terminalRef.current.cols, terminalRef.current.rows);
    }
  }, [dimensions, bridge, sessionId]);

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
  // EXCEPT for Cmd+ modified keys which are handled by keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't refocus on Cmd+ keys - those are for navigation
      if (e.metaKey) return;

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

    // Get session dimensions to initialize xterm.js at the correct size
    // This prevents the resize race where xterm defaults to 80x24
    const session = getSession(sessionId);
    const initialCols = session?.cols ?? 80;
    const initialRows = session?.rows ?? 24;

    // Create terminal with Nerd Font and Catppuccin theme
    // Enable Kitty keyboard protocol for proper Shift+Enter handling with Claude Code
    const terminal = new Terminal({
      cols: initialCols,
      rows: initialRows,
      fontFamily: TERMINAL_FONT.family,
      fontSize: TERMINAL_FONT.size,
      theme: TERMINAL_THEME,
      cursorBlink: true,
      overviewRuler: {}, // Disable overview ruler
      vtExtensions: {
        kittyKeyboard: true,
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Open terminal to DOM
    terminal.open(container);

    // Terminal captures ALL keys when focused - acts like a real terminal
    // EXCEPT global controls (Cmd+Esc, Shift+X) and clipboard shortcuts
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Cmd+Esc is the global "escape hatch" - always passes through to app
      if (e.metaKey && e.key === 'Escape') {
        return false; // Don't handle in xterm, let it bubble to window
      }
      // Shift+X is the kill command - passes through to app
      if (e.shiftKey && (e.key === 'x' || e.key === 'X')) {
        return false; // Let app handle kill
      }
      // Let browser handle clipboard shortcuts natively (copy/paste/cut/select-all)
      if (e.metaKey && (e.key === 'c' || e.key === 'v' || e.key === 'x' || e.key === 'a')) {
        return false; // Don't intercept in xterm
      }
      // Everything else stays in the terminal
      return true;
    });

    // Enable GPU-accelerated rendering
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
    });
    terminal.loadAddon(webglAddon);

    // Snapshot the buffer BEFORE setting up data handlers to avoid duplicates
    // Any data that arrives after this will be handled by the live data handler
    // Reuse session from above (already fetched for dimensions)
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

  const panelClasses = [
    'terminal-panel',
    isFocused ? 'terminal-panel--focused' : '',
    isOpen ? 'terminal-panel--open' : 'terminal-panel--closed',
    isDragOver ? 'terminal-panel--drag-over' : '',
  ].filter(Boolean).join(' ');

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    width: dimensions.width,
    height: dimensions.height,
  };

  return (
    <div className={panelClasses} style={panelStyle} ref={panelRef}>
      <div
        className="terminal-panel__header"
        onMouseDown={handleDragStart}
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
        onClick={focusTerminal}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      <div
        className="terminal-panel__resize-handle"
        onMouseDown={handleResizeStart}
        title="Drag to resize"
      />
    </div>
  );
}
