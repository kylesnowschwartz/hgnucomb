/**
 * PWA state management.
 *
 * Tracks standalone display mode and the install prompt event.
 * The install prompt (beforeinstallprompt) is Chrome-only -- Safari and Firefox
 * don't fire it, so the install button simply won't appear on those browsers.
 */

import { create } from 'zustand';
import { useEffect } from 'react';

/**
 * Chrome's BeforeInstallPromptEvent. Not in lib.dom.d.ts because it's
 * non-standard, but we need the prompt() method to trigger installation.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

interface PwaState {
  /** True when running as installed PWA (standalone window, no browser chrome) */
  isStandalone: boolean;
  /** Captured install prompt -- null if not available or already installed */
  installPrompt: BeforeInstallPromptEvent | null;

  setStandalone: (value: boolean) => void;
  setInstallPrompt: (event: BeforeInstallPromptEvent | null) => void;

  /** Trigger the browser install dialog. Clears the prompt after use. */
  promptInstall: () => Promise<void>;
}

export const usePwaStore = create<PwaState>((set, get) => ({
  isStandalone: window.matchMedia('(display-mode: standalone)').matches,
  installPrompt: null,

  setStandalone: (value) => set({ isStandalone: value }),
  setInstallPrompt: (event) => set({ installPrompt: event }),

  promptInstall: async () => {
    const { installPrompt } = get();
    if (!installPrompt) return;

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;

    if (outcome === 'accepted') {
      set({ installPrompt: null });
    }
  },
}));

/**
 * Lifecycle hook -- call once from App.tsx.
 *
 * Wires up:
 * 1. beforeinstallprompt capture (Chrome install prompt)
 * 2. display-mode media query listener (standalone detection)
 * 3. appinstalled cleanup (clear prompt after install)
 */
export function usePwaLifecycle(): void {
  useEffect(() => {
    const { setInstallPrompt, setStandalone } = usePwaStore.getState();

    // Capture install prompt before browser shows it
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    // Clear prompt after successful install
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setStandalone(true);
    };

    // Track display mode changes (e.g., user installs while page is open)
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setStandalone(e.matches);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener('change', handleDisplayModeChange);
    };
  }, []);
}
