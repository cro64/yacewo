/** Alphabet without 0/O/1/I to keep room codes easy to read aloud. */
const ROOM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export type QueerVariant = "kings" | "queens";

export type GameSetup =
  | { kind: "classical" }
  | { kind: "anarchy"; seed: number }
  | { kind: "chess960"; seed: number }
  | { kind: "queer"; variant: QueerVariant }
  | { kind: "horde" }
  | { kind: "fen"; fen: string };

// `state` is a lightweight fen/moveList snapshot piggybacked onto every
// action so relays (e.g. the Cloudflare Worker/DO transport) can stay
// current for reconnect-sync without running move validation themselves.
// Receiving clients ignore it — they already recompute via api.applyMove().
type ActionState = { fen: string; moveList: string };

export type NetMsg =
  | { type: "hello"; setup: GameSetup }
  | { type: "ready" }
  | {
      type: "sync";
      fen: string;
      seed: number | null;
      moveList: string;
      role?: NetRole;
    }
  | { type: "move"; from: string; to: string; promo: string | null; state?: ActionState }
  | { type: "castle"; side: string; from?: string; state?: ActionState }
  | { type: "notation"; n: string; state?: ActionState }
  | { type: "undo"; state?: ActionState }
  | { type: "resign"; state?: ActionState }
  | { type: "draw"; state?: ActionState };

export type NetRole = "host" | "guest";

export type NetStatus =
  | { phase: "idle" }
  | { phase: "creating"; room: string }
  | { phase: "waiting"; room: string }
  | { phase: "joining"; room: string }
  | { phase: "connected"; room: string; role: NetRole }
  | { phase: "error"; message: string; room?: string };

export type NetHandlers = {
  onStatus: (status: NetStatus) => void;
  onHello: (setup: GameSetup) => void;
  onReady: () => void;
  onSync: (msg: Extract<NetMsg, { type: "sync" }>) => void;
  onAction: (
    msg: Exclude<
      NetMsg,
      { type: "hello" } | { type: "ready" } | { type: "sync" }
    >,
  ) => void;
  /** Own socket failed after retries — tear down / retry at the app layer. */
  onDisconnected: () => void;
  /** Opponent left the room; DO still holds state for rejoin. */
  onPeerLeft: () => void;
  /** Opponent (re)joined while we were waiting. */
  onPeerJoined?: () => void;
  /** Transport is retrying after a drop. */
  onReconnecting?: () => void;
};

function randomRoomCode(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ROOM_ALPHABET[bytes[i]! % ROOM_ALPHABET.length];
  }
  return out;
}

function normalizeRoom(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "");
}

function roomsBaseUrl(): string {
  const raw = import.meta.env.VITE_YACEWO_ROOMS_URL as string | undefined;
  if (!raw || !raw.trim()) {
    throw new Error(
      "Remote rooms need VITE_YACEWO_ROOMS_URL (deploy yacewo-worker, then set the Worker URL)",
    );
  }
  return raw.trim().replace(/\/$/, "");
}

function tokenKey(room: string): string {
  return `yacewo-token-${room}`;
}

function roomToken(room: string): string {
  const key = tokenKey(room);
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}

function wsUrl(room: string, token: string): string {
  let base = roomsBaseUrl();
  if (/^https:/i.test(base)) base = base.replace(/^https:/i, "wss:");
  else if (/^http:/i.test(base)) base = base.replace(/^http:/i, "ws:");
  return `${base}/room/${encodeURIComponent(room)}?token=${encodeURIComponent(token)}`;
}

const RECONNECT_DELAYS_MS = [400, 800, 1500, 2500, 4000, 6000];

export class NetSession {
  private ws: WebSocket | null = null;
  private role: NetRole | null = null;
  private room = "";
  private disposed = false;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private handlers: NetHandlers;
  /** True once the opponent has joined at least once this session. */
  private sawPeer = false;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  getRoom(): string {
    return this.room;
  }

