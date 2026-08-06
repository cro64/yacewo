const DISMISS_KEY = "yacewo-ios-install-dismissed";

/** iOS Safari in a plain tab — push requires Home Screen install. */
export function isIOSSafariNotInstalled(): boolean {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac; detect via touch points.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIOS) return false;

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  return !standalone;
}

export function isIosInstallPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissIosInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

export function shouldShowIosInstallPrompt(): boolean {
  return isIOSSafariNotInstalled() && !isIosInstallPromptDismissed();
}
