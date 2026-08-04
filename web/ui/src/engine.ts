export type Color = "white" | "black";
export type PieceKind =
  | "pawn"
  | "rook"
  | "knight"
  | "bishop"
  | "queen"
  | "king";

export interface Piece {
  kind: PieceKind;
  color: Color;
}

export interface Status {
  tag: string;
  color: Color | null;
}

export interface LegalMove {
  kind: "normal" | "castle";
  side: string;
  from: string;
  to: string;
  /** Rook square for castling (empty for normal moves). */
  rook: string;
  promotion: PieceKind | null;
}

export interface GameSnapshot {
  fen: string;
  moveList: string;
  turn: Color;
  status: Status;
  isOver: boolean;
  seed: number | null;
  whiteDrawOffer: boolean;
  blackDrawOffer: boolean;
  board: Array<Piece | null>;
  legalMoves: LegalMove[];
}

export interface EngineResult {
  ok: boolean;
  error: string | null;
  game: GameSnapshot | null;
}

export interface YacewoApi {
  createClassical: () => EngineResult;
  /** Pass a non-negative seed, or `-1` for a random seed (jsoo requires an arg). */
  createAnarchy: (seed: number) => EngineResult;
  /** Pass a FIDE Chess960 ID 0–959, or `-1` for a random ID (jsoo requires an arg). */
  createChess960: (seed: number) => EngineResult;
  /** Pass `"kings"` / `"queens"` (or `"dk"` / `"dq"`). */
  createQueer: (variant: string) => EngineResult;
  createHorde: () => EngineResult;
  ofFen: (fen: string) => EngineResult;
  applyNotation: (n: string) => EngineResult;
  applyMove: (
    from: string,
    to: string,
    promo: string | null,
  ) => EngineResult;
  applyCastle: (side: string, from: string) => EngineResult;
  undo: () => EngineResult;
  resign: () => EngineResult;
  offerDraw: () => EngineResult;
  getGame: () => GameSnapshot | null;
}

declare global {
  interface Window {
    Yacewo?: YacewoApi;
  }
}

export function loadEngine(): Promise<YacewoApi> {
  if (window.Yacewo) return Promise.resolve(window.Yacewo);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${import.meta.env.BASE_URL}yacewo_engine.js`;
    script.onload = () => {
      if (window.Yacewo) resolve(window.Yacewo);
      else reject(new Error("Yacewo engine failed to export"));
    };
    script.onerror = () => reject(new Error("Failed to load yacewo_engine.js"));
    document.head.appendChild(script);
  });
}

export function unwrap(result: EngineResult): GameSnapshot {
  if (!result.ok || !result.game) {
    throw new Error(result.error ?? "engine error");
  }
  return result.game;
}
