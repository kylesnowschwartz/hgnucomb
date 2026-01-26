/**
 * AgentNode - Visual representation of an agent on the hex grid.
 *
 * Renders a colored circle with label at the agent's hex position.
 * Color indicates role, opacity indicates status.
 */

import { Group, Circle, Text } from 'react-konva';
import type { AgentState } from '@state/agentStore';
import type { AgentRole, AgentStatus } from '@protocol/types';
import { hexToPixel } from '@shared/types';

// ============================================================================
// Style Constants
// ============================================================================

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

const NODE_RADIUS = 24;
const LABEL_OFFSET = 32; // Below circle center
const LABEL_FONT_SIZE = 11;

// ============================================================================
// Component Props
// ============================================================================

export interface AgentNodeProps {
  /** Agent state to render */
  agent: AgentState;
  /** Hex size for coordinate conversion */
  hexSize: number;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Truncate agent ID for display.
 * Shows first part before hyphen, or first 8 chars if no hyphen.
 */
function truncateId(id: string): string {
  const hyphenIndex = id.indexOf('-');
  if (hyphenIndex > 0 && hyphenIndex <= 12) {
    return id.slice(0, hyphenIndex + 2); // e.g., "orchestrator-1" -> "orchestrator-1"
  }
  return id.length > 12 ? id.slice(0, 12) : id;
}

export function AgentNode({ agent, hexSize }: AgentNodeProps) {
  const { x, y } = hexToPixel(agent.hex, hexSize);
  const fill = ROLE_COLORS[agent.role];
  const opacity = STATUS_OPACITY[agent.status];
  const label = truncateId(agent.id);

  return (
    <Group x={x} y={y} opacity={opacity}>
      <Circle
        radius={NODE_RADIUS}
        fill={fill}
        stroke="#fff"
        strokeWidth={2}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.2}
        shadowOffsetY={2}
      />
      <Text
        text={label}
        fontSize={LABEL_FONT_SIZE}
        fill="#666"
        align="center"
        y={LABEL_OFFSET}
        offsetX={label.length * 3.2} // Approximate centering
      />
    </Group>
  );
}

export default AgentNode;
