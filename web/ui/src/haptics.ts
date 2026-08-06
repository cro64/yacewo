/**
 * Haptic feedback. Android/Chrome uses the real Vibration API. iOS Safari
 * has no public haptics API at all — this uses a known side-effect of the
 * <input type="checkbox" switch> element (Safari 17.4+): toggling it via a
 * real click on its <label> fires the system Taptic Engine. This is a
 * platform quirk, not a sanctioned API — Apple has already patched the
 * underlying behavior once (iOS 26.5), so treat iOS haptics as best-effort
 * and expect it may silently stop working on a future iOS version. There's
 * no way to feature-detect that in advance; it just fails silently, which
 * is fine here since haptics are a nice-to-have, not load-bearing.
 */

const KEY = "yacewo-haptics";

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
}

export function toggleHaptics(): boolean {
  setHapticsOn(!enabled);
  return enabled;
}

export function hapticLabel(on = isHapticsOn()): string {
  return on ? "Haptics" : "Still";
}

// --- Android / Chrome: real Vibration API ---------------------------------

function hasVibrate(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

// --- iOS: checkbox-switch trick --------------------------------------------
// One hidden switch, created once and reused. Must be toggled via a real
// click event on the <label> — WebKit ignores .click() called directly on
// the input from script, per the underlying behavior this trick relies on.

let iosLabel: HTMLLabelElement | null = null;

function ensureIosSwitch(): HTMLLabelElement | null {
  if (typeof document === "undefined") return null;
  if (iosLabel) return iosLabel;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.style.position = "fixed";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";

  const label = document.createElement("label");
  label.style.position = "fixed";
  label.style.width = "1px";
  label.style.height = "1px";
  label.style.opacity = "0";
  label.style.pointerEvents = "none";
  label.appendChild(input);
  document.body.appendChild(label);

  iosLabel = label;
  return label;
}

function iosTap() {
  const label = ensureIosSwitch();
  if (!label) return;
  label.click(); // dispatches through the label, toggling the input — this is what fires the haptic
}

/** Multiple taps in quick succession approximate distinct feels, since the
 * trick itself has no intensity/pattern control — just one uniform pulse
 * per toggle. */
function iosPattern(taps: number, gapMs = 90) {
  for (let i = 0; i < taps; i++) {
    window.setTimeout(iosTap, i * gapMs);
  }
}

// --- Public API --------------------------------------------------------

export type HapticCue =
  | "select" // light — piece picked up
  | "move" // light — legal move landed
  | "capture" // medium — took a piece
  | "castle" // medium
  | "check" // medium, sharper
  | "checkmate" // heavy — game-ending
  | "illegal" // error buzz — invalid move attempt
  | "ui"; // very light — button taps, toggles

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function triggerHaptic(cue: HapticCue) {
  if (!enabled) return;

  if (isIOS()) {
    switch (cue) {
      case "select":
      case "ui":
        iosPattern(1);
        break;
      case "move":
      case "castle":
        iosPattern(1);
        break;
      case "capture":
      case "check":
        iosPattern(2);
        break;
      case "checkmate":
        iosPattern(3, 110);
        break;
      case "illegal":
        iosPattern(2, 60); // quicker double-tap reads as a "no"
        break;
    }
    return;
  }

  if (!hasVibrate()) return;

  // Android Vibration API — real patterns, ms on/off pairs.
  const patterns: Record<HapticCue, number | number[]> = {
    select: 8,
    ui: 8,
    move: 12,
    castle: 15,
    capture: 20,
    check: [15, 40, 15],
    checkmate: [25, 60, 25, 60, 40],
    illegal: [10, 30, 10],
  };
  navigator.vibrate(patterns[cue]);
}
