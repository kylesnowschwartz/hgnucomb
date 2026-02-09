/**
 * HexGrid - Navigable hexagonal grid canvas with pan/zoom.
 *
 * Uses react-konva for rendering. Supports:
 * - Mouse drag to pan
 * - Mouse wheel to zoom (cursor-relative)
 * - Clamped zoom levels (0.3x to 3.0x)
 *
 * @see .agent-history/context-packet-task4-hex-grid.md
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Stage, Layer, Line, RegularPolygon, Circle, Group, Text } from 'react-konva';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { hexToPixel, hexesInRect, TERMINAL_STATUSES } from '@shared/types';
import type { AgentStatus, CellType, DetailedStatus } from '@shared/types';
import { useAgentStore, type AgentState, type FlashType } from '@features/agents/agentStore';
import { useUIStore } from '@features/controls/uiStore';
import { useEventLogStore } from '@features/events/eventLogStore';
import { useViewportStore } from './viewportStore';
import { useShallow } from 'zustand/shallow';
import { hexGrid, agentColors, palette } from '@theme/catppuccin-mocha';

// ============================================================================
// Color Utilities
// ============================================================================

/** Darken a hex color by a factor (0-1, where 0.3 = 30% darker) */
function darkenColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const darken = (c: number) => Math.round(c * (1 - factor));
  return `#${darken(r).toString(16).padStart(2, '0')}${darken(g).toString(16).padStart(2, '0')}${darken(b).toString(16).padStart(2, '0')}`;
}

// ============================================================================
// Style Constants
// ============================================================================

const STYLE = {
  background: hexGrid.background,
  hexFill: hexGrid.hexFill,
  hexFillHover: hexGrid.hexFillHover,
  hexStroke: hexGrid.hexStroke,
  accentNeon: hexGrid.accentNeon,
  originMarkerStroke: hexGrid.originMarker,
  gridStrokeWidth: 1,
  hexSize: 40,
  minZoom: 0.3,
  maxZoom: 3.0,
  zoomFactor: 1.08,
} as const;

const CELL_COLORS: Record<CellType, string> = {
  terminal: agentColors.terminal,
  orchestrator: agentColors.orchestrator,
  worker: agentColors.worker,
};

const STATUS_OPACITY: Record<AgentStatus, number> = {
  idle: 1.0,
  working: 1.0,
  blocked: 0.5,
  offline: 0.3,
};

// ============================================================================
// Satellite Indicators - conditional labels around the center badge
//
// Zoom fade: satellites are illegible at low zoom. Fade them out below 0.8x
// and fully hide below 0.5x. Badge remains always visible.
// ============================================================================

/** Compute satellite opacity based on current zoom scale */
function satelliteOpacity(scale: number): number {
  return Math.min(1, Math.max(0, (scale - 0.5) / 0.3));
}

