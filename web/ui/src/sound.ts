/**
 * Soft wooden / ceramic SFX via Web Audio (no asset files).
 * Pastel-plate tone: quiet place-thuds, not arcade blips.
 */

const KEY = "yacewo-sound";

export type Sfx =
  | "select"
  | "deselect"
  | "move"
  | "capture"
  | "castle"
  | "check"
  | "checkmate"
  | "draw"
  | "illegal"
  | "promote"
  | "undo"
  | "resign"
  | "offer"
  | "ui"
  | "mode"
  | "start"
  | "copy"
  | "connect"
  | "wave"
  | "waveQueer"
  | "queer";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let gestureUnlockInstalled = false;
let iosUnlocked = false;
let pending: Sfx[] = [];
/** Looping silent <audio> forces iOS onto the media channel (ignores ringer switch). */
let silentEl: HTMLAudioElement | null = null;

/**
 * Short silent WAV (feross/unmute-ios-audio style). Sample-rate digits are
 * filled so WebKit treats it as a valid media file.
 */
function silentWavDataUri(sampleRate = 44100): string {
  const buf = new ArrayBuffer(10);
  const view = new DataView(buf);
  view.setUint32(0, sampleRate, true);
  view.setUint32(4, sampleRate, true);
  view.setUint16(8, 1, true);
  const mid = btoa(String.fromCharCode(...new Uint8Array(buf))).slice(0, 13);
  return `data:audio/wav;base64,UklGRisAAABXQVZFZm10IBAAAAABAAEA${mid}AgAZGF0YQcAAACAgICAgICAAAA=`;
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
}

let muted = loadMuted();

export function isSoundOn(): boolean {
  return !muted;
}

export function setSoundOn(on: boolean) {
  muted = !on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (muted) stopSilentHtml();
}

export function toggleSound(): boolean {
  setSoundOn(!isSoundOn());
  return isSoundOn();
}

export function soundLabel(on = isSoundOn()): string {
  return on ? "Sound" : "Muted";
}

function audioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

/** Safari 16.4+: treat page audio as media, not ringer/ambient. */
function forcePlaybackSession() {
  try {
    const session = (
      navigator as Navigator & { audioSession?: { type: string } }
    ).audioSession;
    if (session) session.type = "playback";
  } catch {
    /* ignore */
  }
}

/**
 * iOS: a context created outside a gesture can stay permanently suspended.
 * Only call this from a synchronous user-gesture handler.
 */
function ensureCtx(): AudioContext | null {
  if (muted || typeof window === "undefined") return null;
  if (!ctx) {
    const AC = audioContextCtor();
    if (!AC) return null;
    try {
      forcePlaybackSession();
      ctx = new AC();
      master = ctx.createGain();
      // Louder master — previous ~0.55 × soft gains was near-inaudible on phones.
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      ctx.addEventListener("statechange", flushPending);
    } catch {
      ctx = null;
      master = null;
      return null;
    }
  }
  return ctx;
}

/** Howler / iOS9 classic: empty buffer start inside the gesture. */
function kickBuffer(c: AudioContext) {
  try {
    const buffer = c.createBuffer(1, 1, 22050);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.start(0);
  } catch {
    /* ignore */
  }
}

function stopSilentHtml() {
  if (!silentEl) return;
  try {
    silentEl.pause();
    silentEl.removeAttribute("src");
    silentEl.load();
  } catch {
    /* ignore */
  }
  silentEl = null;
}

/**
 * Keep a looping silent HTMLAudioElement playing. On iOS this moves Web Audio
 * onto the media category so the hardware mute switch does not silence SFX.
 * @see https://github.com/feross/unmute-ios-audio
 * @see https://stackoverflow.com/questions/40789136/ios-ringer-switch-mutes-web-audio
 */
function ensureSilentHtml(sampleRate: number) {
  if (silentEl) {
    if (silentEl.paused) void silentEl.play().catch(() => undefined);
    return;
  }
  try {
    const a = document.createElement("audio");
    a.setAttribute("x-webkit-airplay", "deny");
    a.preload = "auto";
    a.loop = true;
    a.volume = 0.01;
    a.src = silentWavDataUri(sampleRate);
    a.load();
    silentEl = a;
    void a.play().catch(() => {
      stopSilentHtml();
    });
  } catch {
    silentEl = null;
  }
}

