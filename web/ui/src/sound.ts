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

function loadMuted(): boolean {
  return localStorage.getItem(KEY) === "off";
}

let muted = loadMuted();

export function isSoundOn(): boolean {
  return !muted;
}

export function setSoundOn(on: boolean) {
  muted = !on;
  localStorage.setItem(KEY, on ? "on" : "off");
}

export function toggleSound(): boolean {
  setSoundOn(!isSoundOn());
  return isSoundOn();
}

export function soundLabel(on = isSoundOn()): string {
  return on ? "Sound" : "Muted";
}

function ensureCtx(): AudioContext | null {
  if (muted || typeof window === "undefined") return null;
  if (!ctx) {
    try {
      // On iOS Safari, Web Audio playback can be treated as exclusive,
      // pausing the user's background music (Spotify/Apple Music) even for
      // short move sound effects. The AudioSession API lets us explicitly
      // request "ambient" — mixable with other apps' audio — instead of
      // leaving it to Safari's default resolution. No-op on browsers that
      // don't support it (Chrome/Firefox don't have this problem anyway).
      const nav = navigator as Navigator & {
        audioSession?: { type: string };
      };
      if (nav.audioSession) {
        nav.audioSession.type = "ambient";
      }

      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture so autoplay policies unlock audio. */
export function unlockAudio() {
  ensureCtx();
}

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
  const c = ensureCtx();
  if (!c) return;

  switch (sfx) {
    case "select":
      wood(c, { duration: 0.028, gain: 0.035, freq: 1100, q: 1.4 });
      tone(c, { freq: 620, duration: 0.05, type: "triangle", gain: 0.028 });
      break;
    case "deselect":
      wood(c, { duration: 0.022, gain: 0.025, freq: 900, q: 1.2 });
      break;
    case "move":
      wood(c, { duration: 0.05, gain: 0.06, freq: 480, q: 0.9 });
      tone(c, {
        freq: 180,
        duration: 0.09,
        type: "sine",
        gain: 0.045,
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
      wood(c, { duration: 0.02, gain: 0.022, freq: 1400, q: 1.8 });
      break;
    case "mode":
      wood(c, { duration: 0.028, gain: 0.038, freq: 980, q: 1.3 });
      tone(c, {
        freq: 520,
        duration: 0.07,
        type: "triangle",
        gain: 0.028,
      });
      break;
    case "start":
      tone(c, { freq: 330, duration: 0.14, type: "sine", gain: 0.04 });
      tone(c, {
        freq: 440,
        duration: 0.18,
        type: "triangle",
        gain: 0.04,
        delay: 0.07,
      });
      wood(c, { duration: 0.04, gain: 0.035, freq: 700, delay: 0.04 });
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
