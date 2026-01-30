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
import { Stage, Layer, Line, RegularPolygon, Circle, Group } from 'react-konva';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { hexToPixel, hexesInRect } from '@shared/types';
import type { AgentStatus, CellType, DetailedStatus } from '@shared/types';
import { useAgentStore, type AgentState } from '@features/agents/agentStore';
import { useUIStore } from '@features/controls/uiStore';
import { useEventLogStore } from '@features/events/eventLogStore';
import { useViewportStore } from './viewportStore';
import { useShallow } from 'zustand/shallow';
import type { AgentRole } from '@protocol/types';
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
  originMarkerStroke: hexGrid.originMarker,
  gridStrokeWidth: 1,
  hexSize: 40,
  minZoom: 0.3,
  maxZoom: 3.0,
  zoomFactor: 1.08,
} as const;

const ROLE_COLORS: Record<AgentRole, string> = {
  orchestrator: agentColors.orchestrator,
  worker: agentColors.worker,
};

const STATUS_OPACITY: Record<AgentStatus, number> = {
  idle: 1.0,
  working: 1.0,
  blocked: 0.5,
  offline: 0.3,
};

// Status visual categories - map DetailedStatus to display bucket
type StatusBucket = 'busy' | 'needs_attention' | 'done' | 'failed' | 'idle';

const STATUS_BUCKETS: Record<DetailedStatus, StatusBucket> = {
  pending: 'idle',
  working: 'busy',
  idle: 'idle',
  waiting_input: 'needs_attention',
  waiting_permission: 'needs_attention',
  stuck: 'needs_attention',
  done: 'done',
  error: 'failed',
  cancelled: 'failed',
};

// ============================================================================
// Status Badge Components (Native Konva with animations)
// ============================================================================

interface KonvaStatusBadgeProps {
  status: DetailedStatus;
  x: number;
  y: number;
}

/** 3-dot bouncing loader for busy states */
function BusyBadge({ x, y }: { x: number; y: number }) {
  const groupRef = useRef<Konva.Group>(null);
  const dot1Ref = useRef<Konva.Circle>(null);
  const dot2Ref = useRef<Konva.Circle>(null);
  const dot3Ref = useRef<Konva.Circle>(null);

  useEffect(() => {
    const group = groupRef.current;
    const layer = group?.getLayer();
    if (!layer || !dot1Ref.current || !dot2Ref.current || !dot3Ref.current) return;

    const anim = new Konva.Animation((frame) => {
      if (!frame || !dot1Ref.current || !dot2Ref.current || !dot3Ref.current) return;

      const t = frame.time / 1000; // seconds
      const bounce = (offset: number) => Math.sin((t + offset) * Math.PI * 2) * 2;

      dot1Ref.current.y(bounce(0));
      dot2Ref.current.y(bounce(0.15));
      dot3Ref.current.y(bounce(0.3));
    }, layer);

    anim.start();
    return () => { anim.stop(); };
  }, []);

  const dotRadius = 2;
  const spacing = 5;
  const dotColor = palette.crust;  // Dark dots for contrast on any background

  return (
    <Group ref={groupRef} x={x} y={y} listening={false}>
      <Circle ref={dot1Ref} x={-spacing} y={0} radius={dotRadius} fill={dotColor} />
      <Circle ref={dot2Ref} x={0} y={0} radius={dotRadius} fill={dotColor} />
      <Circle ref={dot3Ref} x={spacing} y={0} radius={dotRadius} fill={dotColor} />
    </Group>
  );
}

/** Flashing indicator for attention-needed states */
function AttentionBadge({ x, y }: { x: number; y: number }) {
  const circleRef = useRef<Konva.Circle>(null);

  useEffect(() => {
    const circle = circleRef.current;
    const layer = circle?.getLayer();
    if (!layer || !circle) return;

    const anim = new Konva.Animation((frame) => {
      if (!frame || !circleRef.current) return;

      const t = frame.time / 1000;
      // Flash: oscillate opacity between 0.5 and 1.0
      const opacity = 0.75 + Math.sin(t * Math.PI * 2) * 0.25;
      circleRef.current.opacity(opacity);
    }, layer);

    anim.start();
    return () => { anim.stop(); };
  }, []);

  return (
    <Circle
      x={x}
      y={y}
      ref={circleRef}
      radius={4}
      fill={palette.crust}
      listening={false}
    />
  );
}

/** Static circle for idle states (hollow ring) */
function IdleBadge({ x, y }: { x: number; y: number }) {
  return (
    <Circle
      x={x}
      y={y}
      radius={3}
      stroke={palette.crust}
      strokeWidth={1.5}
      listening={false}
    />
  );
}