/**
 * Throwaway context resume flips iOS's "gesture succeeded" flag so later
 * AudioContexts can run.
 * @see https://js2devlog.com/en/devlog/ios-safari-audio-unlock
 */
function kickDummyContext() {
  const AC = audioContextCtor();
  if (!AC) return;
  try {
    const u = new AC();
    const done = () => {
      try {
        void u.close();
      } catch {
        /* ignore */
      }
    };
    if (u.state === "running") {
      done();
      return;
    }
    void u.resume().then(done, done);
  } catch {
    /* ignore */
  }
}

function flushPending() {
  if (!ctx || ctx.state !== "running" || muted) return;
  const queue = pending;
  pending = [];
  for (const sfx of queue) playSfx(ctx, sfx);
}

/**
 * Must run synchronously at the top of a user-gesture callback on iOS.
 * Creating AudioContext outside a gesture can leave it unresumable forever.
 */
export function unlockAudio() {
  if (muted || typeof window === "undefined") return;
  forcePlaybackSession();
  // Order matters: dummy unlock first, then real ctx + buffer + HTML audio.
  kickDummyContext();
  const c = ensureCtx();
  if (!c) return;
  ensureSilentHtml(c.sampleRate || 44100);
  kickBuffer(c);
  if (c.state === "suspended" || (c.state as string) === "interrupted") {
    void c.resume().then(() => {
      if (c.state === "running") iosUnlocked = true;
      flushPending();
    }, () => undefined);
  } else if (c.state === "running") {
    iosUnlocked = true;
    flushPending();
  }
}

/** First tap anywhere — touchstart/touchend are most reliable on iOS. */
export function installGestureUnlock() {
  if (gestureUnlockInstalled || typeof window === "undefined") return;
  gestureUnlockInstalled = true;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const onGesture = () => {
    unlockAudio();
    if (iosUnlocked || ctx?.state === "running") {
      window.removeEventListener("touchstart", onGesture, opts);
      window.removeEventListener("touchend", onGesture, opts);
      window.removeEventListener("pointerup", onGesture, opts);
      window.removeEventListener("click", onGesture, opts);
      window.removeEventListener("keydown", onGesture, opts);
    }
  };
  window.addEventListener("touchstart", onGesture, opts);
  window.addEventListener("touchend", onGesture, opts);
  window.addEventListener("pointerup", onGesture, opts);
  window.addEventListener("click", onGesture, opts);
  window.addEventListener("keydown", onGesture, opts);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Drop silent media so iOS does not keep a Now Playing widget.
      stopSilentHtml();
      return;
    }
    if (!ctx) return;
    if (ctx.state === "suspended" || (ctx.state as string) === "interrupted") {
      void ctx.resume().then(flushPending, () => undefined);
    }
  });
}

installGestureUnlock();

function dest(c: AudioContext): AudioNode {
  return master ?? c.destination;
}

function tone(
  c: AudioContext,
  opts: {
    freq: number;
    duration: number;
    type?: OscillatorType;
    gain?: number;
    attack?: number;
    delay?: number;
    slideTo?: number;
  },
) {
  const {
    freq,
    duration,
    type = "sine",
    gain = 0.07,
    attack = 0.004,
    delay = 0,
    slideTo,
  } = opts;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, slideTo),
      t0 + duration * 0.85,
    );
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(dest(c));
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Filtered noise burst — wooden “place” / “clack”. */
function wood(
  c: AudioContext,
  opts: {
    duration?: number;
    gain?: number;
    freq?: number;
    q?: number;
    delay?: number;
  } = {},
) {
  const {
    duration = 0.045,
    gain = 0.055,
    freq = 720,
    q = 1.1,
    delay = 0,
  } = opts;
  const n = Math.max(1, Math.floor(c.sampleRate * duration));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-3.2 * (i / n));
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = c.createGain();
  const t0 = c.currentTime + delay;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(dest(c));
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

export function play(sfx: Sfx) {
  if (muted) return;

  // Never create AudioContext here — on iOS a context created outside a
  // user gesture can stay permanently suspended. Gesture unlock owns create.
  if (!ctx) {
    pending.push(sfx);
    return;
  }

  if (ctx.state === "running") {
    playSfx(ctx, sfx);
    return;
  }

  pending.push(sfx);
  if (ctx.state === "suspended" || (ctx.state as string) === "interrupted") {
    void ctx.resume().then(flushPending, () => undefined);
  }
}

