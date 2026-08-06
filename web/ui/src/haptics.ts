/**
 * Haptic feedback.
 *
 * Android/Chrome: Vibration API.
 *
 * iOS Safari: no Vibration API. Safari 17.4+ fires the Taptic Engine when an
 * `<input type="checkbox" switch>` is toggled by a *real* user tap. Apple
 * closed the programmatic `.click()` loophole in iOS 26.5, so the reliable
 * path is an invisible switch overlay covering interactive hosts — the finger
 * lands on the switch itself. Treat as best-effort; may break again in a
 * future iOS. No feature-detect — failures are silent.
 */

const KEY = "yacewo-haptics";
const OVERLAY_ATTR = "data-haptic-overlay";

/** Elements that should buzz on a direct tap (iOS overlay hosts). */
const HOST_SELECTOR =
  "[data-sq], [data-promo], button[data-action], button.theme-btn, .mode-toggle button, .remote-toggle button, .setup-toggle button";

function loadEnabled(): boolean {
  return localStorage.getItem(KEY) !== "off";
}

let enabled = loadEnabled();

export function isHapticsOn(): boolean {
  return enabled;
}

export function setHapticsOn(on: boolean) {
  enabled = on;
  localStorage.setItem(KEY, on ? "on" : "off");
  // Refresh overlay pointer-events if already armed.
  if (typeof document !== "undefined") {
    for (const sw of document.querySelectorAll<HTMLElement>(`[${OVERLAY_ATTR}]`)) {
      sw.style.pointerEvents = on && !prefersReducedMotion() ? "auto" : "none";
    }
  }
}

export function toggleHaptics(): boolean {
  setHapticsOn(!enabled);
  return enabled;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports as MacIntel with touch.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function hasVibrate(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

// --- iOS: switch overlays under the finger ---------------------------------

function attachOverlay(host: HTMLElement) {
  if (host.querySelector(`[${OVERLAY_ATTR}]`)) return;

  const pos = getComputedStyle(host).position;
  if (
    pos !== "absolute" &&
    pos !== "relative" &&
    pos !== "fixed" &&
    pos !== "sticky"
  ) {
    host.style.position = "relative";
  }

  const sw = document.createElement("input");
  sw.type = "checkbox";
  sw.setAttribute("switch", "");
  sw.setAttribute(OVERLAY_ATTR, "");
  sw.setAttribute("aria-hidden", "true");
  sw.tabIndex = -1;
  // Cover the host so the user's tap is a real switch interaction (required
  // on iOS 26.5+). Click still bubbles to board/button delegation via closest().
  sw.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;" +
    "margin:0;padding:0;border:0;z-index:5;" +
    "-webkit-appearance:switch;appearance:auto;" +
    "opacity:0;cursor:inherit;" +
    `pointer-events:${enabled && !prefersReducedMotion() ? "auto" : "none"};` +
    "-webkit-tap-highlight-color:transparent;touch-action:manipulation;";

  host.appendChild(sw);
}

/**
 * Arm interactive hosts under `root` with iOS switch overlays.
 * Call after render / board patch. No-op on non-iOS.
 */
export function armHapticTargets(root: ParentNode = document) {
  if (!enabled || !isIOS() || typeof document === "undefined") return;
  root.querySelectorAll<HTMLElement>(HOST_SELECTOR).forEach(attachOverlay);
}

// --- Public cue API (Android vibrate; iOS overlays handle direct taps) -----

export type HapticCue =
  | "select"
  | "move"
  | "capture"
  | "castle"
  | "check"
  | "checkmate"
  | "illegal"
  | "ui";

/**
 * Fire a haptic cue. On Android this drives the Vibration API. On iOS,
 * direct taps are already handled by overlays — this is a best-effort
 * programmatic tick for older iOS (≤26.4) only, and no-ops on 26.5+.
 */
export function triggerHaptic(cue: HapticCue) {
  if (!enabled || prefersReducedMotion()) return;

  if (isIOS()) {
    // Best-effort for pre-26.5: sync label click inside the user gesture.
    // Overlays already buzzed for the originating tap; skip to avoid doubles
    // when the cue is the same tap (select/ui/move). Extra cues like delayed
    // check still try once.
    if (cue === "select" || cue === "ui" || cue === "move" || cue === "castle") {
      return;
    }
    iosProgrammaticTap();
    if (cue === "capture" || cue === "check" || cue === "illegal") {
      window.setTimeout(iosProgrammaticTap, 60);
    } else if (cue === "checkmate") {
      window.setTimeout(iosProgrammaticTap, 90);
      window.setTimeout(iosProgrammaticTap, 200);
    }
    return;
  }

  if (!hasVibrate()) return;

  const patterns: Record<HapticCue, number | number[]> = {
    select: 12,
    ui: 12,
    move: 18,
    castle: 22,
    capture: 28,
    check: [18, 40, 18],
    checkmate: [30, 55, 30, 55, 45],
    illegal: [14, 30, 14],
  };
  navigator.vibrate(patterns[cue]);
}

/** Older iOS only — may silently no-op on 26.5+. */
function iosProgrammaticTap() {
  try {
    const host = document.body;
    if (!host) return;
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    host.appendChild(label);
    label.click();
    host.removeChild(label);
  } catch {
    /* non-critical */
  }
}
