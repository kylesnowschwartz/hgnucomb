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
import { Stage, Layer, Line, RegularPolygon, Circle } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { hexToPixel, hexesInRect } from '@shared/types';
import { useAgentStore, type AgentState } from '@state/agentStore';
import { useUIStore } from '@state/uiStore';
import { useTerminalStore } from '@state/terminalStore';
import { useEventLogStore } from '@state/eventLogStore';
import { useShallow } from 'zustand/shallow';
import type { AgentRole, AgentStatus, CellType } from '@protocol/types';
import type { DetailedStatus } from '@terminal/types';
import { hexGrid, agentColors, palette } from '@theme/catppuccin-mocha';

// ============================================================================
// Style Constants
// ============================================================================

const STYLE = {
  background: hexGrid.background,
  hexFill: hexGrid.hexFill,
  hexFillHover: hexGrid.hexFillHover,
  hexStroke: hexGrid.hexStroke,
  hexStrokeSelected: hexGrid.hexStrokeSelected,
  hexStrokeHover: hexGrid.hexStrokeHover,
  hexStrokeOrchestrator: hexGrid.hexStrokeOrchestrator,
  hexStrokeWorker: hexGrid.hexStrokeWorker,
  connectionStroke: agentColors.connection,
  originMarkerStroke: hexGrid.originMarker,
  gridStrokeWidth: 1,
  connectionStrokeWidth: 2,
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

// Status badge colors - 7-state model
const DETAILED_STATUS_COLORS: Record<DetailedStatus, string> = {
  idle: palette.overlay0,           // Gray
  working: palette.blue,            // Blue
  waiting_input: palette.yellow,    // Yellow
  waiting_permission: palette.peach,// Peach (distinct from yellow)
  done: palette.green,              // Green
  stuck: palette.maroon,            // Maroon
  error: palette.red,               // Red
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
  const spawnAgent = useAgentStore((s) => s.spawnAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);

  // Terminal cleanup
  const removeSessionForAgent = useTerminalStore((s) => s.removeSessionForAgent);

  // Event logging
  const addSpawn = useEventLogStore((s) => s.addSpawn);
  const addKill = useEventLogStore((s) => s.addKill);

  // UI state - selected agent for terminal, hovered hex for visual feedback
  const selectedAgentId = useUIStore((s) => s.selectedAgentId);
  const selectAgent = useUIStore((s) => s.selectAgent);
  const hoveredHex = useUIStore((s) => s.hoveredHex);
  const setHoveredHex = useUIStore((s) => s.setHoveredHex);

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
      onContextMenu={(e) => e.evt.preventDefault()}
      style={{ background: STYLE.background }}
    >
      <Layer>
        {/* Render hex grid with agent fills */}
        {visibleHexes.map((hex) => {
          const { x, y } = hexToPixel(hex, hexSize);
          const agent = agentByHex.get(`${hex.q},${hex.r}`);
          const isSelected = agent && agent.id === selectedAgentId;
          const isHovered =
            hoveredHex && hoveredHex.q === hex.q && hoveredHex.r === hex.r;
          const isOrchestrator = agent?.cellType === 'orchestrator';
          const isWorker = agent?.cellType === 'worker';
          const isClaudeAgent = isOrchestrator || isWorker;

          // Fill: agent role color > hover highlight > default
          const fill = agent
            ? ROLE_COLORS[agent.role]
            : isHovered
              ? STYLE.hexFillHover
              : STYLE.hexFill;

          // Stroke: selected > orchestrator > worker > hovered > default
          const stroke = isSelected
            ? STYLE.hexStrokeSelected
            : isOrchestrator
              ? STYLE.hexStrokeOrchestrator
              : isWorker
                ? STYLE.hexStrokeWorker
                : isHovered
                  ? STYLE.hexStrokeHover
                  : STYLE.hexStroke;

          // Selected = thick, Claude agents = medium, default = thin
          const strokeWidth = isSelected ? 3 : isClaudeAgent ? 2 : STYLE.gridStrokeWidth;
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
                  selectAgent(agent.id);
                } else {
                  const cellType = getCellType(e.evt.shiftKey);
                  const newAgentId = spawnAgent(hex, cellType);
                  addSpawn(newAgentId, cellType, hex);
                }
              }}
              onTap={() => {
                if (agent) {
                  selectAgent(agent.id);
                } else {
                  // Touch events don't have shiftKey, default to terminal
                  const newAgentId = spawnAgent(hex, 'terminal');
                  addSpawn(newAgentId, 'terminal', hex);
                }
              }}
              onDblClick={(e) => {
                // Only respond to left-click (button 0)
                if (e.evt.button !== 0) return;
                if (agent) {
                  selectAgent(agent.id);
                } else {
                  // Spawn and immediately select to open terminal
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
                e.cancelBubble = true; // Prevent Konva event bubbling
                if (agent) {
                  // Deselect if this was selected
                  if (selectedAgentId === agent.id) {
                    selectAgent(null);
                  }
                  // Log kill event, clean up terminal session, remove agent
                  addKill(agent.id);
                  removeSessionForAgent(agent.id);
                  removeAgent(agent.id);
                }
              }}
              onMouseEnter={() => setHoveredHex(hex)}
              onMouseLeave={() => setHoveredHex(null)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}

        {/* Render status badges for agents */}
        {agents.map((agent) => {
          const { x, y } = hexToPixel(agent.hex, hexSize);
          const badgeColor = DETAILED_STATUS_COLORS[agent.detailedStatus];
          const badgeRadius = 6;
          // Position badge at top-right of hex
          const badgeX = x + hexSize * 0.5;
          const badgeY = y - hexSize * 0.5;

          return (
            <Circle
              key={`badge-${agent.id}`}
              x={badgeX}
              y={badgeY}
              radius={badgeRadius}
              fill={badgeColor}
              stroke={palette.crust}
              strokeWidth={1}
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

              // Hierarchy = either agent is orchestrator; Peer = both non-orchestrators
              const isHierarchy =
                agent.role === 'orchestrator' || target.role === 'orchestrator';

              return (
                <Line
                  key={`conn-${agent.id}-${connectionId}`}
                  points={[from.x, from.y, to.x, to.y]}
                  stroke={STYLE.connectionStroke}
                  strokeWidth={STYLE.connectionStrokeWidth}
                  dash={isHierarchy ? undefined : [6, 4]} // Dotted for peer connections
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