function playSfx(c: AudioContext, sfx: Sfx) {
  switch (sfx) {
    case "select":
      wood(c, { duration: 0.028, gain: 0.08, freq: 1100, q: 1.4 });
      tone(c, { freq: 620, duration: 0.05, type: "triangle", gain: 0.06 });
      break;
    case "deselect":
      wood(c, { duration: 0.022, gain: 0.06, freq: 900, q: 1.2 });
      break;
    case "move":
      wood(c, { duration: 0.05, gain: 0.12, freq: 480, q: 0.9 });
      tone(c, {
        freq: 180,
        duration: 0.09,
        type: "sine",
        gain: 0.09,
        attack: 0.002,
      });
      break;
    case "capture":
      wood(c, { duration: 0.035, gain: 0.07, freq: 980, q: 1.6 });
      wood(c, { duration: 0.06, gain: 0.05, freq: 320, q: 0.8, delay: 0.018 });
      tone(c, {
        freq: 140,
        duration: 0.12,
        type: "triangle",
        gain: 0.04,
        delay: 0.01,
      });
      break;
    case "castle":
      wood(c, { duration: 0.04, gain: 0.05, freq: 520 });
      tone(c, { freq: 200, duration: 0.07, gain: 0.035 });
      wood(c, { duration: 0.045, gain: 0.055, freq: 440, delay: 0.07 });
      tone(c, { freq: 160, duration: 0.09, gain: 0.04, delay: 0.07 });
      break;
    case "check":
      tone(c, {
        freq: 520,
        duration: 0.12,
        type: "triangle",
        gain: 0.05,
      });
      tone(c, {
        freq: 780,
        duration: 0.16,
        type: "triangle",
        gain: 0.045,
        delay: 0.07,
      });
      break;
    case "checkmate":
      tone(c, { freq: 392, duration: 0.22, type: "sine", gain: 0.05 });
      tone(c, {
        freq: 494,
        duration: 0.28,
        type: "sine",
        gain: 0.045,
        delay: 0.08,
      });
      tone(c, {
        freq: 587,
        duration: 0.4,
        type: "triangle",
        gain: 0.055,
        delay: 0.18,
      });
      wood(c, { duration: 0.06, gain: 0.04, freq: 400, delay: 0.05 });
      break;
    case "draw":
      tone(c, {
        freq: 440,
        duration: 0.2,
        type: "sine",
        gain: 0.04,
        slideTo: 330,
      });
      tone(c, {
        freq: 330,
        duration: 0.28,
        type: "triangle",
        gain: 0.035,
        delay: 0.12,
        slideTo: 260,
      });
      break;
    case "illegal":
      wood(c, { duration: 0.04, gain: 0.04, freq: 180, q: 0.6 });
      tone(c, {
        freq: 110,
        duration: 0.1,
        type: "square",
        gain: 0.018,
      });
      break;
    case "promote":
      wood(c, { duration: 0.04, gain: 0.05, freq: 600 });
      tone(c, { freq: 440, duration: 0.1, type: "triangle", gain: 0.04 });
      tone(c, {
        freq: 660,
        duration: 0.14,
        type: "triangle",
        gain: 0.04,
        delay: 0.06,
      });
      tone(c, {
        freq: 880,
        duration: 0.18,
        type: "sine",
        gain: 0.035,
        delay: 0.12,
      });
      break;
    case "undo":
      wood(c, { duration: 0.035, gain: 0.04, freq: 640 });
      tone(c, {
        freq: 280,
        duration: 0.08,
        type: "sine",
        gain: 0.03,
        slideTo: 200,
      });
      break;
    case "resign":
      tone(c, {
        freq: 360,
        duration: 0.22,
        type: "sine",
        gain: 0.04,
        slideTo: 180,
      });
      wood(c, { duration: 0.05, gain: 0.035, freq: 280, delay: 0.05 });
      break;
    case "offer":
      tone(c, { freq: 480, duration: 0.1, type: "triangle", gain: 0.035 });
      tone(c, {
        freq: 600,
        duration: 0.12,
        type: "triangle",
        gain: 0.03,
        delay: 0.08,
      });
      break;
    case "ui":
      wood(c, { duration: 0.02, gain: 0.06, freq: 1400, q: 1.8 });
      break;
    case "mode":
      wood(c, { duration: 0.028, gain: 0.09, freq: 980, q: 1.3 });
      tone(c, {
        freq: 520,
        duration: 0.07,
        type: "triangle",
        gain: 0.07,
      });
      break;
    case "start":
      tone(c, { freq: 330, duration: 0.14, type: "sine", gain: 0.09 });
      tone(c, {
        freq: 440,
        duration: 0.18,
        type: "triangle",
        gain: 0.09,
        delay: 0.07,
      });
      wood(c, { duration: 0.04, gain: 0.08, freq: 700, delay: 0.04 });
      break;
    case "copy":
      tone(c, { freq: 720, duration: 0.06, type: "sine", gain: 0.03 });
      tone(c, {
        freq: 960,
        duration: 0.08,
        type: "sine",
        gain: 0.028,
        delay: 0.04,
      });
      break;
    case "connect":
      tone(c, { freq: 520, duration: 0.1, type: "sine", gain: 0.035 });
      tone(c, {
        freq: 780,
        duration: 0.16,
        type: "triangle",
        gain: 0.04,
        delay: 0.06,
      });
      break;
    case "wave": {
      // Match preview column stagger (48ms × 8) with soft rising ticks.
      const step = 0.048;
      for (let i = 0; i < 8; i++) {
        const delay = i * step;
        const freq = 520 + i * 42;
        wood(c, {
          duration: 0.022,
          gain: 0.016,
          freq: freq + 280,
          q: 1.6,
          delay,
        });
        tone(c, {
          freq,
          duration: 0.055,
          type: "triangle",
          gain: 0.014,
          delay,
        });
      }
      break;
    }
    case "waveQueer": {
      // Soft rainbow ticks — same volume neighborhood as the regular wave.
      const notes = [523, 587, 659, 740, 831, 932, 1047, 1175];
      notes.forEach((freq, i) => {
        const delay = i * 0.048;
        tone(c, {
          freq,
          duration: 0.06,
          type: "sine",
          gain: 0.012,
          delay,
        });
        tone(c, {
          freq: freq * 1.5,
          duration: 0.04,
          type: "triangle",
          gain: 0.006,
          delay: delay + 0.012,
        });
      });
      break;
    }
    case "queer": {
      // Cute pastel sparkle — soft and light, not a fanfare.
      const notes = [523.25, 659.25, 783.99, 987.77, 1174.66];
      notes.forEach((freq, i) => {
        const delay = i * 0.05;
        tone(c, {
          freq,
          duration: 0.11,
          type: "sine",
          gain: 0.018,
          delay,
        });
        tone(c, {
          freq: freq * 1.498,
          duration: 0.08,
          type: "triangle",
          gain: 0.008,
          delay: delay + 0.02,
        });
      });
      tone(c, {
        freq: 1318.51,
        duration: 0.18,
        type: "sine",
        gain: 0.014,
        delay: 0.22,
      });
      break;
    }
  }
}