/** Format elapsed time for satellite display: "0m", "3m", "1h", "2h" */
function formatElapsed(createdAt: number, now: number): string {
  const elapsedMs = now - createdAt;
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

/** Format idle time: "idle 1m", "idle 5m" */
function formatIdle(lastActivityAt: number, now: number): string | null {
  if (!lastActivityAt) return null;
  const idleMs = now - lastActivityAt;
  if (idleMs < 60000) return null; // Less than 1 minute idle - don't show
  const minutes = Math.floor(idleMs / 60000);
  if (minutes < 60) return `idle ${minutes}m`;
  return `idle ${Math.floor(minutes / 60)}h`;
}

// ============================================================================
// Status Badge System - Visual indicators at center of hex cells
//
// Motion encodes urgency:
//   Flash  = needs human attention (waiting_input, waiting_permission, stuck)
//   Pulse  = booting up (pending)
//   Bounce = actively working (working)
//   Static = terminal or inactive (idle, done, error, cancelled)
//
// Color follows universal semaphore:
//   Grey   = inactive (pending, idle, cancelled)
//   Blue   = in progress (working)
//   Yellow = needs input (waiting_input)
//   Orange = needs approval (waiting_permission)
//   Red    = error or stuck (stuck, error)
//   Green  = success (done)
// ============================================================================

const BADGE_RADIUS = 10;

interface StatusBadgeConfig {
  /** 'ring' = hollow stroke, 'dots' = bouncing dot trio, 'label' = filled circle with text */
  type: 'ring' | 'dots' | 'label';
  color: string;
  label?: string;
  textColor?: string;
  /** Opacity oscillation (0.5-1.0) for attention states */
  flash?: boolean;
  /** Scale oscillation (0.8-1.2) for pending/booting */
  pulse?: boolean;
}

const STATUS_BADGE_CONFIG: Record<DetailedStatus, StatusBadgeConfig> = {
  pending:            { type: 'ring',  color: palette.overlay0, pulse: true },
  idle:               { type: 'ring',  color: palette.overlay0 },
  working:            { type: 'dots',  color: palette.blue },
  waiting_input:      { type: 'label', color: palette.yellow, label: '?', textColor: palette.crust, flash: true },
  waiting_permission: { type: 'label', color: palette.peach,  label: '!', textColor: palette.crust, flash: true },
  stuck:              { type: 'label', color: palette.red,    label: 'X', textColor: palette.crust, flash: true },
  done:               { type: 'label', color: palette.green,  label: '\u2713', textColor: palette.crust },
  error:              { type: 'label', color: palette.red,    label: '\u2715', textColor: palette.crust },
  cancelled:          { type: 'label', color: palette.overlay0, label: '\u2014', textColor: palette.crust },
};

// ============================================================================
// Shared Animation Loop
//
// All animated badges register callbacks with a single Konva.Animation instead
// of each creating their own. One animation = one rAF = one layer redraw per
// frame, eliminating jitter from competing animation loops.
// ============================================================================

/** Callback invoked on each animation frame with elapsed seconds */
type AnimUpdateFn = (timeSec: number) => void;
/** Register an animation callback by id, returns unregister function */
type AnimRegisterFn = (id: string, cb: AnimUpdateFn) => () => void;

// ============================================================================
// Badge Components
// ============================================================================

/** Hollow ring - static for idle, pulsing for pending */
function RingBadge({ x, y, color, pulse, registerAnim, animId }: {
  x: number; y: number; color: string; pulse?: boolean;
  registerAnim: AnimRegisterFn; animId: string;
}) {
  const circleRef = useRef<Konva.Circle>(null);

  useEffect(() => {
    if (!pulse) return;
    return registerAnim(animId, (t) => {
      if (!circleRef.current) return;
      const s = 1 + Math.sin(t * Math.PI) * 0.2;
      circleRef.current.scaleX(s);
      circleRef.current.scaleY(s);
    });
  }, [pulse, registerAnim, animId]);

  return (
    <Circle
      ref={circleRef}
      x={x}
      y={y}
      radius={BADGE_RADIUS * 0.6}
      stroke={color}
      strokeWidth={2}
      listening={false}
    />
  );
}

/** Three bouncing dots - working state */
function DotsBadge({ x, y, color, registerAnim, animId }: {
  x: number; y: number; color: string;
  registerAnim: AnimRegisterFn; animId: string;
}) {
  const dot1Ref = useRef<Konva.Circle>(null);
  const dot2Ref = useRef<Konva.Circle>(null);
  const dot3Ref = useRef<Konva.Circle>(null);

  useEffect(() => {
    return registerAnim(animId, (t) => {
      const bounce = (offset: number) => Math.sin((t + offset) * Math.PI * 2) * 3;
      dot1Ref.current?.y(bounce(0));
      dot2Ref.current?.y(bounce(0.15));
      dot3Ref.current?.y(bounce(0.3));
    });
  }, [registerAnim, animId]);

  const dotRadius = 2.5;
  const spacing = 6;

  return (
    <Group x={x} y={y} listening={false}>
      <Circle ref={dot1Ref} x={-spacing} y={0} radius={dotRadius} fill={color} />
      <Circle ref={dot2Ref} x={0} y={0} radius={dotRadius} fill={color} />
      <Circle ref={dot3Ref} x={spacing} y={0} radius={dotRadius} fill={color} />
    </Group>
  );
}

/** Filled circle with text label - attention and terminal states */
function LabelBadge({ x, y, color, label, textColor, flash, registerAnim, animId }: {
  x: number; y: number; color: string; label: string; textColor: string; flash?: boolean;
  registerAnim: AnimRegisterFn; animId: string;
}) {
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    if (!flash) return;
    return registerAnim(animId, (t) => {
      if (!groupRef.current) return;
      groupRef.current.opacity(0.75 + Math.sin(t * Math.PI * 2) * 0.25);
    });
  }, [flash, registerAnim, animId]);

  return (
    <Group ref={groupRef} x={x} y={y} listening={false}>
      <Circle radius={BADGE_RADIUS} fill={color} />
      <Text
        text={label}
        fontSize={12}
        fontStyle="bold"
        fontFamily="monospace"
        fill={textColor}
        align="center"
        verticalAlign="middle"
        width={BADGE_RADIUS * 2}
        height={BADGE_RADIUS * 2}
        offsetX={BADGE_RADIUS}
        offsetY={BADGE_RADIUS}
      />
    </Group>
  );
}

