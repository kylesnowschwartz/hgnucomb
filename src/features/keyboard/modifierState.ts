/**
 * Explicit modifier key state tracking.
 *
 * macOS Chromium has a known bug where KeyboardEvent.metaKey reports true
 * after Cmd+Tab because the keyup fires in the other app's window. The
 * browser's internal modifier state gets out of sync and stays stuck.
 *
 * This module tracks Meta state via keydown/keyup and resets on
 * blur/visibilitychange, providing a reliable alternative to e.metaKey.
 *
 * @see https://github.com/nicknisi/xterm.js/issues/3025
 * @see https://github.com/novnc/noVNC/issues/1695
 * @see https://bugs.chromium.org/p/chromium/issues/detail?id=100251
 */

let metaDown = false;
let initialized = false;

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Meta') metaDown = true;
}

function handleKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Meta') metaDown = false;
}

function resetModifiers(): void {
  metaDown = false;
}

function handleVisibilityChange(): void {
  if (document.hidden) resetModifiers();
}

/**
 * Start tracking modifier keys. Idempotent -- safe to call multiple times.
 * Returns a cleanup function for teardown.
 */
export function initModifierTracking(): () => void {
  if (initialized) return () => {};
  initialized = true;

  // Use capture phase so we see events before any stopPropagation calls
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('blur', resetModifiers);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    initialized = false;
    metaDown = false;
    window.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('keyup', handleKeyUp, true);
    window.removeEventListener('blur', resetModifiers);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

/**
 * Whether Meta (Cmd) is currently pressed according to our explicit tracking.
 *
 * Use this instead of KeyboardEvent.metaKey for decisions that gate keyboard
 * routing (terminal vs keymap, preventDefault, refocus). The browser's
 * e.metaKey is unreliable after Cmd+Tab on macOS.
 *
 * Known tradeoff: if a user holds Cmd through an app switch (rare), the
 * blur reset clears our state. It self-corrects on the next Cmd keydown.
 */
export function isMetaDown(): boolean {
  return metaDown;
}
