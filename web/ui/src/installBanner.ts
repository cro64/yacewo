/**
 * First-visit "add to Home Screen" banner.
 *
 * Lives outside `#app` so the App's innerHTML re-renders never wipe it, and
 * sits in normal flow above it so it pushes the page down instead of covering
 * the topbar. Shown at most once, ever — the visit is recorded the moment it
 * appears.
 *
 * Two paths:
 *   - Chromium: `beforeinstallprompt` is captured and replayed on Install.
 *   - iOS Safari: no API — show the Share → Add to Home Screen recipe.
 * Anything else (Firefox, desktop Safari) gets no banner: we'd have nothing
 * useful to tell them.
 */

import { isIOSSafariNotInstalled } from "./iosPrompt";
import { armHapticTargets } from "./haptics";

const KEY = "yacewo-install-prompt";
/** Height the rest of the layout must give up while the banner is present. */
const HEIGHT_VAR = "--install-banner-h";
/** Let the landing settle before the banner drops in. */
const SHOW_DELAY_MS = 1200;

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallEvent | null = null;
let el: HTMLElement | null = null;
let allowed = false;
let armed = false;
/** Backs up the localStorage flag when storage is unavailable (private mode). */
let seen = false;
let showTimer: number | null = null;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

/** Any stored value means "already offered" — the banner is a one-time thing. */
function alreadyOffered(): boolean {
  if (seen) return true;
  try {
    return localStorage.getItem(KEY) != null;
  } catch {
    return false;
  }
}

function remember(value: "seen" | "installed") {
  seen = true;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* private mode — `seen` still holds for this visit */
  }
}

function eligible(): boolean {
  if (alreadyOffered() || isStandalone()) return false;
  return deferred != null || isIOSSafariNotInstalled();
}

const SHARE_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
      stroke-linejoin="round" d="M12 3.5v10M8.5 7 12 3.5 15.5 7M6 11.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7.5a1 1 0 0 0-1-1h-1"/>
  </svg>
`;

function build(): HTMLElement {
  const ios = deferred == null;
  const node = document.createElement("div");
  node.className = "install-banner";
  node.setAttribute("role", "region");
  node.setAttribute("aria-label", "Install YACEWO");
  node.innerHTML = `
    <div class="install-banner-inner">
      <div class="install-banner-text">
        <p class="install-banner-title">Add YACEWO to your Home Screen</p>
        <p class="install-banner-copy">${
          ios
            ? `Tap <span class="install-share">${SHARE_ICON}<span>Share</span></span> then “Add to Home Screen”.`
            : "Full-screen play and move alerts."
        }</p>
      </div>
      <div class="install-banner-actions">
        ${
          ios
            ? `<button type="button" class="text-btn" data-action="install-dismiss">Got it</button>`
            : `<button type="button" class="primary-btn install-btn" data-action="install-accept">Install</button>
               <button type="button" class="text-btn" data-action="install-dismiss">Not now</button>`
        }
      </div>
    </div>
  `;

  node.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest("[data-action='install-accept']")) {
      void accept();
    } else if (t.closest("[data-action='install-dismiss']")) {
      hide();
    }
  });
  return node;
}

async function accept() {
  const evt = deferred;
  if (!evt) return;
  deferred = null;
  hide();
  try {
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "accepted") remember("installed");
  } catch {
    /* prompt already consumed — nothing to do */
  }
}

function show() {
  if (el || !eligible()) return;
  // One offer per device: record it as soon as it's on screen.
  remember("seen");
  el = build();
  document.body.prepend(el);
  // In flow, so the shell has to give back exactly what the banner takes.
  document.documentElement.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`);
  armHapticTargets(el);
  requestAnimationFrame(() => el?.classList.add("is-open"));
}

function hide() {
  if (showTimer != null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
  const node = el;
  if (!node) return;
  el = null;
  node.classList.remove("is-open");
  // Matches the CSS transition; reduced motion just removes it a beat later.
  window.setTimeout(() => {
    node.remove();
    document.documentElement.style.removeProperty(HEIGHT_VAR);
  }, 260);
}

/**
 * Show or hide the banner for the current screen. Cheap and idempotent —
 * safe to call from every render.
 */
export function syncInstallBanner(visible: boolean) {
  allowed = visible;
  if (!allowed) {
    hide();
    return;
  }
  if (el || showTimer != null || !eligible()) return;
  showTimer = window.setTimeout(() => {
    showTimer = null;
    if (allowed) show();
  }, SHOW_DELAY_MS);
}

/** Start listening for install signals. Call once at boot. */
export function armInstallBanner() {
  if (armed) return;
  armed = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep the event so Install can replay it; the browser's own mini-infobar
    // is suppressed either way.
    e.preventDefault();
    deferred = e as InstallEvent;
    if (allowed) syncInstallBanner(true);
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    remember("installed");
    hide();
  });
}
