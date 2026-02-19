/**
 * Pure functions for event log processing.
 *
 * No side effects, no store imports. Safe for agent review and unit testing.
 */

/**
 * Truncate a JSON-serializable payload to a preview string.
 * Returns '[unserializable]' if JSON.stringify throws.
 */
export function truncatePayload(payload: unknown, maxLen = 80): string {
  try {
    const str = JSON.stringify(payload);
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  } catch {
    return '[unserializable]';
  }
}
