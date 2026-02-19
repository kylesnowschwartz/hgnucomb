/**
 * Pure functions for project directory management.
 *
 * No side effects, no store imports. Safe for agent review and unit testing.
 */

/**
 * Update a most-recently-used list: move `newPath` to front,
 * deduplicate, and cap at `max` entries.
 */
export function updateRecents(current: string[], newPath: string, max: number): string[] {
  return [newPath, ...current.filter(p => p !== newPath)].slice(0, max);
}
