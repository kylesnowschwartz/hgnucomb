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

import { useState, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, RegularPolygon } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { hexToPixel, hexesInRect } from '@shared/types';
import { useAgentStore, type AgentState } from '@state/agentStore';
import { useShallow } from 'zustand/shallow';
import type { AgentRole, AgentStatus } from '@protocol/types';

// ============================================================================
// Style Constants
// ============================================================================

const STYLE = {
  background: '#f5f5f5', // Slightly darker background
  hexFill: '#ffffff', // White fill for empty hexes
  hexStroke: '#c0c0c0', // Darker stroke for contrast
  connectionStroke: '#9ca3af', // gray-400, connection lines between agents
  originMarkerStroke: '#cccccc', // Origin crosshair
  gridStrokeWidth: 1,
  connectionStrokeWidth: 2,
  hexSize: 40,
  minZoom: 0.3,
  maxZoom: 3.0,
  zoomFactor: 1.08,
} as const;

const ROLE_COLORS: Record<AgentRole, string> = {
  orchestrator: '#3b82f6', // blue
  worker: '#22c55e', // green
  specialist: '#a855f7', // purple
};

const STATUS_OPACITY: Record<AgentStatus, number> = {
  idle: 1.0,
  working: 1.0,
  blocked: 0.5,
  offline: 0.3,
};

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
  // Viewport state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: width / 2, y: height / 2 });

  // Agent state - useShallow prevents infinite re-render from new array references
  const agents = useAgentStore(useShallow((s) => s.getAllAgents()));

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
    [scale, position]
  );

  /**
   * Handle drag end - update position state.
   */
  const handleDragEnd = useCallback((e: KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    setPosition({ x: stage.x(), y: stage.y() });
  }, []);

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
      style={{ background: STYLE.background }}
    >
      <Layer>
        {/* Render hex grid with agent fills */}
        {visibleHexes.map((hex) => {
          const { x, y } = hexToPixel(hex, hexSize);
          const agent = agentByHex.get(`${hex.q},${hex.r}`);
          const fill = agent ? ROLE_COLORS[agent.role] : STYLE.hexFill;
          const opacity = agent ? STATUS_OPACITY[agent.status] : 1;
          return (
            <RegularPolygon
              key={`${hex.q},${hex.r}`}
              x={x}
              y={y}
              sides={6}
              radius={hexSize}
              fill={fill}
              stroke={STYLE.hexStroke}
              strokeWidth={STYLE.gridStrokeWidth}
              opacity={opacity}
              listening={false}
            />
          );
        })}

        {/* Render connection lines (on top of hexes) */}
        {agents.flatMap((agent) =>
          agent.connections
            .filter((id) => agents.some((a) => a.id === id)) // Only draw if target exists
            .filter((connectionId) => agent.id < connectionId) // Dedupe: only draw once per pair
            .map((connectionId) => {
              const target = agents.find((a) => a.id === connectionId);
              if (!target) return null;

              const from = hexToPixel(agent.hex, hexSize);
              const to = hexToPixel(target.hex, hexSize);

              return (
                <Line
                  key={`conn-${agent.id}-${connectionId}`}
                  points={[from.x, from.y, to.x, to.y]}
                  stroke={STYLE.connectionStroke}
                  strokeWidth={STYLE.connectionStrokeWidth}
                  listening={false}
                />
              );
            })
        )}

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