  getRole(): NetRole | null {
    return this.role;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async createRoom(): Promise<string> {
    this.teardownSocket(true);
    this.disposed = false;
    this.intentionalClose = false;
    this.sawPeer = false;
    this.reconnectAttempt = 0;

    roomsBaseUrl(); // fail fast if unset

    const room = randomRoomCode();
    this.room = room;
    this.role = "host";
    this.handlers.onStatus({ phase: "creating", room });

    try {
      await this.openSocket(room);
      this.handlers.onStatus({ phase: "waiting", room });
      return room;
    } catch (err) {
      this.teardownSocket(true);
      const message =
        err instanceof Error ? err.message : "Could not create room";
      this.handlers.onStatus({ phase: "error", message, room });
      throw err;
    }
  }

  async joinRoom(rawRoom: string): Promise<void> {
    const room = normalizeRoom(rawRoom);
    if (room.length < 4) {
      const message = "Enter a valid room code";
      this.handlers.onStatus({ phase: "error", message });
      throw new Error(message);
    }

    this.teardownSocket(true);
    this.disposed = false;
    this.intentionalClose = false;
    this.sawPeer = false;
    this.reconnectAttempt = 0;
    // Role comes from the DO (token identity) — a refreshing host rejoins via ?room=.
    this.role = null;
    this.room = room;
    this.handlers.onStatus({ phase: "joining", room });

    try {
      await this.openSocket(room);
      // Stay joining until peer_joined or sync/hello advances UI; if the
      // host is already waiting we get peer_joined immediately.
      if (!this.sawPeer) {
        this.handlers.onStatus({ phase: "joining", room });
      }
    } catch (err) {
      this.teardownSocket(true);
      const message =
        err instanceof Error ? err.message : "Could not join room";
      this.handlers.onStatus({ phase: "error", message, room });
      throw err;
    }
  }

  send(msg: NetMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  destroy(): void {
    this.disposed = true;
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.teardownSocket(true);
    this.handlers.onStatus({ phase: "idle" });
  }

  private openSocket(room: string): Promise<void> {
    const token = roomToken(room);
    const url = wsUrl(room, token);

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;

      const finishOk = () => {
        if (settled) return;
        settled = true;
        this.reconnectAttempt = 0;
        resolve();
      };
      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      ws.addEventListener("open", () => finishOk());

      ws.addEventListener("message", (event) => {
        this.handleRaw(String(event.data));
      });

      ws.addEventListener("close", () => {
        if (this.ws === ws) this.ws = null;
        if (this.disposed || this.intentionalClose) return;
        if (!settled) {
          finishErr(new Error("Connection closed before open"));
          return;
        }
        this.scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        if (!settled) {
          finishErr(new Error("WebSocket connection failed"));
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.intentionalClose || !this.room) return;
    this.clearReconnectTimer();

    const delay =
      RECONNECT_DELAYS_MS[
        Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
      ]!;
    this.reconnectAttempt += 1;
    this.handlers.onReconnecting?.();

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.intentionalClose || !this.room) return;
      void this.openSocket(this.room).catch(() => {
        if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
          this.handlers.onDisconnected();
          return;
        }
        this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private markConnected(): void {
    if (!this.role || !this.room) return;
    this.handlers.onStatus({
      phase: "connected",
      room: this.room,
      role: this.role,
    });
  }

  private handleRaw(raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;

    if (msg.type === "status") {
      const role = parseRole(msg.role);
      if (role) this.role = role;
      if (msg.phase === "waiting" && this.role && this.room) {
        // Host stays in lobby; guest stays joining until peer_joined.
        if (this.role === "host" && !this.sawPeer) {
          this.handlers.onStatus({ phase: "waiting", room: this.room });
        }
      }
      return;
    }

    if (msg.type === "peer_joined") {
      this.sawPeer = true;
      this.markConnected();
      this.handlers.onPeerJoined?.();
      return;
    }

    if (msg.type === "peer_left") {
      this.sawPeer = false;
      if (this.role && this.room) {
        this.handlers.onStatus({ phase: "waiting", room: this.room });
      }
      this.handlers.onPeerLeft();
      return;
    }

    const netMsg = parseMsg(msg);
    if (!netMsg) return;

    if (netMsg.type === "sync") {
      if (netMsg.role) this.role = netMsg.role;
      this.sawPeer = true;
      this.markConnected();
      this.handlers.onSync(netMsg);
      return;
    }
    if (netMsg.type === "hello") {
      this.sawPeer = true;
      this.markConnected();
      this.handlers.onHello(netMsg.setup);
      return;
    }
    if (netMsg.type === "ready") {
      this.handlers.onReady();
      return;
    }
    this.handlers.onAction(netMsg);
  }

  private teardownSocket(clearRoom: boolean): void {
    this.clearReconnectTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    if (clearRoom) {
      this.role = null;
      this.room = "";
      this.sawPeer = false;
    }
  }
}

function parseRole(raw: unknown): NetRole | null {
  return raw === "host" || raw === "guest" ? raw : null;
}

function parseMsg(msg: Record<string, unknown>): NetMsg | null {
  switch (msg.type) {
    case "hello": {
      const setup = parseSetup(msg.setup);
      return setup ? { type: "hello", setup } : null;
    }
    case "ready":
      return { type: "ready" };
    case "sync": {
      if (typeof msg.fen !== "string" || !msg.fen.trim()) return null;
      if (typeof msg.moveList !== "string") return null;
      let seed: number | null = null;
      if (msg.seed != null) {
        if (
          typeof msg.seed !== "number" ||
          !Number.isInteger(msg.seed) ||
          msg.seed < 0
        ) {
          return null;
        }
        seed = msg.seed;
      }
      const role = parseRole(msg.role);
      return {
        type: "sync",
        fen: msg.fen.trim(),
        seed,
        moveList: msg.moveList,
        ...(role ? { role } : {}),
      };
    }
    case "move":
      if (typeof msg.from !== "string" || typeof msg.to !== "string") return null;
      return {
        type: "move",
        from: msg.from,
        to: msg.to,
        promo: typeof msg.promo === "string" ? msg.promo : null,
      };
    case "castle":
      if (typeof msg.side !== "string") return null;
      return {
        type: "castle",
        side: msg.side,
        ...(typeof msg.from === "string" ? { from: msg.from } : {}),
      };
    case "notation":
      if (typeof msg.n !== "string") return null;
      return { type: "notation", n: msg.n };
    case "undo":
    case "resign":
    case "draw":
      return { type: msg.type };
    default:
      return null;
  }
}

function parseSetup(raw: unknown): GameSetup | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (s.kind === "classical") return { kind: "classical" };
  if (s.kind === "anarchy" && typeof s.seed === "number" && s.seed >= 0) {
    return { kind: "anarchy", seed: s.seed };
  }
  if (s.kind === "chess960" && typeof s.seed === "number" && Number.isInteger(s.seed)) {
    // Wrap like the engine so a weird handshake value still lands in 0–959.
    const id = ((s.seed % 960) + 960) % 960;
    return { kind: "chess960", seed: id };
  }
  if (s.kind === "queer") {
    if (s.variant === "queens" || s.variant === "dq") {
      return { kind: "queer", variant: "queens" };
    }
    if (
      s.variant === "kings" ||
      s.variant === "dk" ||
      s.variant == null ||
      s.variant === ""
    ) {
      return { kind: "queer", variant: "kings" };
    }
  }
  if (s.kind === "horde") return { kind: "horde" };
  if (s.kind === "fen" && typeof s.fen === "string" && s.fen.trim()) {
    return { kind: "fen", fen: s.fen.trim() };
  }
  return null;
}

export { normalizeRoom };
