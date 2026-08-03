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
type ActionMsg = Exclude<NetMsg, { type: "hello" } | { type: "ready" }>;

const PIECES: Record<string, string> = {
  // Use filled (black-series) glyphs for both colors; paint with CSS.
  // Outline-style white Unicode pieces often render with a muddy halo.
  "white-king": "♚",
  "white-queen": "♛",
  "white-rook": "♜",
  "white-bishop": "♝",
  "white-knight": "♞",
  "white-pawn": "♟",
  "black-king": "♚",
  "black-queen": "♛",
  "black-rook": "♜",
  "black-bishop": "♝",
  "black-knight": "♞",
  "black-pawn": "♟",
};

const PROMO_GLYPH: Record<string, string> = {
  queen: "♛",
  rook: "♜",
  bishop: "♝",
  knight: "♞",
};

function fileRank(i: number): { file: number; rank: number; alg: string } {
  const file = (i % 8) + 1;
  const rank = 8 - Math.floor(i / 8);
  const alg = `${String.fromCharCode(96 + file)}${rank}`;
  return { file, rank, alg };
}

function statusText(game: GameSnapshot): string {
  const st = game.status;
  switch (st.tag) {
    case "in_progress":
      return `${cap(game.turn)} to move`;
    case "check":
      return `${cap(st.color ?? game.turn)} in check — ${cap(game.turn)} to move`;
    case "checkmate":
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

function canAcceptDraw(game: GameSnapshot): boolean {
  if (game.isOver) return false;
  return game.turn === "white" ? game.blackDrawOffer : game.whiteDrawOffer;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function pieceGlyph(p: Piece | null): string {
  if (!p) return "";
  return PIECES[`${p.color}-${p.kind}`] ?? "";
}

class App {
  private api!: YacewoApi;
  private root: HTMLElement;
  private screen: Screen = "landing";
  private theme: ThemeMode = getStoredTheme();
  private game: GameSnapshot | null = null;
  private mode: "classical" | "anarchy" = "classical";
  private seedInput = "";
  private fenInput = "";
  private selected: string | null = null;
  private error = "";
  private helpOpen = false;
  private pendingPromo: { from: string; to: string } | null = null;
  private notation = "";
  /** Landing hero board (non-interactive). */
  private previewBoard: Array<Piece | null> = [];
  /** Held Anarchy seed when the input is blank (WYSIWYG with Play). */
  private anarchyPreviewSeed: number | null = null;
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

  constructor(root: HTMLElement) {
    this.root = root;
    applyTheme(this.theme);
  }

  private isRemote(): boolean {
    return this.myColor != null;
  }

  private isMyTurn(): boolean {
    if (!this.game || this.game.isOver) return false;
    if (!this.myColor) return true;
    return this.game.turn === this.myColor;
  }

  private captureSetup(): GameSetup {
    if (this.mode === "classical") return { kind: "classical" };
    const trimmed = this.seedInput.trim();
    if (trimmed === "") {
      const seed = this.anarchyPreviewSeed;
      if (seed == null) throw new Error("Pick or roll an Anarchy seed first");
      return { kind: "anarchy", seed };
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error("Seed must be a non-negative integer");
    }
    return { kind: "anarchy", seed: n };
  }

  private applySetup(setup: GameSetup): EngineResult {
    switch (setup.kind) {
      case "classical":
        return this.api.createClassical();
      case "anarchy":
        return this.api.createAnarchy(setup.seed);
      case "fen":
        return this.api.ofFen(setup.fen);
    }
  }

  private ensureNet(): NetSession {
    if (this.net) return this.net;
    this.net = new NetSession({
      onStatus: (status) => {
        this.netStatus = status;
        if (status.phase === "connected" && status.role === "host" && this.remoteSetup) {
          try {
            this.net?.send({ type: "hello", setup: this.remoteSetup });
            this.beginRemoteGame(this.remoteSetup, "white");
          } catch (err) {
            this.error = err instanceof Error ? err.message : String(err);
            this.render();
          }
          return;
        }
        this.render();
      },
      onHello: (setup) => {
        try {
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
      onAction: (msg) => this.applyRemoteAction(msg),
      onDisconnected: () => {
        const stayedOnPlay = this.screen === "play" && this.game != null;
        this.error = "Opponent disconnected";
        this.teardownRemote(true);
        if (!stayedOnPlay) this.screen = "landing";
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
    this.myColor = color;
    this.setGame(result.game);
    this.screen = "play";
    this.error = "";
    this.render();
  }

  private teardownRemote(destroyNet: boolean) {
    this.myColor = null;
    this.remoteSetup = null;
    if (destroyNet) {
      this.net?.destroy();
      this.net = null;
      this.netStatus = { phase: "idle" };
    }
  }

  private sendAction(msg: ActionMsg) {
    if (!this.isRemote() || !this.net) return;
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
        result = this.api.applyCastle(msg.side);
        break;
      case "notation":
        result = this.api.applyNotation(msg.n);
        break;
      case "undo":
        result = this.api.undo();
        break;
      case "resign":
        result = this.api.resign();
        break;
      case "draw":
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
      await this.ensureNet().createRoom();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.teardownRemote(true);
      this.screen = "landing";
      this.render();
    }
  }

  private async joinRemoteRoom() {
    this.error = "";
    const code = normalizeRoom(this.remoteJoinCode);
    if (code.length < 4) {
      this.error = "Enter a valid room code";
      this.joinOpen = true;
      this.render();
      return;
    }
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
      this.refreshPreview(false);
      this.render();
    } catch (e) {
      this.root.innerHTML = `<div class="boot-error"><h1>Could not load engine</h1><p>${
        e instanceof Error ? e.message : String(e)
      }</p></div>`;
    }
  }

  private refreshPreview(animate: boolean) {
    const result =
      this.mode === "classical"
        ? this.api.createClassical()
        : (() => {
            const trimmed = this.seedInput.trim();
            if (trimmed !== "") {
              const n = Number(trimmed);
              if (!Number.isInteger(n) || n < 0) return null;
              return this.api.createAnarchy(n);
            }
            if (this.anarchyPreviewSeed != null) {
              return this.api.createAnarchy(this.anarchyPreviewSeed);
            }
            return this.api.createAnarchy(-1);
          })();
    if (!result || !result.ok || !result.game) return;
    this.previewBoard = result.game.board;
    if (this.mode === "anarchy" && result.game.seed != null) {
      this.anarchyPreviewSeed = result.game.seed;
    }
    this.previewAnim = animate;
  }

  private rollAnarchySeed() {
    const result = this.api.createAnarchy(-1);
    if (!result.ok || !result.game || result.game.seed == null) {
      this.error = result.error ?? "Could not roll seed";
      return;
    }
    this.mode = "anarchy";
    this.seedInput = String(result.game.seed);
    this.anarchyPreviewSeed = result.game.seed;
    this.previewBoard = result.game.board;
    this.previewAnim = true;
    this.error = "";
  }

  private setGame(game: GameSnapshot) {
    this.game = game;
    this.selected = null;
    this.error = "";
    this.pendingPromo = null;
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
    const turn = this.game.turn;
    const kingSq = turn === "white" ? "e1" : "e8";
    if (from !== kingSq) return [];
    return this.game.legalMoves.filter((m) => m.kind === "castle");
  }

  private onSquareClick(alg: string) {
    if (!this.game || this.game.isOver || !this.isMyTurn()) return;
    const idx = this.game.board.findIndex((_, i) => fileRank(i).alg === alg);
    const piece = idx >= 0 ? this.game.board[idx] : null;

    if (!this.selected) {
      if (piece && piece.color === this.game.turn) {
        this.selected = alg;
        this.error = "";
        this.render();
      }
      return;
    }

    if (this.selected === alg) {
      this.selected = null;
      this.render();
      return;
    }

    if (piece && piece.color === this.game.turn) {
      this.selected = alg;
      this.render();
      return;
    }

    this.attemptMove(this.selected, alg);
  }

  private attemptMove(from: string, to: string) {
    if (!this.game) return;
    const castles = this.castlesFrom(from);
    for (const c of castles) {
      const kingRank = this.game.turn === "white" ? "1" : "8";
      const dest = c.side === "king" ? `g${kingRank}` : `c${kingRank}`;
      if (to === dest) {
        this.tryLocalAction(this.api.applyCastle(c.side), {
          type: "castle",
          side: c.side,
        });
        return;
      }
    }

    const targets = this.legalTargets(from).filter((m) => m.to === to);
    if (targets.length === 0) {
      this.error = "Illegal move";
      this.selected = null;
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
    const plateMod = this.mode === "anarchy" ? " preview-plate anarchy" : " preview-plate";
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
        </div>
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
          <div class="setup-toggle" role="group" aria-label="Position setup">
            <button type="button" class="text-btn setup-link${this.fenOpen ? " active" : ""}" data-action="toggle-fen" aria-expanded="${this.fenOpen}">FEN</button>
            <span class="mode-sep" aria-hidden="true">·</span>
            <button type="button" class="text-btn setup-link${this.seedOpen ? " active anarchy" : ""}" data-action="toggle-seed" aria-expanded="${this.seedOpen}">Seed</button>
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
            this.seedOpen
              ? `<div class="seed-ritual">
                  <input id="seed" inputmode="numeric" placeholder="random" value="${escapeAttr(this.seedInput)}" aria-label="Seed" />
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
                   <button type="button" class="text-btn" data-action="copy-room">Copy code</button>
                 </div>
                 <p class="lobby-hint">Share this code. Host plays White.</p>`
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
    const flipped = this.myColor === "black";
    const legalTo = new Set<string>();
    if (this.selected && this.isMyTurn()) {
      for (const m of this.legalTargets(this.selected)) legalTo.add(m.to);
      for (const c of this.castlesFrom(this.selected)) {
        const kingRank = this.game.turn === "white" ? "1" : "8";
        legalTo.add(c.side === "king" ? `g${kingRank}` : `c${kingRank}`);
      }
    }

    const indices = Array.from({ length: 64 }, (_, i) => i);
    if (flipped) indices.reverse();

    const squares = indices
      .map((i) => {
        const piece = this.game!.board[i] ?? null;
        const { file, rank, alg } = fileRank(i);
        const light = (file + rank) % 2 === 1;
        const classes = [
          "sq",
          light ? "light" : "dark",
          this.selected === alg ? "selected" : "",
          legalTo.has(alg) ? "legal" : "",
          piece ? "has-piece" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const glyph = pieceGlyph(piece);
        return `<button type="button" class="${classes}" data-sq="${alg}" aria-label="${alg}" style="--wave-col:${file - 1}">${
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

    return `
      <div class="board-plate">
        <div class="board-stage">
          <div class="rank-gutter" aria-hidden="true">${ranks}</div>
          <div class="board" role="grid" aria-label="Chess board">${squares}</div>
          <div></div>
          <div class="file-gutter" aria-hidden="true">${files}</div>
        </div>
      </div>
    `;
  }

  private renderPromo() {
    if (!this.pendingPromo) return "";
    return `
      <div class="promo" role="dialog" aria-label="Choose promotion">
        <div class="promo-card">
          <strong>Promote pawn</strong>
          <div class="promo-row">
            ${(["queen", "rook", "bishop", "knight"] as PieceKind[])
              .map(
                (k) =>
                  `<button type="button" data-promo="${k}" aria-label="${k}">${PROMO_GLYPH[k]}</button>`,
              )
              .join("")}
          </div>
          <button type="button" class="ghost-btn" data-action="cancel-promo">Cancel</button>
        </div>
      </div>
    `;
  }

  private renderPlay() {
    if (!this.game) return this.renderLanding();
    const g = this.game;
    const metaClass = g.seed != null ? "status-meta anarchy" : "status-meta";
    const meta = g.seed != null ? "Anarchy" : "Classical";
    const offer = drawOfferText(g);
    const drawLabel = canAcceptDraw(g) ? "Accept draw" : "Draw";
    const you = this.myColor ? cap(this.myColor) : null;
    const room =
      this.netStatus.phase === "connected" || this.netStatus.phase === "waiting"
        ? this.netStatus.room
        : this.net?.getRoom() || "";
    const inputLocked = !this.isMyTurn();
    return `
      ${this.renderTopbar(true)}
      <main class="play">
        <section class="board-wrap">
          <div class="status">
            <span class="status-turn">${escapeHtml(statusText(g))}</span>
            <span class="${metaClass}">${escapeHtml(meta)}</span>
          </div>
          ${
            you
              ? `<div class="remote-banner" role="status">You are ${escapeHtml(you)}${
                  room ? ` · ${escapeHtml(room)}` : ""
                }${inputLocked && !g.isOver ? " · waiting" : ""}</div>`
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
            <div class="label">Moves</div>
            <div class="move-list">${escapeHtml(g.moveList || "No moves yet.")}</div>
          </div>
          <div class="panel-section">
            <div class="label">FEN</div>
            <div class="fen-box">${escapeHtml(g.fen)}</div>
            <div class="actions">
              <button type="button" class="action-btn" data-action="copy-fen">Copy FEN</button>
            </div>
          </div>
          ${
            g.seed != null
              ? `<div class="panel-section"><div class="label">Seed</div><div class="seed-box">${g.seed}</div></div>`
              : ""
          }
          <div class="actions">
            <button type="button" class="action-btn" data-action="undo" ${g.isOver ? "disabled" : ""}>Undo</button>
            <button type="button" class="action-btn${canAcceptDraw(g) ? " draw-accept" : ""}" data-action="draw" ${
              g.isOver || (this.isRemote() && !this.isMyTurn() && !canAcceptDraw(g)) ? "disabled" : ""
            }>${drawLabel}</button>
            <button type="button" class="action-btn" data-action="resign" ${
              g.isOver || (this.isRemote() && !this.isMyTurn()) ? "disabled" : ""
            }>Resign</button>
            <button type="button" class="action-btn" data-action="help">Help</button>
            <button type="button" class="action-btn" data-action="new">New game</button>
          </div>
          ${
            this.helpOpen
              ? `<div class="help">
                  <strong>Help</strong>
                  <ul>
                    <li>Click a piece, then a highlighted square.</li>
                    <li>Or type notation: e4, Nf3, O-O, exd5, e8=Q.</li>
                    <li>Undo takes back the last half-move.</li>
                    <li>Draw offers; the other side accepts with Draw or declines by moving.</li>
                    <li>FEN can include an optional Anarchy seed as a 7th field.</li>
                    <li>Remote: Create or Join a room. Host is White; moves sync over peer-to-peer.</li>
                  </ul>
                </div>`
              : ""
          }
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
        const next =
          (el as HTMLElement).dataset.mode === "anarchy" ? "anarchy" : "classical";
        if (next === this.mode) return;
        this.mode = next;
        this.error = "";
        if (next === "classical") this.seedOpen = false;
        if (next === "anarchy") this.seedOpen = true;
        this.fenOpen = false;
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
        return;
      }
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0) return;
      this.anarchyPreviewSeed = n;
      this.refreshPreview(true);
      this.patchLandingPreview();
    });

    this.root.querySelector("[data-action='roll-seed']")?.addEventListener("click", () => {
      this.rollAnarchySeed();
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
        if (this.mode !== "anarchy") {
          this.mode = "anarchy";
          this.refreshPreview(true);
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
      try {
        await navigator.clipboard.writeText(room);
      } catch {
        this.error = "Could not copy room code";
        this.render();
      }
    });

    const fen = this.root.querySelector<HTMLTextAreaElement>("#fen");
    fen?.addEventListener("input", () => {
      this.fenInput = fen.value;
    });

    this.root.querySelector("[data-action='start']")?.addEventListener("click", () => {
      this.error = "";
      if (this.mode === "classical") {
        this.tryResult(this.api.createClassical());
      } else {
        const trimmed = this.seedInput.trim();
        if (trimmed === "") {
          const seed = this.anarchyPreviewSeed ?? -1;
          this.tryResult(this.api.createAnarchy(seed));
        } else {
          const n = Number(trimmed);
          if (!Number.isInteger(n) || n < 0) {
            this.error = "Seed must be a non-negative integer";
            this.render();
            return;
          }
          this.tryResult(this.api.createAnarchy(n));
        }
      }
    });

    this.root.querySelector("[data-action='load-fen']")?.addEventListener("click", () => {
      this.error = "";
      this.tryResult(this.api.ofFen(this.fenInput.trim()));
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
      this.notation = "";
      this.sendAction({ type: "notation", n: trimmed });
      this.render();
    });

    this.root.querySelector("[data-action='undo']")?.addEventListener("click", () => {
      this.tryLocalAction(this.api.undo(), { type: "undo" });
    });
    this.root.querySelector("[data-action='resign']")?.addEventListener("click", () => {
      if (this.isRemote() && !this.isMyTurn()) return;
      this.tryLocalAction(this.api.resign(), { type: "resign" });
    });
    this.root.querySelector("[data-action='draw']")?.addEventListener("click", () => {
      if (this.isRemote() && !this.isMyTurn() && !(this.game && canAcceptDraw(this.game))) {
        return;
      }
      this.tryLocalAction(this.api.offerDraw(), { type: "draw" });
    });
    this.root.querySelector("[data-action='help']")?.addEventListener("click", () => {
      this.helpOpen = !this.helpOpen;
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
      try {
        await navigator.clipboard.writeText(this.game.fen);
      } catch {
        this.error = "Could not copy FEN";
        this.render();
      }
    });
    this.root.querySelector("[data-action='cancel-promo']")?.addEventListener("click", () => {
      this.pendingPromo = null;
      this.selected = null;
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
