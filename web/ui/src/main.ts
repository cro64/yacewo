import "./styles.css";
import {
  loadEngine,
  type Color,
  type EngineResult,
  type GameSnapshot,
  type LegalMove,
  type Piece,
  type PieceKind,
  type YacewoApi,
} from "./engine";
import {
  NetSession,
  normalizeRoom,
  type GameSetup,
  type NetMsg,
  type NetStatus,
  type QueerVariant,
} from "./net";
import {
  applyTheme,
  cycleTheme,
  getStoredTheme,
  storeTheme,
  themeLabel,
  type ThemeMode,
} from "./theme";

type Screen = "landing" | "lobby" | "play";
type ActionMsg = Exclude<
  NetMsg,
  { type: "hello" } | { type: "ready" } | { type: "sync" }
>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Text-presentation selector — keeps pieces monochrome so CSS color works on iOS. */
const TEXT = "\uFE0E";

const PIECES: Record<string, string> = {
  // Filled glyphs for both sides; FE0E + CSS color paint white vs black.
  "white-king": `♚${TEXT}`,
  "white-queen": `♛${TEXT}`,
  "white-rook": `♜${TEXT}`,
  "white-bishop": `♝${TEXT}`,
  "white-knight": `♞${TEXT}`,
  "white-pawn": `♟${TEXT}`,
  "black-king": `♚${TEXT}`,
  "black-queen": `♛${TEXT}`,
  "black-rook": `♜${TEXT}`,
  "black-bishop": `♝${TEXT}`,
  "black-knight": `♞${TEXT}`,
  "black-pawn": `♟${TEXT}`,
};

const PROMO_GLYPH: Record<string, string> = {
  queen: `♛${TEXT}`,
  rook: `♜${TEXT}`,
  bishop: `♝${TEXT}`,
  knight: `♞${TEXT}`,
  king: `♚${TEXT}`,
};

/** Soft rainbow pastels for Queer-mode legal-move markers. */
const QUEER_LEGAL_PASTELS = [
  "#f7a8b8", // rose
  "#f9c98a", // peach
  "#f6e27a", // butter
  "#b8e0a8", // mint
  "#a8d4f0", // sky
  "#c5b4f0", // lilac
  "#f0b8e0", // orchid
] as const;

function pickQueerLegalColor(): string {
  const i = Math.floor(Math.random() * QUEER_LEGAL_PASTELS.length);
  return QUEER_LEGAL_PASTELS[i]!;
}

function fileRank(i: number): { file: number; rank: number; alg: string } {
  const file = (i % 8) + 1;
  const rank = 8 - Math.floor(i / 8);
  const alg = `${String.fromCharCode(96 + file)}${rank}`;
  return { file, rank, alg };
}

function statusText(game: GameSnapshot, mode?: GameMode): string {
  const st = game.status;
  switch (st.tag) {
    case "in_progress":
      return `${cap(game.turn)} to move`;
    case "check":
      return `${cap(st.color ?? game.turn)} in check — ${cap(game.turn)} to move`;
    case "checkmate":
      if (mode === "horde" && st.color === "white") {
        return "Black wins — horde destroyed";
      }
      return `${cap(st.color === "white" ? "black" : "white")} wins by checkmate`;
    case "stalemate":
      return "Draw by stalemate";
    case "draw_insufficient":
      return "Draw by insufficient material";
    case "draw_agreement":
      return "Draw by agreement";
    case "resigned":
      return `${cap(st.color === "white" ? "black" : "white")} wins — ${cap(st.color ?? "")} resigned`;
    default:
      return st.tag;
  }
}

function drawOfferText(game: GameSnapshot): string | null {
  if (game.isOver) return null;
  const white = game.whiteDrawOffer;
  const black = game.blackDrawOffer;
  if (!white && !black) return null;
  if (white && black) return "Draw offered by both sides";
  if (white && game.turn === "black") return "White offered a draw — accept or move";
  if (black && game.turn === "white") return "Black offered a draw — accept or move";
  if (white && game.turn === "white") return "White offered a draw — play your move";
  if (black && game.turn === "black") return "Black offered a draw — play your move";
  return null;
}

/** True when the side to move can accept an outstanding opponent offer. */
function canAcceptDraw(game: GameSnapshot, myColor: Color | null = null): boolean {
  if (game.isOver) return false;
  // Remote: only the side to move may accept (never on the opponent's clock).
  if (myColor != null && game.turn !== myColor) return false;
  return game.turn === "white" ? game.blackDrawOffer : game.whiteDrawOffer;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function pieceGlyph(p: Piece | null): string {
  if (!p) return "";
  return PIECES[`${p.color}-${p.kind}`] ?? "";
}

/** Shareable join URL for GitHub Pages (`/yacewo/?room=ABC123`). */
function roomShareUrl(room: string): string {
  const url = new URL(import.meta.env.BASE_URL || "/", location.origin);
  url.searchParams.set("room", room);
  return url.href;
}

function replaceSearchParams(mutate: (params: URLSearchParams) => void) {
  const url = new URL(location.href);
  mutate(url.searchParams);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(null, "", next);
  }
}

function syncRoomInUrl(room: string | null) {
  replaceSearchParams((params) => {
    if (room) {
      params.set("room", room);
      params.delete("seed");
      params.delete("mode");
    } else {
      params.delete("room");
    }
  });
}

type SeededMode = "anarchy" | "chess960";
type GameMode = "classical" | SeededMode | "queer" | "horde";

/** Match OCaml [Setup.chess960_id]: any int → [0, 959]. */
function normalizeChess960Id(n: number): number {
  return ((n % 960) + 960) % 960;
}

function isChess960Id(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 959;
}

function queerLabel(variant: QueerVariant): string {
  return variant === "queens" ? "Double Queens" : "Double Kings";
}

function queerVariantFromFen(fen: string): QueerVariant | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.includes("dq")) return "queens";
  if (parts.includes("dk")) return "kings";
  return null;
}

function parseSeededInput(
  trimmed: string,
  mode: SeededMode,
): { ok: true; seed: number } | { ok: false; error: string } {
  if (trimmed === "") {
    return {
      ok: false,
      error:
        mode === "chess960"
          ? "Pick or roll a Chess960 ID first"
          : "Pick or roll an Anarchy seed first",
    };
  }
  const n = Number(trimmed);
  if (mode === "chess960") {
    if (!isChess960Id(n)) {
      return { ok: false, error: "Chess960 ID must be an integer from 0 to 959" };
    }
    return { ok: true, seed: n };
  }
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, error: "Seed must be a non-negative integer" };
  }
  return { ok: true, seed: n };
}

function syncSeedInUrl(seed: number | null, mode: SeededMode = "anarchy") {
  replaceSearchParams((params) => {
    if (seed != null) {
      params.set("seed", String(seed));
      params.delete("room");
      if (mode === "chess960") params.set("mode", "chess960");
      else params.delete("mode");
    } else {
      params.delete("seed");
      params.delete("mode");
    }
  });
}

function syncQueerInUrl(variant: QueerVariant) {
  replaceSearchParams((params) => {
    params.delete("room");
    params.delete("seed");
    params.set("mode", variant === "queens" ? "dq" : "dk");
  });
}

function syncHordeInUrl() {
  replaceSearchParams((params) => {
    params.delete("room");
    params.delete("seed");
    params.set("mode", "horde");
  });
}

function hordeFromUrl(): boolean {
  return new URLSearchParams(location.search).get("mode") === "horde";
}

function roomFromUrl(): string {
  return normalizeRoom(new URLSearchParams(location.search).get("room") ?? "");
}

function queerFromUrl(): QueerVariant | null {
  const m = new URLSearchParams(location.search).get("mode");
  if (m === "dq" || m === "queer-queens") return "queens";
  if (m === "dk" || m === "queer" || m === "queer-kings") return "kings";
  return null;
}

/** Queer landing tab: Pride Month, or an explicit queer mode in the URL. */
function isQueerUnlocked(): boolean {
  return new Date().getMonth() === 5 || queerFromUrl() != null;
}

