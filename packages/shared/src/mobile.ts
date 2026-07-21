/**
 * Pure mobile detection for keypad visibility.
 * Accepts a snapshot of browser-like signals so tests drive the real function.
 */
export type MobileSignals = {
  userAgent?: string;
  maxTouchPoints?: number;
  pointerCoarse?: boolean;
  /** CSS viewport width in CSS pixels */
  viewportWidth?: number;
};

const MOBILE_UA =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i;

/**
 * True when the client should show on-screen touch pad + catch chrome.
 * Keyboard remains available either way.
 */
export function shouldShowMobileKeypad(signals: MobileSignals): boolean {
  const ua = signals.userAgent ?? '';
  if (MOBILE_UA.test(ua)) return true;
  if ((signals.maxTouchPoints ?? 0) > 0 && (signals.viewportWidth ?? 9999) <= 900) {
    return true;
  }
  if (signals.pointerCoarse === true && (signals.viewportWidth ?? 9999) <= 1024) {
    return true;
  }
  return false;
}

/** Collect signals from a browser global when available. */
export function collectBrowserMobileSignals(
  nav: { userAgent?: string; maxTouchPoints?: number } = {},
  win: { matchMedia?: (q: string) => { matches: boolean }; innerWidth?: number } = {},
): MobileSignals {
  let pointerCoarse = false;
  try {
    pointerCoarse = Boolean(win.matchMedia?.('(pointer: coarse)')?.matches);
  } catch {
    pointerCoarse = false;
  }
  return {
    userAgent: nav.userAgent ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    pointerCoarse,
    viewportWidth: win.innerWidth ?? 1280,
  };
}
