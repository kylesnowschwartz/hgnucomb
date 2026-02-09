/**
 * Shared focus guard for keyboard event handlers.
 *
 * Both useKeyboardNavigation and TerminalPanel's refocus effect need to
 * yield to text-entry elements. This single function is the source of
 * truth for "is the user typing into something?"
 */

/**
 * Returns true when the currently focused element accepts text input.
 * Covers standard form elements and contenteditable nodes.
 */
export function isFocusInTextEntry(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