function seedFromUrl(): number | null {
  // Variant share links should not open the seed ritual.
  if (queerFromUrl() != null || hordeFromUrl()) return null;
  const raw = new URLSearchParams(location.search).get("seed");
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  // Chess960: accept any int (engine/UI normalize via mod). Anarchy: non-negative.
  if (seededModeFromUrl() === "chess960") return n;
  if (n < 0) return null;
  return n;
}

function seededModeFromUrl(): SeededMode {
  return new URLSearchParams(location.search).get("mode") === "chess960"
    ? "chess960"
    : "anarchy";
}

function isSeededMode(mode: GameMode): mode is SeededMode {
  return mode === "anarchy" || mode === "chess960";
}

function playModeFromSetup(setup: GameSetup): GameMode {
  if (setup.kind === "fen") return "classical";
  if (setup.kind === "queer") return "queer";
  return setup.kind;
}

class App {
  private api!: YacewoApi;
  private root: HTMLElement;
  private screen: Screen = "landing";
  private theme: ThemeMode = getStoredTheme();
  private game: GameSnapshot | null = null;
  private mode: GameMode = "classical";
  private playMode: GameMode = "classical";
  private queerVariant: QueerVariant = "kings";
  private seedInput = "";
  private fenInput = "";
  private selected: string | null = null;
  /** Queer-mode legal-marker pastel; rerolled each time markers are shown. */
  private queerLegalColor: string | null = null;
  private error = "";
  private helpOpen = false;
  private pendingPromo: { from: string; to: string } | null = null;
  private notation = "";
  /** Landing hero board (non-interactive). */
  private previewBoard: Array<Piece | null> = [];
  /** Held seed when the input is blank (WYSIWYG with Play). */
  private previewSeed: number | null = null;
  private previewAnim = false;

  private fenOpen = false;
  private seedOpen = false;
  private joinOpen = false;
  private remoteJoinCode = "";
  private net: NetSession | null = null;
  private netStatus: NetStatus = { phase: "idle" };
  /** Set in remote games; null means local hotseat. */
  private myColor: Color | null = null;
  private remoteSetup: GameSetup | null = null;
  /** Guest mid-game reconnect in progress. */
  private reconnecting = false;
  /** Bumps to cancel an in-flight guest rejoin loop (Quit / new session). */
  private rejoinGeneration = 0;
  /** Which copy button briefly shows “Copied”. */
  private copiedFlash: "fen" | "moves" | "seed" | "room" | "room-link" | null =
    null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private keysBound = false;
  /** Hotseat: when on, board orients to the side to move. Default off. */
  private autoFlip = false;
  /** Soft from/to tint for the previous ply. Default off. */
  private showLastMove = false;
  /** File/rank gutters around the board. Default off. */
  private showCoords = false;
  /** Stack of last-move highlights (popped on undo). */
  private lastMoves: Array<{ from: string; to: string }> = [];

  constructor(root: HTMLElement) {
    this.root = root;
    applyTheme(this.theme);
  }

  private copyLabel(
    kind: NonNullable<App["copiedFlash"]>,
    idle: string,
  ): string {
    return this.copiedFlash === kind ? "Copied" : idle;
  }

  private flashCopied(kind: NonNullable<App["copiedFlash"]>) {
    if (this.copiedTimer != null) clearTimeout(this.copiedTimer);
    this.copiedFlash = kind;
    this.render();
    this.copiedTimer = setTimeout(() => {
      this.copiedFlash = null;
      this.copiedTimer = null;
      this.render();
    }, 1200);
  }