/** Last SAN token from a move list (handles “1. e4”, “12… Nf6”, etc.). */
export function lastSanToken(moveList: string): string {
  const parts = moveList.trim().split(/\s+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (/^\d+\.+$/.test(p)) continue;
    return p.replace(/^[…]+/, "");
  }
  return "";
}

export function playMoveOutcome(opts: {
  kind: "move" | "castle" | "notation" | "undo" | "resign" | "draw";
  moveList?: string;
  promo?: string | null;
  statusTag?: string;
  /** True when a draw offer was made but the game is still going. */
  offeredOnly?: boolean;
}) {
  const { kind, moveList = "", promo, statusTag = "", offeredOnly } = opts;

  if (kind === "undo") {
    play("undo");
    return;
  }
  if (kind === "resign") {
    play("resign");
    return;
  }
  if (kind === "draw") {
    if (offeredOnly || statusTag !== "draw_agreement") play("offer");
    else play("draw");
    return;
  }

  if (kind === "castle") {
    play("castle");
  } else {
    const san = lastSanToken(moveList);
    if (/^O-O/.test(san)) play("castle");
    else if (promo || /=/.test(san)) play("promote");
    else if (/x/.test(san)) play("capture");
    else play("move");
  }

  switch (statusTag) {
    case "check":
      window.setTimeout(() => play("check"), 90);
      break;
    case "checkmate":
      window.setTimeout(() => play("checkmate"), 110);
      break;
    case "stalemate":
    case "draw_insufficient":
      window.setTimeout(() => play("draw"), 100);
      break;
  }
}
