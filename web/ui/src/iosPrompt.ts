/**
 * iPadOS 13+ reports as `MacIntel` with touch points, so that pair is the only
 * way to spot an iPad. It also matches things that are *not* iPads: Chrome or
 * Electron on a Mac with device emulation on, or a touch display attached.
 * Safari's non-standard `navigator.standalone` separates them — it exists on
 * iOS/iPadOS Safari and nowhere on the desktop. The UA fallback keeps iPads
 * covered if that flag ever goes away.
 */
function isIPadOS(): boolean {
  if (navigator.platform !== "MacIntel" || navigator.maxTouchPoints < 2) {
    return false;
  }
  return (
    "standalone" in navigator || !/Chrome|Chromium|Firefox/.test(navigator.userAgent)
  );
}

/** iOS Safari in a plain tab — push requires Home Screen install. */
export function isIOSSafariNotInstalled(): boolean {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPadOS();
  if (!isIOS) return false;

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  return !standalone;
}