/** Dark backing circle for contrast against colored hex fills */
function BadgeBackground({ x, y }: { x: number; y: number }) {
  return (
    <Circle
      x={x}
      y={y}
      radius={BADGE_RADIUS + 3}
      fill={palette.crust}
      opacity={0.7}
      listening={false}
    />
  );
}

/** Whether a badge color is bright enough to need a dark background for contrast */
const DARK_COLORS: Set<string> = new Set([palette.overlay0, palette.crust, palette.surface0, palette.surface1]);
function needsBackground(color: string): boolean {
  return !DARK_COLORS.has(color);
}

/** Routes DetailedStatus to the appropriate badge component */
function StatusBadge({ status, x, y, registerAnim, animId }: {
  status: DetailedStatus; x: number; y: number;
  registerAnim: AnimRegisterFn; animId: string;
}) {
  const config = STATUS_BADGE_CONFIG[status];
  const showBg = needsBackground(config.color);

  switch (config.type) {
    case 'ring':
      return <RingBadge x={x} y={y} color={config.color} pulse={config.pulse} registerAnim={registerAnim} animId={animId} />;
    case 'dots':
      return (
        <Group listening={false}>
          {showBg && <BadgeBackground x={x} y={y} />}
          <DotsBadge x={x} y={y} color={config.color} registerAnim={registerAnim} animId={animId} />
        </Group>
      );
    case 'label':
      return (
        <Group listening={false}>
          {showBg && <BadgeBackground x={x} y={y} />}
          <LabelBadge
            x={x} y={y}
            color={config.color}
            label={config.label!}
            textColor={config.textColor!}
            flash={config.flash}
            registerAnim={registerAnim}
            animId={animId}
          />
        </Group>
      );
  }
}

// ============================================================================
// Flash Overlay - brief color pulse on status transitions
// ============================================================================

const FLASH_DURATION_MS = 400;
const FLASH_COLORS: Record<string, string> = {
  done: palette.green,
  error: palette.red,
};

/** Temporary hex overlay that fades from 30% opacity to 0. Pure animation, no callbacks. */
function FlashOverlay({ x, y, hexSize, flashType }: {
  x: number; y: number; hexSize: number; flashType: string;
}) {
  const polygonRef = useRef<Konva.RegularPolygon>(null);

  useEffect(() => {
    const node = polygonRef.current;
    if (!node) return;

    const tween = new Konva.Tween({
      node,
      duration: FLASH_DURATION_MS / 1000,
      opacity: 0,
      easing: Konva.Easings.EaseOut,
    });
    tween.play();

    return () => { tween.destroy(); };
  }, []);

  return (
    <RegularPolygon
      ref={polygonRef}
      x={x}
      y={y}
      sides={6}
      radius={hexSize}
      fill={FLASH_COLORS[flashType] ?? palette.green}
      opacity={0.3}
      listening={false}
    />
  );
}

// ============================================================================
// Component Props
// ============================================================================