/** Solid circle for terminal states (done, failed) */
function TerminalBadge({ x, y }: { x: number; y: number }) {
  return (
    <Circle
      x={x}
      y={y}
      radius={4}
      fill={palette.crust}
      listening={false}
    />
  );
}

function KonvaStatusBadge({ status, x, y }: KonvaStatusBadgeProps) {
  const bucket = STATUS_BUCKETS[status];

  switch (bucket) {
    case 'busy':
      return <BusyBadge x={x} y={y} />;
    case 'needs_attention':
      return <AttentionBadge x={x} y={y} />;
    case 'idle':
      return <IdleBadge x={x} y={y} />;
    case 'done':
    case 'failed':
    default:
      return <TerminalBadge x={x} y={y} />;
  }
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Agent state - useShallow prevents infinite re-render from new array references
  const agents = useAgentStore(useShallow((s) => s.getAllAgents()));
  const spawnAgent = useAgentStore((s) => s.spawnAgent);

  // Event logging
  const addSpawn = useEventLogStore((s) => s.addSpawn);

  // UI state - selected agent for terminal, selected hex for focus (mouse or keyboard)
  const selectedAgentId = useUIStore((s) => s.selectedAgentId);
  const selectAgent = useUIStore((s) => s.selectAgent);
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

  // Sort hexes so active ones render last (strokes on top of adjacent hexes)
  const sortedHexes = useMemo(() => {
    return [...visibleHexes].sort((a, b) => {
      const aAgent = agentByHex.get(`${a.q},${a.r}`);
      const bAgent = agentByHex.get(`${b.q},${b.r}`);
      const aActive = (aAgent && (aAgent.id === selectedAgentId || familyMembers.has(aAgent.id)))
        || (selectedHex && selectedHex.q === a.q && selectedHex.r === a.r);
      const bActive = (bAgent && (bAgent.id === selectedAgentId || familyMembers.has(bAgent.id)))
        || (selectedHex && selectedHex.q === b.q && selectedHex.r === b.r);
      return (aActive ? 1 : 0) - (bActive ? 1 : 0);
    });
  }, [visibleHexes, agentByHex, selectedAgentId, selectedHex, familyMembers]);

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
          }
        }}
        onContextMenu={(e) => e.evt.preventDefault()}
        style={{ background: STYLE.background }}
      >
      <Layer>
        {/* Render hex grid - active hexes last so strokes render on top */}
        {sortedHexes.map((hex) => {
          const { x, y } = hexToPixel(hex, hexSize);
          const agent = agentByHex.get(`${hex.q},${hex.r}`);
          const isPanelOpen = agent && agent.id === selectedAgentId;
          const isSelected =
            selectedHex && selectedHex.q === hex.q && selectedHex.r === hex.r;
          const isInFamily = agent && familyMembers.has(agent.id);
          const isActive = isPanelOpen || isInFamily || isSelected;

          // Fill: agent role color > selected highlight > default
          const fill = agent
            ? ROLE_COLORS[agent.role]
            : isSelected
              ? STYLE.hexFillHover
              : STYLE.hexFill;

          // Stroke: darkened fill for active states, default gray otherwise
          const stroke = isActive
            ? darkenColor(fill, 0.3)
            : STYLE.hexStroke;

          // Stroke width: panel-open = thick, family = thick, selected = medium, default = thin
          const strokeWidth = isPanelOpen
            ? 4
            : isInFamily
              ? 4
              : isSelected
                ? 2
                : STYLE.gridStrokeWidth;
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
              opacity={opacity}
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
                  // Double-click empty = spawn + select (don't open panel)
                  const cellType = getCellType(e.evt.shiftKey);
                  const newAgentId = spawnAgent(hex, cellType);
                  addSpawn(newAgentId, cellType, hex);
                  selectHex(hex);
                }
              }}
              onDblTap={() => {
                if (agent) {
                  selectAgent(agent.id);
                } else {
                  const newAgentId = spawnAgent(hex, 'terminal');
                  addSpawn(newAgentId, 'terminal', hex);
                  selectHex(hex);
                }
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault();
                e.evt.stopPropagation();
              }}
              onMouseEnter={() => selectHex(hex)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}



        {/* Render status badges for agents (native Konva) */}
        {agents.map((agent) => {
          const { x, y } = hexToPixel(agent.hex, hexSize);
          // Position badge at top-right of hex
          const badgeX = x + hexSize * 0.5;
          const badgeY = y - hexSize * 0.5;

          return (
            <KonvaStatusBadge
              key={`badge-${agent.id}`}
              status={agent.detailedStatus}
              x={badgeX}
              y={badgeY}
            />
          );
        })}

        {/* Origin marker */}
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
      </Layer>
    </Stage>
  );
}

export default HexGrid;
