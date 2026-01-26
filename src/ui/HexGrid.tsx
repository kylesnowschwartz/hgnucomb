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

import { useState, useCallback } from 'react';
import { Stage, Layer, RegularPolygon, Line } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { hexToPixel, hexesInRange } from '@shared/types';
import { useAgentStore } from '@state/agentStore';
import { useShallow } from 'zustand/shallow';
import { AgentNode } from './AgentNode';

// ============================================================================
// Style Constants
// ============================================================================

const STYLE = {
  background: '#fafafa',
  gridStroke: '#e0e0e0',
  gridStrokeWidth: 1,
  hexSize: 40,
  minZoom: 0.3,
  maxZoom: 3.0,
  zoomFactor: 1.08,
} as const;

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
  /** Range of hexes to render from origin (default: 5) */
  hexRange?: number;
}

// ============================================================================
// Component
// ============================================================================

export function HexGrid({
  width,
  height,
  hexSize = STYLE.hexSize,
  hexRange = 5,
}: HexGridProps) {
  // Viewport state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: width / 2, y: height / 2 });

  // Agent state - useShallow prevents infinite re-render from new array references
  const agents = useAgentStore(useShallow((s) => s.getAllAgents()));

  // Generate hex cells
  const hexes = hexesInRange(hexRange);

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
        {/* Render hex grid */}
        {hexes.map((hex) => {
          const { x, y } = hexToPixel(hex, hexSize);
          return (
            <RegularPolygon
              key={`${hex.q},${hex.r}`}
              x={x}
              y={y}
              sides={6}
              radius={hexSize}
              rotation={30} // Pointy-top orientation
              stroke={STYLE.gridStroke}
              strokeWidth={STYLE.gridStrokeWidth}
              listening={false}
            />
          );
        })}

        {/* Render agents */}
        {agents.map((agent) => (
          <AgentNode key={agent.id} agent={agent} hexSize={hexSize} />
        ))}

        {/* Origin marker */}
        <Line
          points={[-10, 0, 10, 0]}
          stroke="#ccc"
          strokeWidth={1}
          listening={false}
        />
        <Line
          points={[0, -10, 0, 10]}
          stroke="#ccc"
          strokeWidth={1}
          listening={false}
        />
      </Layer>
    </Stage>
  );
}

export default HexGrid;