export interface HexGridProps {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Hex cell radius in pixels (default: 40) */
  hexSize?: number;
}

// ============================================================================
// Component
// ============================================================================

export function HexGrid({
  width,
  height,
  hexSize = STYLE.hexSize,
}: HexGridProps) {
  // Tick counter for elapsed time updates (1-second re-render)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Viewport state (local state, synced to store for external components)
  const [scale, setScaleLocal] = useState(1);
  const [position, setPositionLocal] = useState({ x: width / 2, y: height / 2 });

  // Store setters and pending pan
  const setViewport = useViewportStore((s) => s.setViewport);
  const setHexSizeStore = useViewportStore((s) => s.setHexSize);
  const setContainerSize = useViewportStore((s) => s.setContainerSize);
  const pendingPan = useViewportStore((s) => s.pendingPan);
  const clearPendingPan = useViewportStore((s) => s.clearPendingPan);

  // Sync local → store on local changes (from drag/zoom)
  useEffect(() => {
    setViewport(scale, position);
  }, [scale, position, setViewport]);

  // Sync hexSize and container size to store on mount/resize
  useEffect(() => {
    setHexSizeStore(hexSize);
  }, [hexSize, setHexSizeStore]);

  useEffect(() => {
    setContainerSize({ width, height });
  }, [width, height, setContainerSize]);

  // Initialize store position on mount
  useEffect(() => {
    setViewport(scale, { x: width / 2, y: height / 2 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply pending pan from external source (keyboard navigation)
  // This synchronizes external store state with local React state - intentional setState in effect
  useEffect(() => {
    if (pendingPan) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sync external store -> local state
      setPositionLocal(pendingPan.position);
      clearPendingPan();
    }
  }, [pendingPan, clearPendingPan]);

  // Wrappers to update local state (triggers sync effect)
  const setScale = useCallback((newScale: number) => {
    setScaleLocal(newScale);
  }, []);

  const setPosition = useCallback((newPos: { x: number; y: number }) => {
    setPositionLocal(newPos);
  }, []);

  // Shared animation loop: one Konva.Animation for all animated badges
  const layerRef = useRef<Konva.Layer>(null);
  const animRegistryRef = useRef(new Map<string, AnimUpdateFn>());

  const registerAnim = useCallback<AnimRegisterFn>((id, cb) => {
    animRegistryRef.current.set(id, cb);
    return () => { animRegistryRef.current.delete(id); };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const anim = new Konva.Animation((frame) => {
      if (!frame || animRegistryRef.current.size === 0) return;
      const t = frame.time / 1000;
      for (const cb of animRegistryRef.current.values()) {
        cb(t);
      }
    }, layer);

    anim.start();
    return () => { anim.stop(); };
  }, []);

  // Agent state - useShallow prevents infinite re-render from new array references
  const agents = useAgentStore(useShallow((s) => s.getAllAgents()));
  const spawnAgent = useAgentStore((s) => s.spawnAgent);
  const flashes = useAgentStore((s) => s.flashes);
  const clearFlash = useAgentStore((s) => s.clearFlash);

  // Auto-clear flashes after animation completes. Each flash gets one timeout;
  // the Set prevents duplicates when flashes reference changes for other reasons.
  const flashTimersRef = useRef(new Set<string>());
  useEffect(() => {
    for (const [agentId] of flashes) {
      if (!flashTimersRef.current.has(agentId)) {
        flashTimersRef.current.add(agentId);
        setTimeout(() => {
          clearFlash(agentId);
          flashTimersRef.current.delete(agentId);
        }, FLASH_DURATION_MS + 50);
      }
    }
  }, [flashes, clearFlash]);

  // Event logging
  const addSpawn = useEventLogStore((s) => s.addSpawn);

  // UI state - selected agent for terminal, hovered/selected hex
  const selectedAgentId = useUIStore((s) => s.selectedAgentId);
  const selectAgent = useUIStore((s) => s.selectAgent);
  const hoveredHex = useUIStore((s) => s.hoveredHex);
  const setHoveredHex = useUIStore((s) => s.setHoveredHex);
  const selectedHex = useUIStore((s) => s.selectedHex);
  const selectHex = useUIStore((s) => s.selectHex);

  // Calculate visible hex range based on viewport (for culling)
  const visibleHexes = useMemo(() => {
    // Transform viewport bounds to world coordinates
    const worldMinX = -position.x / scale;
    const worldMinY = -position.y / scale;
    const worldMaxX = (width - position.x) / scale;
    const worldMaxY = (height - position.y) / scale;

    return hexesInRect(worldMinX, worldMaxX, worldMinY, worldMaxY, hexSize);
  }, [position, scale, width, height, hexSize]);

  // Build lookup: hex coord -> agent (if occupied)
  const agentByHex = useMemo(() => {
    const map = new Map<string, AgentState>();
    for (const agent of agents) {
      map.set(`${agent.hex.q},${agent.hex.r}`, agent);
    }
    return map;
  }, [agents]);

  // Build set of agents that are part of a "family" (have parent-child connections)
  // Used to give connected agents a shared thick black border
  const familyMembers = useMemo(() => {
    const members = new Set<string>();
    for (const agent of agents) {
      // Agent has connections (it's a child with a parent)
      if (agent.connections.length > 0) {
        members.add(agent.id);
        // Also add all its connections (the parents)
        for (const connId of agent.connections) {
          members.add(connId);
        }
      }
    }
    return members;
  }, [agents]);

  // Build lookup: orchestrator agentId -> { done, total } child progress
  const orchestratorProgress = useMemo(() => {
    const progress = new Map<string, { done: number; total: number }>();
    for (const agent of agents) {
      if (agent.parentId) {
        const parent = progress.get(agent.parentId) ?? { done: 0, total: 0 };
        parent.total++;
        if (TERMINAL_STATUSES.has(agent.detailedStatus)) {
          parent.done++;
        }
        progress.set(agent.parentId, parent);
      }
    }
    return progress;
  }, [agents]);

  // Sort hexes by z-priority so strokes render on top of adjacent fills.
  // Higher priority = rendered later = visually on top.
  // empty(0) < family(1) < hovered(2) < keyboard-selected(3) < panel-open(4)
  const sortedHexes = useMemo(() => {
    const priority = (hex: { q: number; r: number }): number => {
      const agent = agentByHex.get(`${hex.q},${hex.r}`);
      if (agent?.id === selectedAgentId) return 4;
      if (selectedHex?.q === hex.q && selectedHex?.r === hex.r) return 3;
      if (hoveredHex?.q === hex.q && hoveredHex?.r === hex.r) return 2;
      if (agent && familyMembers.has(agent.id)) return 1;
      return 0;
    };
    return [...visibleHexes].sort((a, b) => priority(a) - priority(b));
  }, [visibleHexes, agentByHex, selectedAgentId, selectedHex, hoveredHex, familyMembers]);

  /**
   * Handle wheel zoom - scales toward cursor position.
   */
  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = e.target.getStage();
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const oldScale = scale;

      // Calculate new scale with clamping
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const newScale =
        direction > 0
          ? Math.min(oldScale * STYLE.zoomFactor, STYLE.maxZoom)
          : Math.max(oldScale / STYLE.zoomFactor, STYLE.minZoom);

      // Don't update if clamped to same value
      if (newScale === oldScale) return;

      // Zoom toward pointer position
      const mousePointTo = {
        x: (pointer.x - position.x) / oldScale,
        y: (pointer.y - position.y) / oldScale,
      };

      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };

      setScale(newScale);
      setPosition(newPos);
    },
    [scale, position, setScale, setPosition]
  );

  /**
   * Handle drag end - update position state.
   */
  const handleDragEnd = useCallback((e: KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    setPosition({ x: stage.x(), y: stage.y() });
  }, [setPosition]);

  return (
    <Stage
        width={width}
        height={height}
        draggable
        scaleX={scale}
        scaleY={scale}
        x={position.x}
        y={position.y}
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
        onClick={(e) => {
          // Click on background (Stage itself) = clear selection
          if (e.target === e.target.getStage()) {
            selectHex(null);
            setHoveredHex(null);
          }
        }}
        onContextMenu={(e) => e.evt.preventDefault()}
        style={{ background: STYLE.background }}
      >
      <Layer ref={layerRef}>
        {/* Render hex grid - active hexes last so strokes render on top */}
        {sortedHexes.map((hex) => {
          const { x, y } = hexToPixel(hex, hexSize);
          const agent = agentByHex.get(`${hex.q},${hex.r}`);
          const isPanelOpen = agent && agent.id === selectedAgentId;
          const isSelected =
            selectedHex && selectedHex.q === hex.q && selectedHex.r === hex.r;
          const isHovered =
            hoveredHex && hoveredHex.q === hex.q && hoveredHex.r === hex.r;
          const isInFamily = agent && familyMembers.has(agent.id);

          // Fill: cell type color > selected/hover highlight > default
          const fill = agent
            ? CELL_COLORS[agent.cellType]
            : isSelected
              ? STYLE.hexFillHover
              : isHovered
                ? STYLE.hexFillHover
                : STYLE.hexFill;

          // Stroke: neon accent for panel-open/selected, darkened fill for family/hover, gray default
          const stroke = isPanelOpen
            ? STYLE.accentNeon
            : isSelected
              ? STYLE.accentNeon
              : isInFamily
                ? darkenColor(fill, 0.3)
                : isHovered
                  ? darkenColor(fill, 0.3)
                  : STYLE.hexStroke;

          // Stroke width: thin neon, medium family, subtle hover
          const strokeWidth = isPanelOpen
            ? 2
            : isSelected
              ? 2
              : isInFamily
                ? 3
                : isHovered
                  ? 1.5
                  : STYLE.gridStrokeWidth;

          // Dash: dashed border for keyboard-selected (not panel-open, which is solid)
          const dash = isSelected && !isPanelOpen ? [8, 4] : undefined;

          // Shadow: subtle glow for panel-open only
          const shadowEnabled = !!isPanelOpen;
          const opacity = agent ? STATUS_OPACITY[agent.status] : 1;

          /** Determine cell type from modifier keys */
          const getCellType = (shiftKey: boolean): CellType =>
            shiftKey ? 'orchestrator' : 'terminal';

          return (
            <RegularPolygon
              key={`${hex.q},${hex.r}`}
              x={x}
              y={y}
              sides={6}
              radius={hexSize}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              dash={dash}
              opacity={opacity}
              shadowColor={shadowEnabled ? STYLE.accentNeon : undefined}
              shadowBlur={shadowEnabled ? 8 : 0}
              shadowOpacity={shadowEnabled ? 0.5 : 0}
              shadowOffsetX={0}
              shadowOffsetY={0}
              shadowEnabled={shadowEnabled}
              listening={true}
              onClick={(e) => {
                // Only respond to left-click (button 0)
                if (e.evt.button !== 0) return;
                if (agent) {
                  // Occupied cell: open terminal panel directly
                  selectAgent(agent.id);
                } else {
                  // Empty cell: select to show spawn menu
                  selectHex(hex);
                }
              }}
              onTap={() => {
                if (agent) {
                  selectAgent(agent.id);
                } else {
                  selectHex(hex);
                }
              }}
              onDblClick={(e) => {
                // Only respond to left-click (button 0)
                if (e.evt.button !== 0) return;
                if (agent) {
                  // Double-click occupied = open panel
                  selectAgent(agent.id);
                } else {
                  // Double-click empty = spawn + auto-open terminal
                  const cellType = getCellType(e.evt.shiftKey);
                  const newAgentId = spawnAgent(hex, cellType);
                  addSpawn(newAgentId, cellType, hex);
                  selectAgent(newAgentId);
                }
              }}
              onDblTap={() => {
                if (agent) {
                  selectAgent(agent.id);
                } else {
                  const newAgentId = spawnAgent(hex, 'terminal');
                  addSpawn(newAgentId, 'terminal', hex);
                  selectAgent(newAgentId);
                }
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault();
                e.evt.stopPropagation();
              }}
              onMouseEnter={() => setHoveredHex(hex)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}



        {/* Render flash overlays for status transitions */}
        {Array.from(flashes.entries()).map(([agentId, flashType]: [string, FlashType]) => {
          const agent = agentByHex.size > 0 ? agents.find(a => a.id === agentId) : undefined;
          if (!agent) return null;
          const { x, y } = hexToPixel(agent.hex, hexSize);
          return (
            <FlashOverlay
              key={`flash-${agentId}`}
              x={x}
              y={y}
              hexSize={hexSize}
              flashType={flashType}
            />
          );
        })}

        {/* Render status badges at center of agent hex cells */}
        {agents.map((agent) => {
          const { x, y } = hexToPixel(agent.hex, hexSize);

          return (
            <StatusBadge
              key={`badge-${agent.id}`}
              status={agent.detailedStatus}
              x={x}
              y={y}
              registerAnim={registerAnim}
              animId={agent.id}
            />
          );
        })}

        {/* Render satellite indicators on agent hex cells */}
        {agents.map((agent) => {
          // Skip plain terminals - satellites only for Claude agents
          if (agent.cellType === 'terminal') return null;

          const { x, y } = hexToPixel(agent.hex, hexSize);
          const satOpacity = satelliteOpacity(scale);
          if (satOpacity <= 0) return null;

          const progress = orchestratorProgress.get(agent.id);
          const hasProgress = progress && progress.total > 0;

          // Elapsed time: frozen for terminal states, live for active agents
          let elapsedText: string | null = null;
          if (agent.createdAt) {
            if (TERMINAL_STATUSES.has(agent.detailedStatus) && agent.lastActivityAt) {
              // Done/error/cancelled: freeze at total lifetime
              elapsedText = formatElapsed(agent.createdAt, agent.lastActivityAt);
            } else {
              const idleText = agent.lastActivityAt ? formatIdle(agent.lastActivityAt, now) : null;
              elapsedText = idleText ?? formatElapsed(agent.createdAt, now);
            }
          }

          const hasGit = (agent.gitCommitCount ?? 0) > 0;

          return (
            <Group key={`sat-${agent.id}`} listening={false}>
              {/* T: Elapsed time (top, above badge) */}
              {elapsedText && (
                <Text
                  x={x}
                  y={y - 18}
                  text={elapsedText}
                  fontSize={9}
                  fontFamily="monospace"
                  fill={palette.overlay1}
                  align="center"
                  width={40}
                  offsetX={20}
                  offsetY={4.5}
                  opacity={satOpacity}
                  listening={false}
                />
              )}

              {/* P: Worker progress (bottom, below badge) */}
              {hasProgress && (
                <Text
                  x={x}
                  y={y + 18}
                  text={`${progress.done}/${progress.total}`}
                  fontSize={9}
                  fontFamily="monospace"
                  fill={palette.subtext0}
                  align="center"
                  width={40}
                  offsetX={20}
                  offsetY={4.5}
                  opacity={satOpacity}
                  listening={false}
                />
              )}

              {/* G: Git commit count (bottom-right) */}
              {hasGit && (
                <Group x={x + 20} y={y + 25} opacity={satOpacity} listening={false}>
                  <Circle radius={8} fill={palette.green} />
                  <Text
                    text={String(agent.gitCommitCount)}
                    fontSize={8}
                    fontFamily="monospace"
                    fill={palette.crust}
                    align="center"
                    verticalAlign="middle"
                    width={16}
                    height={16}
                    offsetX={8}
                    offsetY={8}
                  />
                </Group>
              )}
            </Group>
          );
        })}

        {/* Origin marker - hidden when agent occupies origin cell */}
        {!agentByHex.has('0,0') && (
          <>
            <Line
              points={[-10, 0, 10, 0]}
              stroke={STYLE.originMarkerStroke}
              strokeWidth={1}
              listening={false}
            />
            <Line
              points={[0, -10, 0, 10]}
              stroke={STYLE.originMarkerStroke}
              strokeWidth={1}
              listening={false}
            />
          </>
        )}
      </Layer>
    </Stage>
  );
}

export default HexGrid;