  private async copyText(text: string, kind: NonNullable<App["copiedFlash"]>, failLabel: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.flashCopied(kind);
    } catch {
      this.error = `Could not copy ${failLabel}`;
      this.render();
    }
  }

  private bindKeys() {
    if (this.keysBound) return;
    this.keysBound = true;
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!this.pendingPromo && !this.selected && !this.helpOpen) return;
      e.preventDefault();
      this.pendingPromo = null;
      this.clearSelection();
      this.helpOpen = false;
      this.render();
    });
  }

  private isRemote(): boolean {
    return this.myColor != null;
  }

  /** Squares of critical pieces in check / checkmate. */
  private checkSquares(): string[] {
    if (!this.game) return [];
    const tag = this.game.status.tag;
    if (tag !== "check" && tag !== "checkmate") return [];
    const color = this.game.status.color ?? this.game.turn;
    const kind: PieceKind =
      this.playMode === "queer" && this.queerVariant === "queens"
        ? "queen"
        : "king";
    const out: string[] = [];
    for (let i = 0; i < 64; i++) {
      const p = this.game.board[i];
      if (p && p.kind === kind && p.color === color) out.push(fileRank(i).alg);
    }
    return out;
  }

  private boardIsFlipped(): boolean {
    if (this.isRemote()) return this.myColor === "black";
    return this.autoFlip && this.game?.turn === "black";
  }

  private castleHighlight(side: string, color: Color): { from: string; to: string } {
    const rank = color === "white" ? "1" : "8";
    return {
      from: `e${rank}`,
      to: side === "king" ? `g${rank}` : `c${rank}`,
    };
  }

  private noteActionHighlight(msg: ActionMsg | null) {
    if (!msg) return;
    switch (msg.type) {
      case "undo":
        this.lastMoves.pop();
        break;
      case "move":
        this.lastMoves.push({ from: msg.from, to: msg.to });
        break;
      case "castle":
        if (this.game) {
          this.lastMoves.push(this.castleHighlight(msg.side, this.game.turn));
        }
        break;
      case "notation":
        // No from/to from the notation API — drop the highlight.
        this.lastMoves = [];
        break;
      default:
        break;
    }
  }

  private clearMoveHighlights() {
    this.lastMoves = [];
  }

  private currentLastMove(): { from: string; to: string } | null {
    if (!this.showLastMove || this.lastMoves.length === 0) return null;
    return this.lastMoves[this.lastMoves.length - 1] ?? null;
  }

  private isNetLive(): boolean {
    return this.netStatus.phase === "connected" && !!this.net?.isConnected();
  }

  private isMyTurn(): boolean {
    if (!this.game || this.game.isOver) return false;
    if (!this.myColor) return true;
    if (!this.isNetLive()) return false;
    return this.game.turn === this.myColor;
  }

  private captureSetup(): GameSetup {
    const fen = this.fenInput.trim();
    if (fen !== "") {
      const check = this.api.ofFen(fen);
      if (!check.ok || !check.game) {
        throw new Error(check.error ?? "Invalid FEN");
      }
      return { kind: "fen", fen };
    }

    if (this.mode === "queer") {
      return { kind: "queer", variant: this.queerVariant };
    }

    if (this.mode === "horde") {
      return { kind: "horde" };
    }

    const trimmed = this.seedInput.trim();
    if (this.mode === "classical" && trimmed === "") {
      return { kind: "classical" };
    }

    const seeded: SeededMode =
      this.mode === "chess960" ? "chess960" : "anarchy";
    if (trimmed === "") {
      const seed = this.previewSeed;
      if (seed == null) {
        throw new Error(
          seeded === "chess960"
            ? "Pick or roll a Chess960 ID first"
            : "Pick or roll an Anarchy seed first",
        );
      }
      if (seeded === "chess960" && !isChess960Id(seed)) {
        throw new Error("Chess960 ID must be an integer from 0 to 959");
      }
      return { kind: seeded, seed };
    }
    const parsed = parseSeededInput(trimmed, seeded);
    if (!parsed.ok) throw new Error(parsed.error);
    return { kind: seeded, seed: parsed.seed };
  }

  private applySetup(setup: GameSetup): EngineResult {
    switch (setup.kind) {
      case "classical":
        return this.api.createClassical();
      case "anarchy":
        return this.api.createAnarchy(setup.seed);
      case "chess960":
        return this.api.createChess960(setup.seed);
      case "queer":
        return this.api.createQueer(setup.variant);
      case "horde":
        return this.api.createHorde();
      case "fen":
        return this.api.ofFen(setup.fen);
    }
  }

  private createSeeded(seed: number, mode: SeededMode = this.mode === "chess960" ? "chess960" : "anarchy"): EngineResult {
    return mode === "chess960"
      ? this.api.createChess960(seed)
      : this.api.createAnarchy(seed);
  }

  private ensureNet(): NetSession {
    if (this.net) return this.net;
    this.net = new NetSession({
      onStatus: (status) => {
        this.netStatus = status;
        if (status.phase === "connected" && status.role === "host" && this.remoteSetup) {
          try {
            if (this.game && this.myColor === "white") {
              this.net?.send({
                type: "sync",
                fen: this.game.fen,
                seed: this.game.seed,
                moveList: this.game.moveList,
              });
              this.error = "";
              this.render();
            } else {
              this.net?.send({ type: "hello", setup: this.remoteSetup });
              this.beginRemoteGame(this.remoteSetup, "white");
            }
          } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
            this.render();
          }
          return;
        }
        this.render();
      },
      onHello: (setup) => {
        // Mid-game rejoins use sync; ignore a stray hello if already playing.
        if (this.game && this.myColor === "black") return;
        try {
          this.reconnecting = false;
          this.beginRemoteGame(setup, "black");
          this.net?.send({ type: "ready" });
        } catch (err) {
          this.error = err instanceof Error ? err.message : String(err);
          this.render();
        }
      },
      onReady: () => {
        /* host already in play */
      },
      onSync: (msg) => this.applySync(msg),
      onAction: (msg) => this.applyRemoteAction(msg),
      onPeerLeft: () => {
        this.clearSelection();
        this.pendingPromo = null;
        if (this.screen === "play" && this.myColor === "white") {
          this.error = "Opponent left — waiting to rejoin";
        }
        this.render();
      },
      onDisconnected: () => {
        const room =
          this.net?.getRoom() ||
          this.remoteJoinCode ||
          roomFromUrl();
        const wasGuest = this.myColor === "black";
        const stayPlay = this.screen === "play" && this.game != null;

        if (wasGuest && room.length >= 4 && stayPlay) {
          void this.rejoinAsGuest(room);
          return;
        }

        this.reconnecting = false;
        this.error = "Opponent disconnected";
        this.teardownRemote(true);
        if (!stayPlay) this.screen = "landing";
        this.render();
      },
    });
    return this.net;
  }

  private beginRemoteGame(setup: GameSetup, color: Color) {
    const result = this.applySetup(setup);
    if (!result.ok || !result.game) {
      this.error = result.error ?? "Could not start remote game";
      this.teardownRemote(true);
      this.screen = "landing";
      this.render();
      return;
    }
    this.remoteSetup = setup;
    this.playMode = playModeFromSetup(setup);
    if (setup.kind === "queer") this.queerVariant = setup.variant;
    this.myColor = color;
    this.reconnecting = false;
    this.clearMoveHighlights();
    this.setGame(result.game);
    this.screen = "play";
    this.error = "";
    this.render();
  }

  private applySync(msg: Extract<NetMsg, { type: "sync" }>) {
    const result = this.api.ofFen(msg.fen);
    if (!result.ok || !result.game) {
      this.error = result.error ?? "Could not sync position";
      this.render();
      return;
    }
    const game: GameSnapshot = {
      ...result.game,
      seed: msg.seed,
      moveList: msg.moveList || result.game.moveList,
    };
    this.myColor = "black";
    this.reconnecting = false;
    this.clearMoveHighlights();
    this.setGame(game);
    this.screen = "play";
    this.error = "";
    this.render();
  }

  private async rejoinAsGuest(room: string) {
    const gen = ++this.rejoinGeneration;
    this.remoteJoinCode = room;
    syncRoomInUrl(room);
    this.reconnecting = true;
    this.error = "Reconnecting…";
    this.render();

    const delays = [400, 800, 1500, 2500, 4000];
    for (let i = 0; i < delays.length; i++) {
      if (gen !== this.rejoinGeneration || this.myColor !== "black") return;
      try {
        await this.ensureNet().joinRoom(room);
        if (gen !== this.rejoinGeneration) return;
        // Connected — wait for sync (or hello) via handlers.
        this.error = "Reconnecting…";
        this.render();
        return;
      } catch {
        if (gen !== this.rejoinGeneration || this.myColor !== "black") return;
        this.error = "Reconnecting…";
        this.render();
        await sleep(delays[i]!);
      }
    }

    if (gen !== this.rejoinGeneration) return;
    this.reconnecting = false;
    this.error = "Could not rejoin — enter the room code again";
    this.teardownRemote(true);
    this.remoteJoinCode = room;
    this.joinOpen = true;
    syncRoomInUrl(room);
    this.screen = this.game ? "play" : "landing";
    this.render();
  }

  private teardownRemote(destroyNet: boolean) {
    this.rejoinGeneration += 1;
    this.reconnecting = false;
    this.myColor = null;
    this.remoteSetup = null;
    if (destroyNet) {
      this.net?.destroy();
      this.net = null;
      this.netStatus = { phase: "idle" };
      syncRoomInUrl(null);
    }
  }

  private sendAction(msg: ActionMsg) {
    if (!this.isRemote() || !this.net || !this.isNetLive()) return;
    try {
      this.net.send(msg);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  private tryLocalAction(result: EngineResult, msg: ActionMsg | null) {
    if (!result.ok || !result.game) {
      this.error = result.error ?? "Something went wrong";
      this.render();
      return;
    }
    this.noteActionHighlight(msg);
    this.setGame(result.game);
    this.screen = "play";
    if (msg) this.sendAction(msg);
    this.render();
  }

  private applyRemoteAction(msg: ActionMsg) {
    if (!this.game) return;
    let result: EngineResult;
    switch (msg.type) {
      case "move":
        result = this.api.applyMove(msg.from, msg.to, msg.promo);
        break;
      case "castle":
        result = this.api.applyCastle(
          msg.side,
          msg.from ?? (this.game.turn === "white" ? "e1" : "e8"),
        );
        break;
      case "notation":
        result = this.api.applyNotation(msg.n);
        break;
      case "undo":
        // Undo is disabled for remote play; ignore stale peers.
        return;
      case "resign":
        result = this.api.resign();
        break;
      case "draw":
        // Draw is always attributed to the side to move. Ignore if the
        // opponent sent it on our clock (would let them accept their own offer).
        if (!this.myColor || this.game.turn === this.myColor) return;
        result = this.api.offerDraw();
        break;
      default:
        return;
    }
    if (!result.ok || !result.game) {
      this.error = result.error ?? "Sync error from opponent";
      this.render();
      return;
    }
    this.noteActionHighlight(msg);
    this.setGame(result.game);
    this.render();
  }

  private async createRemoteRoom() {
    this.error = "";
    this.joinOpen = false;
    try {
      const setup = this.captureSetup();
      this.remoteSetup = setup;
      this.screen = "lobby";
      this.render();
      const room = await this.ensureNet().createRoom();
      syncRoomInUrl(room);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.teardownRemote(true);
      this.screen = "landing";
      this.render();
    }
  }

  private async joinRemoteRoom(rawCode?: string) {
    this.error = "";
    const code = normalizeRoom(rawCode ?? this.remoteJoinCode);
    this.remoteJoinCode = code;
    if (code.length < 4) {
      this.error = "Enter a valid room code";
      this.joinOpen = true;
      this.render();
      return;
    }
    syncRoomInUrl(code);
    this.screen = "lobby";
    this.render();
    try {
      await this.ensureNet().joinRoom(code);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.teardownRemote(true);
      this.screen = "landing";
      this.joinOpen = true;
      this.render();
    }
  }

  private cancelRemote() {
    this.teardownRemote(true);
    this.screen = "landing";
    this.error = "";
    this.joinOpen = false;
    this.refreshPreview(false);
    this.render();
  }

  async boot() {
    this.root.innerHTML = `<div class="loading"><p>Loading YACEWO engine…</p></div>`;
    try {
      this.api = await loadEngine();
      this.bindKeys();
      this.refreshPreview(false);
      const linkRoom = roomFromUrl();
      if (linkRoom.length >= 4) {
        await this.joinRemoteRoom(linkRoom);
        return;
      }
      const linkQueer = queerFromUrl();
      if (linkQueer != null) {
        this.applyQueerFromLink(linkQueer);
      } else if (hordeFromUrl()) {
        this.applyHordeFromLink();
      } else {
        const linkSeed = seedFromUrl();
        if (linkSeed != null) {
          this.applySeedFromLink(linkSeed);
        }
      }
      this.render();
    } catch (e) {
      this.root.innerHTML = `<div class="boot-error"><h1>Could not load engine</h1><p>${
        e instanceof Error ? e.message : String(e)
      }</p></div>`;
    }
  }

  private applyQueerFromLink(variant: QueerVariant) {
    this.mode = "queer";
    this.queerVariant = variant;
    this.seedOpen = false;
    this.fenOpen = false;
    this.error = "";
    this.refreshPreview(false);
    syncQueerInUrl(variant);
  }

  private applyHordeFromLink() {
    this.mode = "horde";
    this.seedOpen = false;
    this.fenOpen = false;
    this.error = "";
    this.refreshPreview(false);
    syncHordeInUrl();
  }

  private applySeedFromLink(seed: number) {
    const mode = seededModeFromUrl();
    // Weird Chess960 URL values wrap like the engine; UI then shows the canonical ID.
    const id = mode === "chess960" ? normalizeChess960Id(seed) : seed;
    this.mode = mode;
    this.seedInput = String(id);
    this.previewSeed = id;
    this.seedOpen = true;
    this.fenOpen = false;
    this.error = "";
    this.refreshPreview(false);
    syncSeedInUrl(id, mode);
  }

  private refreshPreview(animate: boolean) {
    const result =
      this.mode === "classical"
        ? this.api.createClassical()
        : this.mode === "queer"
          ? this.api.createQueer(this.queerVariant)
          : this.mode === "horde"
            ? this.api.createHorde()
            : (() => {
              const seeded: SeededMode = this.mode;
              const trimmed = this.seedInput.trim();
              if (trimmed !== "") {
                const parsed = parseSeededInput(trimmed, seeded);
                if (!parsed.ok) return null;
                return this.createSeeded(parsed.seed, seeded);
              }
              if (this.previewSeed != null) {
                return this.createSeeded(this.previewSeed, seeded);
              }
              return this.createSeeded(-1, seeded);
            })();
    if (!result || !result.ok || !result.game) return;
    this.previewBoard = result.game.board;
    if (isSeededMode(this.mode) && result.game.seed != null) {
      this.previewSeed = result.game.seed;
    }
    this.previewAnim = animate;
  }

  private rollSeed() {
    const seeded: SeededMode =
      this.mode === "chess960" ? "chess960" : "anarchy";
    const result = this.createSeeded(-1, seeded);
    if (!result.ok || !result.game || result.game.seed == null) {
      this.error = result.error ?? "Could not roll seed";
      return;
    }
    this.mode = seeded;
    this.seedInput = String(result.game.seed);
    this.previewSeed = result.game.seed;
    this.previewBoard = result.game.board;
    this.previewAnim = true;
    this.error = "";
    syncSeedInUrl(result.game.seed, seeded);
  }

  private setGame(game: GameSnapshot) {
    this.game = game;
    this.clearSelection();
    this.error = "";
    this.pendingPromo = null;
    if (!this.isRemote()) {
      if (game.seed != null) {
        syncSeedInUrl(
          game.seed,
          this.playMode === "chess960" ? "chess960" : "anarchy",
        );
      } else if (this.playMode === "queer") {
        syncQueerInUrl(this.queerVariant);
      } else if (this.playMode === "horde") {
        syncHordeInUrl();
      } else {
        syncSeedInUrl(null);
      }
    }
  }

  private tryResult(
    result: ReturnType<YacewoApi["createClassical"]>,
    okScreen: Screen = "play",
  ) {
    if (!result.ok || !result.game) {
      this.error = result.error ?? "Something went wrong";
      this.render();
      return;
    }
    this.clearMoveHighlights();
    this.setGame(result.game);
    this.screen = okScreen;
    this.render();
  }

  private legalTargets(from: string): LegalMove[] {
    if (!this.game) return [];
    return this.game.legalMoves.filter(
      (m) => m.kind === "normal" && m.from === from,
    );
  }

  private castlesFrom(from: string): LegalMove[] {
    if (!this.game) return [];
    return this.game.legalMoves.filter(
      (m) => m.kind === "castle" && m.from === from,
    );
  }

  private selectPiece(alg: string) {
    this.selected = alg;
    this.error = "";
    this.queerLegalColor =
      this.playMode === "queer" ? pickQueerLegalColor() : null;
  }

  private clearSelection() {
    this.selected = null;
    this.queerLegalColor = null;
  }

  private onSquareClick(alg: string) {
    if (!this.game || this.game.isOver || !this.isMyTurn()) return;
    const idx = this.game.board.findIndex((_, i) => fileRank(i).alg === alg);
    const piece = idx >= 0 ? this.game.board[idx] : null;

    if (!this.selected) {
      if (piece && piece.color === this.game.turn) {
        this.selectPiece(alg);
        this.render();
      }
      return;
    }

    if (this.selected === alg) {
      this.clearSelection();
      this.render();
      return;
    }

    if (piece && piece.color === this.game.turn) {
      const castles = this.castlesFrom(this.selected);
      const viaRook = castles.find((c) => c.rook !== "" && c.rook === alg);
      if (viaRook) {
        this.attemptMove(this.selected, alg);
        return;
      }
      this.selectPiece(alg);
      this.render();
      return;
    }

    this.attemptMove(this.selected, alg);
  }

  private attemptMove(from: string, to: string) {
    if (!this.game) return;
    const castles = this.castlesFrom(from);
    for (const c of castles) {
      if (to === c.to || (c.rook !== "" && to === c.rook)) {
        this.tryLocalAction(this.api.applyCastle(c.side, from), {
          type: "castle",
          side: c.side,
          from,
        });
        return;
      }
    }

    const targets = this.legalTargets(from).filter((m) => m.to === to);
    if (targets.length === 0) {
      this.error = "Illegal move";
      this.clearSelection();
      this.render();
      return;
    }

    const needsPromo = targets.some((m) => m.promotion);
    if (needsPromo) {
      this.pendingPromo = { from, to };
      this.render();
      return;
    }

    this.tryLocalAction(this.api.applyMove(from, to, null), {
      type: "move",
      from,
      to,
      promo: null,
    });
  }

  private applyPromo(kind: PieceKind) {
    if (!this.pendingPromo) return;
    const { from, to } = this.pendingPromo;
    this.tryLocalAction(this.api.applyMove(from, to, kind), {
      type: "move",
      from,
      to,
      promo: kind,
    });
  }

  private renderTopbar(showBrandLink: boolean) {
    return `
      <header class="topbar">
        ${
          showBrandLink
            ? `<a class="brand-mark" href="#/" data-nav="landing">YACEWO</a>`
            : `<div class="brand-mark">YACEWO</div>`
        }
        <button type="button" class="theme-btn" data-action="theme">${themeLabel(this.theme)}</button>
      </header>
    `;
  }

  private renderPreviewBoard() {
    const anim = this.previewAnim ? " is-settling" : "";
    const plateMod =
      this.mode === "anarchy"
        ? " preview-plate anarchy"
        : this.mode === "chess960"
          ? " preview-plate chess960"
          : this.mode === "queer"
            ? " preview-plate queer"
            : this.mode === "horde"
              ? " preview-plate horde"
              : " preview-plate";
    const squares = this.previewBoard
      .map((piece, i) => {
        const { file, rank } = fileRank(i);
        const light = (file + rank) % 2 === 1;
        const glyph = pieceGlyph(piece);
        const delay = this.previewAnim
          ? ` style="--i:${i};--wave-col:${file - 1}"`
          : ` style="--wave-col:${file - 1}"`;
        return `<div class="sq ${light ? "light" : "dark"}${piece ? " has-piece" : ""}"${delay}>${
          glyph ? `<span class="piece ${piece?.color ?? ""}">${glyph}</span>` : ""
        }</div>`;
      })
      .join("");
    return `
      <div class="landing-preview${anim}">
        <div class="board-plate${plateMod}" aria-hidden="true">
          <div class="board preview-board">${squares}</div>
        </div>
        <div class="mode-toggle" role="tablist" aria-label="Game mode">
          <button type="button" role="tab" class="mode-link${this.mode === "classical" ? " active" : ""}" data-mode="classical" aria-selected="${this.mode === "classical"}">Classical</button>
          <span class="mode-sep" aria-hidden="true">·</span>
          <button type="button" role="tab" class="mode-link${this.mode === "anarchy" ? " active anarchy" : ""}" data-mode="anarchy" aria-selected="${this.mode === "anarchy"}">Anarchy</button>
          <span class="mode-sep" aria-hidden="true">·</span>
          <button type="button" role="tab" class="mode-link${this.mode === "chess960" ? " active chess960" : ""}" data-mode="chess960" aria-selected="${this.mode === "chess960"}">Chess960</button>
          <span class="mode-sep" aria-hidden="true">·</span>
          <button type="button" role="tab" class="mode-link${this.mode === "horde" ? " active horde" : ""}" data-mode="horde" aria-selected="${this.mode === "horde"}">Horde</button>
          ${
            isQueerUnlocked()
              ? `<span class="mode-sep" aria-hidden="true">·</span>
                 <button type="button" role="tab" class="mode-link${this.mode === "queer" ? " active queer" : ""}" data-mode="queer" aria-selected="${this.mode === "queer"}">Queer</button>`
              : ""
          }
        </div>
        ${
          isQueerUnlocked() && this.mode === "queer"
            ? `<div class="queer-variant" role="group" aria-label="Queer variant">
                 <button type="button" class="text-btn queer-link${this.queerVariant === "kings" ? " active" : ""}" data-queer="kings">Kings</button>
                 <span class="mode-sep" aria-hidden="true">·</span>
                 <button type="button" class="text-btn queer-link${this.queerVariant === "queens" ? " active" : ""}" data-queer="queens">Queens</button>
               </div>`
            : ""
        }
      </div>
    `;
  }

  private renderLanding() {
    if (this.previewBoard.length === 0) this.refreshPreview(false);
    return `
      ${this.renderTopbar(false)}
      <main class="landing">
        <div class="landing-wash" aria-hidden="true"></div>
        <div class="landing-frost" aria-hidden="true"></div>
        <section class="landing-hero">
          <h1>(Yet Another) Chess Engine Written in OCaml</h1>
        </section>
        ${this.renderPreviewBoard()}
        <section class="landing-cta">
          <button type="button" class="primary-btn play-btn" data-action="start">Play</button>
          <div class="remote-toggle" role="group" aria-label="Remote play">
            <button type="button" class="text-btn remote-link" data-action="create-room">Create Room</button>
            <span class="mode-sep" aria-hidden="true">·</span>
            <button type="button" class="text-btn remote-link${this.joinOpen ? " active" : ""}" data-action="toggle-join" aria-expanded="${this.joinOpen}">Join Room</button>
          </div>
          ${
            this.joinOpen
              ? `<div class="remote-join">
                  <input id="room" maxlength="8" spellcheck="false" autocomplete="off" placeholder="Room code" value="${escapeAttr(this.remoteJoinCode)}" aria-label="Room code" />
                  <button type="button" class="text-btn" data-action="join-room">Join</button>
                </div>`
              : ""
          }
          <div class="setup-toggle${isSeededMode(this.mode) ? "" : " fen-only"}" role="group" aria-label="Position setup">
            <button type="button" class="text-btn setup-link${this.fenOpen ? " active" : ""}" data-action="toggle-fen" aria-expanded="${this.fenOpen}">FEN</button>
            ${
              this.mode === "anarchy"
                ? `<span class="mode-sep" aria-hidden="true">·</span>
                   <button type="button" class="text-btn setup-link${this.seedOpen ? " active anarchy" : ""}" data-action="toggle-seed" aria-expanded="${this.seedOpen}">Seed</button>`
                : this.mode === "chess960"
                  ? `<span class="mode-sep" aria-hidden="true">·</span>
                     <button type="button" class="text-btn setup-link${this.seedOpen ? " active chess960" : ""}" data-action="toggle-seed" aria-expanded="${this.seedOpen}">ID</button>`
                  : ""
            }
          </div>
          ${
            this.fenOpen
              ? `<div class="fen-panel">
                  <textarea id="fen" rows="2" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" aria-label="FEN">${escapeHtml(this.fenInput)}</textarea>
                  <button type="button" class="text-btn" data-action="load-fen">Load</button>
                </div>`
              : ""
          }
          ${
            isSeededMode(this.mode) && this.seedOpen
              ? `<div class="seed-ritual${this.mode === "chess960" ? " chess960" : ""}">
                  <input id="seed" inputmode="numeric" ${this.mode === "chess960" ? 'min="0" max="959" maxlength="3" ' : ""}placeholder="${this.mode === "chess960" ? "0–959" : "random"}" value="${escapeAttr(this.seedInput)}" aria-label="${this.mode === "chess960" ? "Chess960 ID" : "Seed"}" />
                  <button type="button" class="text-btn seed-roll" data-action="roll-seed" aria-label="Shuffle" title="Shuffle">
                    <svg class="seed-roll-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                      <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M2 4h3.2l5.6 8H14M14 4h-3.2L8.2 7.2M2 12h3.2l1.8-2.4M12.5 2.5 14 4l-1.5 1.5M12.5 10.5 14 12l-1.5 1.5"/>
                    </svg>
                  </button>
                </div>`
              : ""
          }
          ${this.error ? `<div class="error-line">${escapeHtml(this.error)}</div>` : ""}
        </section>
      </main>
    `;
  }

  private renderLobby() {
    const st = this.netStatus;
    const room =
      st.phase === "creating" ||
      st.phase === "waiting" ||
      st.phase === "joining" ||
      st.phase === "connected" ||
      (st.phase === "error" && st.room)
        ? st.room ?? ""
        : "";
    let headline = "Remote";
    let detail = "";
    if (st.phase === "creating") {
      headline = "Creating room…";
      detail = room;
    } else if (st.phase === "waiting") {
      headline = "Waiting for opponent";
      detail = room;
    } else if (st.phase === "joining") {
      headline = "Connecting…";
      detail = room;
    } else if (st.phase === "connected") {
      headline = "Connected";
      detail = room;
    } else if (st.phase === "error") {
      headline = "Could not connect";
      detail = st.message;
    }
    return `
      ${this.renderTopbar(true)}
      <main class="lobby">
        <div class="lobby-wash" aria-hidden="true"></div>
        <section class="lobby-card">
          <p class="lobby-kicker">Remote</p>
          <h1>${escapeHtml(headline)}</h1>
          ${
            room && st.phase !== "error"
              ? `<div class="lobby-code" aria-label="Room code">${escapeHtml(room)}</div>
                 <div class="lobby-actions">
                   <button type="button" class="text-btn" data-action="copy-room-link">${this.copyLabel("room-link", "Copy link")}</button>
                   <button type="button" class="text-btn" data-action="copy-room">${this.copyLabel("room", "Copy code")}</button>
                 </div>
                 <p class="lobby-hint">Share the link to auto-join. Host plays White.${
                   this.remoteSetup?.kind === "fen"
                     ? " Starting from FEN."
                     : this.remoteSetup?.kind === "anarchy"
                       ? ` Anarchy seed ${this.remoteSetup.seed}.`
                       : this.remoteSetup?.kind === "chess960"
                         ? ` Chess960 ID ${this.remoteSetup.seed}.`
                         : this.remoteSetup?.kind === "queer"
                           ? ` ${queerLabel(this.remoteSetup.variant)}.`
                           : this.remoteSetup?.kind === "horde"
                             ? " Horde."
                             : ""
                 }</p>`
              : st.phase === "error"
                ? `<p class="lobby-hint">${escapeHtml(detail)}</p>`
                : ""
          }
          ${this.error ? `<div class="error-line">${escapeHtml(this.error)}</div>` : ""}
          <button type="button" class="text-btn" data-action="cancel-remote">Cancel</button>
        </section>
      </main>
    `;
  }

  private renderBoard() {
    if (!this.game) return "";
    const flipped = this.boardIsFlipped();
    const checkSet = new Set(this.checkSquares());
    const last = this.currentLastMove();
    const legalTo = new Set<string>();
    if (this.selected && this.isMyTurn()) {
      for (const m of this.legalTargets(this.selected)) legalTo.add(m.to);
      for (const c of this.castlesFrom(this.selected)) {
        if (c.to) legalTo.add(c.to);
        if (c.rook) legalTo.add(c.rook);
      }
    }

    const indices = Array.from({ length: 64 }, (_, i) => i);
    if (flipped) indices.reverse();

    const squares = indices
      .map((i) => {
        const piece = this.game!.board[i] ?? null;
        const { file, rank, alg } = fileRank(i);
        const light = (file + rank) % 2 === 1;
        const isLegal = legalTo.has(alg);
        const isLastFrom = !!last && last.from === alg;
        const isLastTo = !!last && last.to === alg;
        const queerBoard = this.playMode === "queer";
        const classes = [
          "sq",
          light ? "light" : "dark",
          this.selected === alg ? "selected" : "",
          checkSet.has(alg) ? "check" : "",
          isLastFrom || isLastTo ? "last-move" : "",
          queerBoard && isLastFrom ? "last-from" : "",
          queerBoard && isLastTo ? "last-to" : "",
          isLegal ? "legal" : "",
          piece ? "has-piece" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const glyph = pieceGlyph(piece);
        const styleParts = [`--wave-col:${file - 1}`];
        if (isLegal && this.queerLegalColor) {
          styleParts.push(`--legal:${this.queerLegalColor}`);
        }
        return `<button type="button" class="${classes}" data-sq="${alg}" aria-label="${alg}" style="${styleParts.join(";")}">${
          glyph
            ? `<span class="piece ${piece?.color ?? ""}">${glyph}</span>`
            : ""
        }</button>`;
      })
      .join("");

    const rankNums = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const fileLetters = flipped
      ? ["h", "g", "f", "e", "d", "c", "b", "a"]
      : ["a", "b", "c", "d", "e", "f", "g", "h"];
    const ranks = rankNums.map((r) => `<span>${r}</span>`).join("");
    const files = fileLetters.map((f) => `<span>${f}</span>`).join("");
    const stageClass = this.showCoords ? "board-stage" : "board-stage no-coords";
    const queer = this.playMode === "queer";

    return `
      <div class="board-plate${queer ? " queer" : ""}">
        <div class="${stageClass}">
          ${this.showCoords ? `<div class="rank-gutter" aria-hidden="true">${ranks}</div>` : ""}
          <div class="board${queer ? " queer-board" : ""}" role="grid" aria-label="Chess board">${squares}</div>
          ${this.showCoords ? `<div></div><div class="file-gutter" aria-hidden="true">${files}</div>` : ""}
        </div>
      </div>
    `;
  }

  private renderPromo() {
    if (!this.pendingPromo) return "";
    const queer = this.playMode === "queer";
    const kinds: PieceKind[] = queer
      ? ["queen", "rook", "bishop", "knight", "king"]
      : ["queen", "rook", "bishop", "knight"];
    return `
      <div class="promo" role="dialog" aria-label="Choose promotion">
        <div class="promo-card${queer ? " queer" : ""}">
          <strong>Promote pawn</strong>
          <div class="promo-row">
            ${kinds
              .map(
                (k) =>
                  `<button type="button" data-promo="${k}" class="${k === "king" ? "promo-royal" : ""}" aria-label="${k}">${PROMO_GLYPH[k]}</button>`,
              )
              .join("")}
          </div>
          <button type="button" class="ghost-btn" data-action="cancel-promo">Cancel</button>
        </div>
      </div>
    `;
  }

  /** Mode-aware help: shared controls plus only the active variant’s rules. */
  private renderHelp(): string {
    const remote = this.isRemote();
    const notation =
      this.playMode === "queer"
        ? "e4, Nf3, O-O, exd5, e8=Q, e8=K"
        : "e4, Nf3, O-O, exd5, e8=Q";
    const items: string[] = [
      "Click a piece, then a highlighted square. Escape clears the selection or closes Help.",
      `Or type notation: ${notation}.`,
      "Last move and Coords can be toggled above the game actions (off by default).",
      "Draw offers; the other side accepts with Draw or declines by moving.",
    ];
    if (remote) {
      items.push("Host is White; moves sync peer-to-peer. Undo is disabled online.");
    } else {
      items.push("Undo takes back the last half-move.");
      items.push("Auto-flip orients the board to the side to move.");
    }

    switch (this.playMode) {
      case "anarchy":
        items.push(
          "Random armies with fixed kings; the seed is in the panel and as a seventh FEN field.",
        );
        items.push("Share as <code>?seed=…</code>.");
        break;
      case "chess960":
        items.push(
          "FIDE / Scharnagl IDs <strong>0–959</strong> (SP-518 = classical). Castling ends on c/g (king) and d/f (rook).",
        );
        items.push(
          "The ID is in the panel and as a seventh FEN field (<code>960</code>). Share as <code>?mode=chess960&amp;seed=…</code>.",
        );
        break;
      case "horde":
        items.push(
          "White has 36 pawns; rank-1 pawns may double-step. Black wins by capturing every White piece.",
        );
        items.push(
          "FEN ends with <code>horde</code>. Share as <code>?mode=horde</code>.",
        );
        break;
      case "queer":
        items.push(
          this.queerVariant === "queens"
            ? "Double Queens (<code>RNBQQBNR</code>): both queens are critical and must stay safe each turn."
            : "Double Kings (<code>RNBKKBNR</code>): both kings are critical and must stay safe each turn.",
        );
        items.push(
          "Pawns may promote to king. Share as <code>?mode=dk</code> or <code>?mode=dq</code>.",
        );
        break;
      default:
        break;
    }

    return `<div class="help">
                  <strong>Help</strong>
                  <ul>
                    ${items.map((li) => `<li>${li}</li>`).join("\n                    ")}
                  </ul>
                </div>`;
  }

  private renderPlay() {
    if (!this.game) return this.renderLanding();
    const g = this.game;
    const metaClass =
      this.playMode === "anarchy"
        ? "status-meta anarchy"
        : this.playMode === "chess960"
          ? "status-meta chess960"
          : this.playMode === "queer"
            ? "status-meta queer"
            : this.playMode === "horde"
              ? "status-meta horde"
              : "status-meta";
    const meta =
      this.playMode === "anarchy"
        ? "Anarchy"
        : this.playMode === "chess960"
          ? "Chess960"
          : this.playMode === "queer"
            ? queerLabel(this.queerVariant)
            : this.playMode === "horde"
              ? "Horde"
              : "Classical";
    const offer = drawOfferText(g);
    const acceptDraw = canAcceptDraw(g, this.myColor);
    const drawLabel = acceptDraw ? "Accept draw" : "Draw";
    const you = this.myColor ? cap(this.myColor) : null;
    const room =
      this.netStatus.phase === "connected" || this.netStatus.phase === "waiting"
        ? this.netStatus.room
        : this.net?.getRoom() || "";
    const inputLocked = !this.isMyTurn();
    const undoLocked = g.isOver || this.isRemote();
    const drawLocked =
      g.isOver || (this.isRemote() && !this.isMyTurn());
    const waitingRejoin =
      this.isRemote() && this.netStatus.phase === "waiting" && this.myColor === "white";
    const bannerSuffix = g.isOver
      ? ""
      : waitingRejoin
        ? " · waiting for rejoin"
        : this.reconnecting
          ? " · reconnecting"
          : inputLocked
            ? " · waiting"
            : "";
    return `
      ${this.renderTopbar(true)}
      <main class="play">
        <section class="board-wrap">
          <div class="status">
            <span class="status-turn">${escapeHtml(statusText(g, this.playMode))}</span>
            <span class="${metaClass}">${escapeHtml(meta)}</span>
          </div>
          ${
            you
              ? `<div class="remote-banner" role="status">You are ${escapeHtml(you)}${
                  room ? ` · ${escapeHtml(room)}` : ""
                }${bannerSuffix}</div>`
              : ""
          }
          ${
            offer
              ? `<div class="draw-offer" role="status">${escapeHtml(offer)}</div>`
              : ""
          }
          ${this.renderBoard()}
          <form class="algebraic" data-form="notation">
            <input name="notation" placeholder="e4 · Nf3 · O-O" autocomplete="off" value="${escapeAttr(this.notation)}" ${
              g.isOver || inputLocked ? "disabled" : ""
            } />
            <button class="primary-btn" type="submit" ${g.isOver || inputLocked ? "disabled" : ""}>Move</button>
          </form>
          <div class="error-line">${escapeHtml(this.error)}</div>
        </section>
        <aside class="panel">
          <h2>Game</h2>
          <div class="panel-section">
            <div class="panel-row">
              <div class="label">Moves</div>
              <button type="button" class="text-btn panel-copy" data-action="copy-moves" ${
                g.moveList ? "" : "disabled"
              }>${this.copyLabel("moves", "Copy")}</button>
            </div>
            <div class="move-list">${escapeHtml(g.moveList || "No moves yet.")}</div>
          </div>
          <div class="panel-section">
            <div class="panel-row">
              <div class="label">FEN</div>
              <button type="button" class="text-btn panel-copy" data-action="copy-fen">${this.copyLabel("fen", "Copy")}</button>
            </div>
            <div class="fen-box">${escapeHtml(g.fen)}</div>
          </div>
          ${
            g.seed != null
              ? `<div class="panel-section">
                   <div class="panel-row">
                     <div class="label">${this.playMode === "chess960" ? "ID" : "Seed"}</div>
                     <button type="button" class="text-btn panel-copy" data-action="copy-seed">${this.copyLabel("seed", "Copy")}</button>
                   </div>
                   <div class="seed-box${this.playMode === "chess960" ? " chess960" : ""}">${g.seed}</div>
                 </div>`
              : ""
          }
          <div class="panel-pref-row">
            <button type="button" class="text-btn panel-pref" data-action="toggle-last-move" aria-pressed="${this.showLastMove}">Last move</button>
            <button type="button" class="text-btn panel-pref" data-action="toggle-coords" aria-pressed="${this.showCoords}">Coords</button>
            ${
              !this.isRemote()
                ? `<button type="button" class="text-btn panel-pref" data-action="toggle-auto-flip" aria-pressed="${this.autoFlip}">Auto-flip</button>`
                : ""
            }
          </div>
          <div class="panel-actions">
            <button type="button" class="action-btn" data-action="undo" ${
              undoLocked ? "disabled" : ""
            }>Undo</button>
            <button type="button" class="action-btn${acceptDraw ? " draw-accept" : ""}" data-action="draw" ${
              drawLocked ? "disabled" : ""
            }>${drawLabel}</button>
            <button type="button" class="action-btn" data-action="resign" ${
              g.isOver || (this.isRemote() && !this.isMyTurn()) ? "disabled" : ""
            }>Resign</button>
            <button type="button" class="action-btn" data-action="help">Help</button>
            <button type="button" class="action-btn" data-action="new">Quit</button>
          </div>
          ${this.helpOpen ? this.renderHelp() : ""}
        </aside>
      </main>
      ${this.renderPromo()}
    `;
  }

  render() {
    this.root.innerHTML =
      this.screen === "landing"
        ? this.renderLanding()
        : this.screen === "lobby"
          ? this.renderLobby()
          : this.renderPlay();
    this.bind();
    if (this.screen === "landing" && this.previewAnim) {
      window.setTimeout(() => {
        this.previewAnim = false;
        this.root.querySelector(".landing-preview")?.classList.remove("is-settling");
      }, 700);
    }
  }

  private patchLandingPreview() {
    const host = this.root.querySelector(".landing-preview");
    if (!host) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = this.renderPreviewBoard().trim();
    const next = tmp.firstElementChild;
    if (next) host.replaceWith(next);
    if (this.previewAnim) {
      window.setTimeout(() => {
        this.previewAnim = false;
        this.root.querySelector(".landing-preview")?.classList.remove("is-settling");
      }, 700);
    }
  }

  private bindPieceWave(board: HTMLElement) {
    board.addEventListener("pointerover", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const sq = t.closest(".sq");
      if (!sq || !board.contains(sq)) return;
      const piece = sq.querySelector(".piece");
      if (!piece) return;
      const color = piece.classList.contains("white")
        ? "white"
        : piece.classList.contains("black")
          ? "black"
          : null;
      if (!color) return;
      const cls = `wave-${color}`;
      if (board.classList.contains(cls)) return;
      board.classList.remove("wave-white", "wave-black");
      void board.offsetWidth;
      board.classList.add(cls);
    });
    board.addEventListener("pointerleave", () => {
      board.classList.remove("wave-white", "wave-black");
    });
  }

  private bind() {
    this.root.querySelector("[data-action='theme']")?.addEventListener("click", () => {
      this.theme = cycleTheme(this.theme);
      storeTheme(this.theme);
      applyTheme(this.theme);
      this.render();
    });

    this.root.querySelector("[data-nav='landing']")?.addEventListener("click", (e) => {
      e.preventDefault();
      this.teardownRemote(true);
      this.screen = "landing";
      this.error = "";
      this.refreshPreview(true);
      this.render();
    });

    this.root.querySelectorAll("[data-mode]").forEach((el) => {
      el.addEventListener("click", () => {
        const raw = (el as HTMLElement).dataset.mode;
        const next: GameMode =
          raw === "anarchy"
            ? "anarchy"
            : raw === "chess960"
              ? "chess960"
              : raw === "queer"
                ? "queer"
                : raw === "horde"
                  ? "horde"
                  : "classical";
        if (next === "queer" && !isQueerUnlocked()) return;
        if (next === this.mode) return;
        this.mode = next;
        this.error = "";
        this.fenOpen = false;
        if (isSeededMode(next)) {
          this.seedOpen = true;
          if (
            next === "chess960" &&
            this.previewSeed != null &&
            !isChess960Id(this.previewSeed)
          ) {
            this.previewSeed = null;
            this.seedInput = "";
          }
        } else {
          this.seedOpen = false;
        }
        if (next === "classical") {
          syncSeedInUrl(null);
        } else if (next === "queer") {
          syncQueerInUrl(this.queerVariant);
        } else if (next === "horde") {
          syncHordeInUrl();
        }
        this.refreshPreview(true);
        if (isSeededMode(next) && this.previewSeed != null) {
          syncSeedInUrl(this.previewSeed, next);
        }
        this.render();
      });
    });

    this.root.querySelectorAll("[data-queer]").forEach((el) => {
      el.addEventListener("click", () => {
        const raw = (el as HTMLElement).dataset.queer;
        const next: QueerVariant = raw === "queens" ? "queens" : "kings";
        if (this.mode !== "queer") this.mode = "queer";
        if (next === this.queerVariant) return;
        this.queerVariant = next;
        this.seedOpen = false;
        this.fenOpen = false;
        this.error = "";
        syncQueerInUrl(next);
        this.refreshPreview(true);
        this.render();
      });
    });

    const seed = this.root.querySelector<HTMLInputElement>("#seed");
    seed?.addEventListener("input", () => {
      this.seedInput = seed.value;
      const trimmed = this.seedInput.trim();
      if (trimmed === "") {
        // Keep held preview seed; don't reshuffle while typing blank.
        this.error = "";
        const err = this.root.querySelector(".landing-cta .error-line");
        if (err) err.textContent = "";
        return;
      }
      const seeded: SeededMode =
        this.mode === "chess960" ? "chess960" : "anarchy";
      const parsed = parseSeededInput(trimmed, seeded);
      if (!parsed.ok) {
        if (seeded === "chess960") {
          this.error = parsed.error;
          let err = this.root.querySelector(".landing-cta .error-line");
          if (!err) {
            const cta = this.root.querySelector(".landing-cta");
            if (cta) {
              err = document.createElement("div");
              err.className = "error-line";
              cta.appendChild(err);
            }
          }
          if (err) err.textContent = parsed.error;
        }
        return;
      }
      this.previewSeed = parsed.seed;
      this.error = "";
      const err = this.root.querySelector(".landing-cta .error-line");
      if (err) err.textContent = "";
      this.mode = seeded;
      syncSeedInUrl(parsed.seed, seeded);
      this.refreshPreview(true);
      this.patchLandingPreview();
    });

    this.root.querySelector("[data-action='roll-seed']")?.addEventListener("click", () => {
      this.rollSeed();
      this.render();
    });

    this.root.querySelector("[data-action='toggle-fen']")?.addEventListener("click", () => {
      this.fenOpen = !this.fenOpen;
      if (this.fenOpen) this.seedOpen = false;
      this.render();
      if (this.fenOpen) {
        this.root.querySelector<HTMLTextAreaElement>("#fen")?.focus();
      }
    });

    this.root.querySelector("[data-action='toggle-seed']")?.addEventListener("click", () => {
      this.seedOpen = !this.seedOpen;
      if (this.seedOpen) {
        this.fenOpen = false;
        if (!isSeededMode(this.mode)) {
          this.mode = "anarchy";
          this.refreshPreview(true);
        }
        if (this.previewSeed != null && isSeededMode(this.mode)) {
          syncSeedInUrl(this.previewSeed, this.mode);
        }
      }
      this.error = "";
      this.render();
      if (this.seedOpen) {
        this.root.querySelector<HTMLInputElement>("#seed")?.focus();
      }
    });

    this.root.querySelector("[data-action='toggle-join']")?.addEventListener("click", () => {
      this.joinOpen = !this.joinOpen;
      this.error = "";
      this.render();
      if (this.joinOpen) {
        this.root.querySelector<HTMLInputElement>("#room")?.focus();
      }
    });

    const roomInput = this.root.querySelector<HTMLInputElement>("#room");
    roomInput?.addEventListener("input", () => {
      this.remoteJoinCode = roomInput.value.toUpperCase();
    });
    roomInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.joinRemoteRoom();
      }
    });

    this.root.querySelector("[data-action='create-room']")?.addEventListener("click", () => {
      void this.createRemoteRoom();
    });
    this.root.querySelector("[data-action='join-room']")?.addEventListener("click", () => {
      void this.joinRemoteRoom();
    });
    this.root.querySelector("[data-action='cancel-remote']")?.addEventListener("click", () => {
      this.cancelRemote();
    });
    this.root.querySelector("[data-action='copy-room']")?.addEventListener("click", async () => {
      const room = this.net?.getRoom() || "";
      if (!room) return;
      await this.copyText(room, "room", "room code");
    });
    this.root.querySelector("[data-action='copy-room-link']")?.addEventListener("click", async () => {
      const room = this.net?.getRoom() || "";
      if (!room) return;
      await this.copyText(roomShareUrl(room), "room-link", "room link");
    });

    const fen = this.root.querySelector<HTMLTextAreaElement>("#fen");
    fen?.addEventListener("input", () => {
      this.fenInput = fen.value;
    });

    this.root.querySelector("[data-action='start']")?.addEventListener("click", () => {
      this.error = "";
      if (this.mode === "classical") {
        this.playMode = "classical";
        this.tryResult(this.api.createClassical());
      } else if (this.mode === "queer") {
        this.playMode = "queer";
        this.tryResult(this.api.createQueer(this.queerVariant));
      } else if (this.mode === "horde") {
        this.playMode = "horde";
        this.tryResult(this.api.createHorde());
      } else {
        const seeded: SeededMode = this.mode;
        this.playMode = seeded;
        const trimmed = this.seedInput.trim();
        if (trimmed === "") {
          const seed = this.previewSeed ?? -1;
          if (seeded === "chess960" && seed >= 0 && !isChess960Id(seed)) {
            this.error = "Chess960 ID must be an integer from 0 to 959";
            this.render();
            return;
          }
          this.tryResult(this.createSeeded(seed, seeded));
        } else {
          const parsed = parseSeededInput(trimmed, seeded);
          if (!parsed.ok) {
            this.error = parsed.error;
            this.render();
            return;
          }
          this.tryResult(this.createSeeded(parsed.seed, seeded));
        }
      }
    });

    this.root.querySelector("[data-action='load-fen']")?.addEventListener("click", () => {
      this.error = "";
      const fen = this.fenInput.trim();
      const result = this.api.ofFen(fen);
      const queer = queerVariantFromFen(fen);
      if (queer) {
        this.playMode = "queer";
        this.queerVariant = queer;
      } else if (fen.includes("horde")) {
        this.playMode = "horde";
      } else if (result.ok && result.game?.seed != null) {
        this.playMode = fen.includes("960") ? "chess960" : "anarchy";
      } else {
        this.playMode = "classical";
      }
      this.tryResult(result);
    });

    this.root.querySelectorAll("[data-sq]").forEach((el) => {
      el.addEventListener("click", () => {
        const alg = (el as HTMLElement).dataset.sq;
        if (alg) this.onSquareClick(alg);
      });
    });

    const preview = this.root.querySelector<HTMLElement>(".preview-board");
    if (preview) this.bindPieceWave(preview);

    const form = this.root.querySelector<HTMLFormElement>("[data-form='notation']");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!this.isMyTurn()) return;
      const input = form.elements.namedItem("notation") as HTMLInputElement;
      this.notation = input.value;
      const trimmed = this.notation.trim();
      const result = this.api.applyNotation(trimmed);
      if (!result.ok || !result.game) {
        this.error = result.error ?? "Illegal move";
        this.render();
        return;
      }
      this.setGame(result.game);
      this.clearMoveHighlights();
      this.notation = "";
      this.sendAction({ type: "notation", n: trimmed });
      this.render();
    });

    this.root.querySelector("[data-action='undo']")?.addEventListener("click", () => {
      if (this.isRemote()) return;
      this.tryLocalAction(this.api.undo(), { type: "undo" });
    });
    this.root.querySelector("[data-action='resign']")?.addEventListener("click", () => {
      if (this.isRemote() && !this.isMyTurn()) return;
      this.tryLocalAction(this.api.resign(), { type: "resign" });
    });
    this.root.querySelector("[data-action='draw']")?.addEventListener("click", () => {
      // Offer and accept both happen on your own turn (accept after opponent offered).
      if (this.isRemote() && !this.isMyTurn()) return;
      this.tryLocalAction(this.api.offerDraw(), { type: "draw" });
    });
    this.root.querySelector("[data-action='help']")?.addEventListener("click", () => {
      this.helpOpen = !this.helpOpen;
      this.render();
    });
    this.root.querySelector("[data-action='toggle-last-move']")?.addEventListener("click", () => {
      this.showLastMove = !this.showLastMove;
      this.render();
    });
    this.root.querySelector("[data-action='toggle-coords']")?.addEventListener("click", () => {
      this.showCoords = !this.showCoords;
      this.render();
    });
    this.root.querySelector("[data-action='toggle-auto-flip']")?.addEventListener("click", () => {
      if (this.isRemote()) return;
      this.autoFlip = !this.autoFlip;
      this.render();
    });
    this.root.querySelector("[data-action='new']")?.addEventListener("click", () => {
      this.teardownRemote(true);
      this.screen = "landing";
      this.error = "";
      this.helpOpen = false;
      this.refreshPreview(true);
      this.render();
    });
    this.root.querySelector("[data-action='copy-fen']")?.addEventListener("click", async () => {
      if (!this.game) return;
      await this.copyText(this.game.fen, "fen", "FEN");
    });
    this.root.querySelector("[data-action='copy-moves']")?.addEventListener("click", async () => {
      if (!this.game?.moveList) return;
      await this.copyText(this.game.moveList, "moves", "moves");
    });
    this.root.querySelector("[data-action='copy-seed']")?.addEventListener("click", async () => {
      if (this.game?.seed == null) return;
      await this.copyText(String(this.game.seed), "seed", "seed");
    });
    this.root.querySelector("[data-action='cancel-promo']")?.addEventListener("click", () => {
      this.pendingPromo = null;
      this.clearSelection();
      this.render();
    });
    this.root.querySelectorAll("[data-promo]").forEach((el) => {
      el.addEventListener("click", () => {
        const kind = (el as HTMLElement).dataset.promo as PieceKind;
        this.applyPromo(kind);
      });
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

const appEl = document.querySelector<HTMLElement>("#app");
if (appEl) {
  const app = new App(appEl);
  void app.boot();
}
