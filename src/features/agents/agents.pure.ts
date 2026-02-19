/**
 * Pure functions for agent state transitions.
 *
 * No side effects, no store imports. Safe for agent review and unit testing.
 */

import type { DetailedStatus } from '@shared/types';

/** Transient flash state for status transition animations (done/error) */
export type FlashType = 'done' | 'error';

/**
 * Determine whether a status transition should trigger a flash animation.
 *
 * Returns 'done' or 'error' for transitions INTO those terminal states,
 * null if no flash is warranted (same state, or non-terminal transition).
 */
export function determineFlash(
  newStatus: DetailedStatus,
  previousStatus: DetailedStatus | undefined
): FlashType | null {
  if (newStatus === 'done' && previousStatus !== 'done') return 'done';
  if (newStatus === 'error' && previousStatus !== 'error') return 'error';
  return null;
}
