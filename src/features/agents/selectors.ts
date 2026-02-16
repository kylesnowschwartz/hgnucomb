/**
 * Projected Zustand selectors for agentStore.
 *
 * Components subscribe to more AgentState fields than they render, causing
 * unnecessary re-renders when unrelated fields change (e.g., activity broadcasts
 * trigger HexGrid memo recalculation even though HexGrid doesn't render telemetry).
 *
 * These selectors project AgentState to narrow types and provide structural
 * equality functions so components only re-render when their fields change.
 *
 * Uses `useStoreWithEqualityFn` from `zustand/traditional` because Zustand v5
 * removed the equalityFn overload from the default `create()` hook.
 *
 * @see agentStore.test.ts "selector stability" for the red-green oracle.
 */

import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useAgentStore, type AgentState } from './agentStore';
import type {
  HexCoordinate,
  AgentStatus,
  CellType,
  DetailedStatus,
} from '@shared/types';

// ============================================================================
// HexGrid layout projection
// ============================================================================

/**
 * Minimal agent data for HexGrid layout computation.
 *
 * Drives the expensive memos (agentByHex, familyData, orchestratorProgress,
 * sortedHexes). Excludes activity fields (createdAt, lastActivityAt,
 * gitCommitCount, telemetry) so 3-second activity broadcasts don't
 * invalidate layout memos.
 *
 * Satellite indicators read activity data imperatively via getAgent(),
 * refreshed by HexGrid's 1-second `now` timer.
 */
export interface AgentGridData {
  id: string;
  hex: HexCoordinate;
  cellType: CellType;
  status: AgentStatus;
  detailedStatus: DetailedStatus;
  connections: string[];
  parentId?: string;
  parentHex?: HexCoordinate;
}

/** Project a full AgentState to layout-only fields. */
export function projectToGridData(agent: AgentState): AgentGridData {
  return {
    id: agent.id,
    hex: agent.hex,
    cellType: agent.cellType,
    status: agent.status,
    detailedStatus: agent.detailedStatus,
    connections: agent.connections,
    parentId: agent.parentId,
    parentHex: agent.parentHex,
  };
}

/**
 * Zustand selector: projects all agents to HexGrid layout data.
 */
export function selectGridData(s: { getAllAgents: () => AgentState[] }): AgentGridData[] {
  return s.getAllAgents().map(projectToGridData);
}

/**
 * Structural equality for AgentGridData arrays.
 *
 * Compares only layout-relevant fields. Activity-only changes (timestamps,
 * git counts, telemetry) produce equal results, preventing re-renders.
 */
export function gridDataEqual(a: AgentGridData[], b: AgentGridData[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i], bi = b[i];
    if (ai.id !== bi.id) return false;
    if (ai.hex.q !== bi.hex.q || ai.hex.r !== bi.hex.r) return false;
    if (ai.cellType !== bi.cellType) return false;
    if (ai.status !== bi.status) return false;
    if (ai.detailedStatus !== bi.detailedStatus) return false;
    if (ai.parentId !== bi.parentId) return false;
    if (ai.connections.length !== bi.connections.length) return false;
  }
  return true;
}

/**
 * Hook: subscribe to agent layout data with structural equality.
 * HexGrid uses this — only re-renders on layout changes, not activity broadcasts.
 */
export function useAgentGridData(): AgentGridData[] {
  return useStoreWithEqualityFn(useAgentStore, selectGridData, gridDataEqual);
}

// ============================================================================
// App.tsx session creation projection
// ============================================================================

/**
 * Minimal data for App.tsx auto-session creation.
 * Only re-renders when agents are added/removed or change cell type.
 */
export interface AgentSessionData {
  id: string;
  cellType: CellType;
}

/** Zustand selector: projects all agents to session creation data. */
export function selectSessionData(s: { getAllAgents: () => AgentState[] }): AgentSessionData[] {
  return s.getAllAgents().map(a => ({ id: a.id, cellType: a.cellType }));
}

/** Structural equality for session data arrays. */
export function sessionDataEqual(a: AgentSessionData[], b: AgentSessionData[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].cellType !== b[i].cellType) return false;
  }
  return true;
}

/**
 * Hook: subscribe to agent session data with structural equality.
 * App.tsx uses this — only re-renders when agents appear/disappear.
 */
export function useAgentSessionData(): AgentSessionData[] {
  return useStoreWithEqualityFn(useAgentStore, selectSessionData, sessionDataEqual);
}
