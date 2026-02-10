import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for modifier state tracking, especially the self-healing behavior
 * that prevents Meta from getting stuck when keyup events are lost.
 *
 * We can't use the real module directly because it binds to window with
 * addEventListener. Instead we test the core logic: given a sequence of
 * keydown/keyup events, does isMetaDown() return the right value?
 *
 * Strategy: stub window with a minimal event target, import the module fresh
 * for each test via dynamic import + vi.resetModules().
 */

// Minimal event target that stores listeners and dispatches to them
function createMockWindow() {
  const listeners = new Map<string, Set<EventListener>>();

  return {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event: { type: string }) {
      for (const fn of listeners.get(event.type) ?? []) {
        fn(event as Event);
      }
      return true;
    },
  };
}

function createMockDocument() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    hidden: false,
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
  };
}

describe('modifierState', () => {
  let mockWindow: ReturnType<typeof createMockWindow>;
  let mockDocument: ReturnType<typeof createMockDocument>;

  beforeEach(() => {
    vi.resetModules();
    mockWindow = createMockWindow();
    mockDocument = createMockDocument();
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('document', mockDocument);
  });

  function fireKeyDown(key: string, metaKey = false) {
    mockWindow.dispatchEvent({ type: 'keydown', key, metaKey } as unknown as Event);
  }

  function fireKeyUp(key: string) {
    mockWindow.dispatchEvent({ type: 'keyup', key, metaKey: false } as unknown as Event);
  }

  async function loadModule() {
    const mod = await import('./modifierState');
    mod.initModifierTracking();
    return mod;
  }

  it('tracks Meta keydown/keyup', async () => {
    const { isMetaDown } = await loadModule();

    expect(isMetaDown()).toBe(false);
    fireKeyDown('Meta');
    expect(isMetaDown()).toBe(true);
    fireKeyUp('Meta');
    expect(isMetaDown()).toBe(false);
  });

  it('resets on window blur', async () => {
    const { isMetaDown } = await loadModule();

    fireKeyDown('Meta');
    expect(isMetaDown()).toBe(true);

    mockWindow.dispatchEvent({ type: 'blur' } as unknown as Event);
    expect(isMetaDown()).toBe(false);
  });

  it('self-heals when Meta keyup was missed', async () => {
    const { isMetaDown } = await loadModule();

    // Meta gets stuck (keydown fired but keyup was lost)
    fireKeyDown('Meta');
    expect(isMetaDown()).toBe(true);

    // User presses a regular key WITHOUT Meta held (browser says metaKey=false).
    // Our tracking should self-correct.
    fireKeyDown('h', false);
    expect(isMetaDown()).toBe(false);
  });

  it('does not self-heal when Meta is actually held (browser confirms)', async () => {
    const { isMetaDown } = await loadModule();

    fireKeyDown('Meta');
    expect(isMetaDown()).toBe(true);

    // User presses h while Meta is held (browser says metaKey=true).
    // Our tracking should stay true -- Meta is really held.
    fireKeyDown('h', true);
    expect(isMetaDown()).toBe(true);
  });

  it('does not false-clear from Cmd+Tab browser stickiness', async () => {
    const { isMetaDown } = await loadModule();

    // Simulate Cmd+Tab: Meta keydown, browser's metaKey stays stuck true.
    // A subsequent keydown with metaKey=true should NOT clear our state.
    fireKeyDown('Meta');
    fireKeyDown('a', true);
    expect(isMetaDown()).toBe(true);

    // Only explicit keyup or blur should clear
    fireKeyUp('Meta');
    expect(isMetaDown()).toBe(false);
  });
});
