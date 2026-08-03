import "./styles.css";
import {
  loadEngine,
  unwrap,
  type GameSnapshot,
  type LegalMove,
  type Piece,
  type PieceKind,
  type YacewoApi,
} from "./engine";
import {
  applyTheme,
  cycleTheme,
  getStoredTheme,
  storeTheme,
  themeLabel,
  type ThemeMode,
} from "./theme";

type Screen = "landing" | "play";

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

  constructor(root: HTMLElement) {
    this.root = root;
    applyTheme(this.theme);
  }

  async boot() {
    this.root.innerHTML = `<div class="loading"><p>Loading YACEWO engine…</p></div>`;
    try {
      this.api = await loadEngine();
      this.render();
    } catch (e) {
      this.root.innerHTML = `<div class="boot-error"><h1>Could not load engine</h1><p>${
        e instanceof Error ? e.message : String(e)
      }</p></div>`;
    }
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
    if (!this.game || this.game.isOver) return;
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
        this.tryResult(this.api.applyCastle(c.side));
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
    if (needsPromo && !targets.every((m) => m.promotion === "queen")) {
      // show chooser when any promotion variant exists
    }
    if (needsPromo) {
      this.pendingPromo = { from, to };
      this.render();
      return;
    }

    this.tryResult(this.api.applyMove(from, to, null));
  }

  private applyPromo(kind: PieceKind) {
    if (!this.pendingPromo) return;
    const { from, to } = this.pendingPromo;
    this.tryResult(this.api.applyMove(from, to, kind));
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

  private renderLanding() {
    return `
      ${this.renderTopbar(false)}
      <main class="landing">
        <section class="landing-hero">
          <h1>YACEWO</h1>
          <p>(Yet) Another Chess Engine Written in OCaml</p>
        </section>
        <section class="mode-select">
          <div class="mode-row">
            <button type="button" class="mode-btn ${this.mode === "classical" ? "active" : ""}" data-mode="classical">
              <span class="mode-name">Classical</span>
              <span class="mode-hint">Standard starting armies</span>
            </button>
            <button type="button" class="mode-btn ${this.mode === "anarchy" ? "active" : ""}" data-mode="anarchy">
              <span class="mode-name">Anarchy</span>
              <span class="mode-hint">Seeded random armies</span>
            </button>
          </div>
          ${
            this.mode === "anarchy"
              ? `<div class="field">
                  <label for="seed">Seed (blank = random)</label>
                  <input id="seed" inputmode="numeric" placeholder="42" value="${escapeAttr(this.seedInput)}" />
                </div>`
              : ""
          }
          <button type="button" class="primary-btn" data-action="start">Play</button>
          <div class="divider"><span>or load FEN</span></div>
          <div class="field">
            <label for="fen">FEN</label>
            <textarea id="fen" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1">${escapeHtml(this.fenInput)}</textarea>
            <button type="button" class="ghost-btn" data-action="load-fen">Load FEN</button>
          </div>
          ${this.error ? `<div class="error-line">${escapeHtml(this.error)}</div>` : ""}
        </section>
      </main>
    `;
  }

  private renderBoard() {
    if (!this.game) return "";
    const legalTo = new Set<string>();
    if (this.selected) {
      for (const m of this.legalTargets(this.selected)) legalTo.add(m.to);
      for (const c of this.castlesFrom(this.selected)) {
        const kingRank = this.game.turn === "white" ? "1" : "8";
        legalTo.add(c.side === "king" ? `g${kingRank}` : `c${kingRank}`);
      }
    }

    const squares = this.game.board
      .map((piece, i) => {
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
        return `<button type="button" class="${classes}" data-sq="${alg}" aria-label="${alg}">${
          glyph
            ? `<span class="piece ${piece?.color ?? ""}">${glyph}</span>`
            : ""
        }</button>`;
      })
      .join("");

    const ranks = [8, 7, 6, 5, 4, 3, 2, 1]
      .map((r) => `<span>${r}</span>`)
      .join("");
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"]
      .map((f) => `<span>${f}</span>`)
      .join("");

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
    return `
      ${this.renderTopbar(true)}
      <main class="play">
        <section class="board-wrap">
          <div class="status">
            <span class="status-turn">${escapeHtml(statusText(g))}</span>
            <span class="${metaClass}">${escapeHtml(meta)}</span>
          </div>
          ${
            offer
              ? `<div class="draw-offer" role="status">${escapeHtml(offer)}</div>`
              : ""
          }
          ${this.renderBoard()}
          <form class="algebraic" data-form="notation">
            <input name="notation" placeholder="e4 · Nf3 · O-O" autocomplete="off" value="${escapeAttr(this.notation)}" ${g.isOver ? "disabled" : ""} />
            <button class="primary-btn" type="submit" ${g.isOver ? "disabled" : ""}>Move</button>
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
            <button type="button" class="action-btn${canAcceptDraw(g) ? " draw-accept" : ""}" data-action="draw" ${g.isOver ? "disabled" : ""}>${drawLabel}</button>
            <button type="button" class="action-btn" data-action="resign" ${g.isOver ? "disabled" : ""}>Resign</button>
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
      this.screen === "landing" ? this.renderLanding() : this.renderPlay();
    this.bind();
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
      this.screen = "landing";
      this.error = "";
      this.render();
    });

    this.root.querySelectorAll("[data-mode]").forEach((el) => {
      el.addEventListener("click", () => {
        this.mode = (el as HTMLElement).dataset.mode === "anarchy" ? "anarchy" : "classical";
        this.error = "";
        this.render();
      });
    });

    const seed = this.root.querySelector<HTMLInputElement>("#seed");
    seed?.addEventListener("input", () => {
      this.seedInput = seed.value;
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
        // jsoo methods need an argument; -1 means "pick a random seed" in the bridge.
        if (trimmed === "") {
          this.tryResult(this.api.createAnarchy(-1));
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

    const form = this.root.querySelector<HTMLFormElement>("[data-form='notation']");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.elements.namedItem("notation") as HTMLInputElement;
      this.notation = input.value;
      try {
        const game = unwrap(this.api.applyNotation(this.notation.trim()));
        this.setGame(game);
        this.notation = "";
        this.render();
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        this.render();
      }
    });

    this.root.querySelector("[data-action='undo']")?.addEventListener("click", () => {
      this.tryResult(this.api.undo());
    });
    this.root.querySelector("[data-action='resign']")?.addEventListener("click", () => {
      this.tryResult(this.api.resign());
    });
    this.root.querySelector("[data-action='draw']")?.addEventListener("click", () => {
      this.tryResult(this.api.offerDraw());
    });
    this.root.querySelector("[data-action='help']")?.addEventListener("click", () => {
      this.helpOpen = !this.helpOpen;
      this.render();
    });
    this.root.querySelector("[data-action='new']")?.addEventListener("click", () => {
      this.screen = "landing";
      this.error = "";
      this.helpOpen = false;
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
