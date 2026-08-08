/** Alphabet without 0/O/1/I to keep room codes easy to read aloud. */
const ROOM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const RECONNECT_DELAYS_MS = [400, 800, 1500, 2500, 4000, 6000];

/** DO closes the prior socket with this when the same token reconnects. */
const WS_CLOSE_REPLACED = 4001;

export type QueerVariant = "kings" | "queens";

export type GameSetup =
  | { kind: "classical" }
  | { kind: "anarchy"; seed: number }
  | { kind: "chess960"; seed: number }
  | { kind: "queer"; variant: QueerVariant }
  | { kind: "horde" }
  | { kind: "fen"; fen: string };

// `state` is a lightweight fen/moveList/highlight snapshot piggybacked onto
// every action so relays (e.g. the Cloudflare Worker/DO transport) can stay
// current for reconnect-sync without running move validation themselves.
// `highlight` is the exact from/to of the move as computed by whoever made
// it — lets reconnecting clients show the real last move instead of guessing.
type MoveHighlight = { from: string; to: string };
type ActionState = { fen: string; moveList: string; highlight: MoveHighlight | null };

export type NetMsg =
  | { type: "hello"; setup: GameSetup }
  | { type: "ready" }
  | {
      type: "sync";
      fen: string;
      seed: number | null;
      moveList: string;
      /** Present on DO catch-up so rejoins restore mode (not only FEN). */
      setup?: GameSetup;
      role?: NetRole;
      lastHighlight?: MoveHighlight | null;
    }
  | { type: "move"; from: string; to: string; promo: string | null; state?: ActionState }
  | { type: "castle"; side: string; from?: string; state?: ActionState }
  | { type: "notation"; n: string; state?: ActionState }
  | { type: "undo"; state?: ActionState }
  | { type: "resign"; state?: ActionState }
  | { type: "draw"; state?: ActionState }
  /** Client → DO only; not relayed. */
  | { type: "push-subscribe"; subscription: PushSubscriptionJSON };

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
      | { type: "hello" }
      | { type: "ready" }
      | { type: "sync" }
      | { type: "push-subscribe" }
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

type ConnectIntent = "create" | "join";

// ── room / URL helpers ─────────────────────────────────────────────

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

function roomToken(room: string): string {
  const key = `yacewo-token-${room}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}

function wsUrl(room: string, token: string, intent: ConnectIntent): string {
  let base = roomsBaseUrl();
  if (/^https:/i.test(base)) base = base.replace(/^https:/i, "wss:");
  else if (/^http:/i.test(base)) base = base.replace(/^http:/i, "ws:");
  return `${base}/room/${encodeURIComponent(room)}?token=${encodeURIComponent(token)}&intent=${intent}`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function safeClose(ws: WebSocket): void {
  try {
    ws.close();
  } catch {
    /* ignore already-closed sockets */
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Server rejectSocket payload — only meaningful during handshake. */
function handshakeError(msg: Record<string, unknown>): string | null {
  if (msg.type !== "error") return null;
  return typeof msg.message === "string" && msg.message.trim()
    ? msg.message.trim()
    : "Connection error";
}

// ── session ────────────────────────────────────────────────────────

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
  /** Reconnects use join — seat is already claimed by token. */
  private intent: ConnectIntent = "join";

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
    roomsBaseUrl(); // fail fast if unset

    const room = randomRoomCode();
    this.beginConnect({ room, role: "host", intent: "create" });
    this.handlers.onStatus({ phase: "creating", room });

    try {
      await this.openSocket(room);
      // Further reconnects are seat reclaims, not new creates.
      this.intent = "join";
      this.handlers.onStatus({ phase: "waiting", room });
      return room;
    } catch (err) {
      this.reportConnectError(err, "Could not create room", room);
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

    // Role comes from the DO (token identity) — a refreshing host rejoins via ?room=.
    this.beginConnect({ room, role: null, intent: "join" });
    this.handlers.onStatus({ phase: "joining", room });

    try {
      await this.openSocket(room);
      this.statusAfterJoin(room);
    } catch (err) {
      this.reportConnectError(err, "Could not join room", room);
      throw err;
    }
  }

  send(msg: NetMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  /** Best-effort: subscribe (or reuse) and tell the DO. Safe to call often. */
  async sendPushSubscription(
    subscription?: PushSubscriptionJSON | null,
  ): Promise<void> {
    try {
      const { subscribeToPush } = await import("./push");
      const sub =
        subscription === undefined ? await subscribeToPush() : subscription;
      if (!sub || !this.isConnected()) return;
      this.send({ type: "push-subscribe", subscription: sub });
    } catch {
      /* push is optional */
    }
  }

  destroy(): void {
    this.disposed = true;
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.teardownSocket(true);
    this.handlers.onStatus({ phase: "idle" });
  }

  // ── connect lifecycle ────────────────────────────────────────────

  private beginConnect(opts: {
    room: string;
    role: NetRole | null;
    intent: ConnectIntent;
  }): void {
    this.teardownSocket(true);
    this.disposed = false;
    this.intentionalClose = false;
    this.sawPeer = false;
    this.reconnectAttempt = 0;
    this.room = opts.room;
    this.role = opts.role;
    this.intent = opts.intent;
  }

  private reportConnectError(
    err: unknown,
    fallback: string,
    room?: string,
  ): void {
    this.teardownSocket(true);
    const message = errorMessage(err, fallback);
    this.handlers.onStatus(
      room != null ? { phase: "error", message, room } : { phase: "error", message },
    );
  }

  /** Host refresh keeps waiting; guests stay joining until peer/sync/hello. */
  private statusAfterJoin(room: string): void {
    if (this.sawPeer) return;
    this.handlers.onStatus({
      phase: this.role === "host" ? "waiting" : "joining",
      room,
    });
  }

  /**
   * Opens the socket and resolves only after the first catch-up message
   * (status/sync/…) so rejectSocket open-then-close is not a false success.
   */
  private openSocket(room: string): Promise<void> {
    const url = wsUrl(room, roomToken(room), this.intent);

    return new Promise((resolve, reject) => {
      let settled = false;
      let sessionOpen = false;
      const ws = new WebSocket(url);
      this.ws = ws;

      const finishOk = () => {
        if (settled) return;
        settled = true;
        sessionOpen = true;
        this.reconnectAttempt = 0;
        // Re-attach push after reconnects when permission is already granted.
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          void this.sendPushSubscription();
        }
        resolve();
      };
      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      ws.addEventListener("message", (event) => {
        const raw = String(event.data);
        if (settled) {
          this.handleRaw(raw);
          return;
        }

        const early = parseJsonObject(raw);
        const rejectMsg = early ? handshakeError(early) : null;
        if (rejectMsg) {
          finishErr(new Error(rejectMsg));
          safeClose(ws);
          return;
        }

        this.handleRaw(raw);
        finishOk();
      });

      ws.addEventListener("close", (event) => {
        if (this.ws === ws) this.ws = null;
        if (!settled) {
          finishErr(
            new Error(event.reason?.trim() || "Connection closed before open"),
          );
          return;
        }
        // Rejected handshakes close after an error message — do not reconnect.
        if (!sessionOpen || this.disposed || this.intentionalClose) return;
        // Another tab/reconnect took this seat — stay down, don't fight.
        if (event.code === WS_CLOSE_REPLACED) {
          this.handlers.onStatus({
            phase: "error",
            message: "Connected in another tab",
            room: this.room || undefined,
          });
          return;
        }
        this.scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        if (!settled) finishErr(new Error("WebSocket connection failed"));
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

  private teardownSocket(clearRoom: boolean): void {
    this.clearReconnectTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) safeClose(ws);
    if (clearRoom) {
      this.role = null;
      this.room = "";
      this.sawPeer = false;
    }
  }

  // ── inbound messages ─────────────────────────────────────────────

  private markConnected(): void {
    if (!this.role || !this.room) return;
    this.handlers.onStatus({
      phase: "connected",
      room: this.room,
      role: this.role,
    });
  }

  private handleRaw(raw: string): void {
    const msg = parseJsonObject(raw);
    if (!msg) return;

    switch (msg.type) {
      case "status": {
        const role = parseRole(msg.role);
        if (role) this.role = role;
        if (
          msg.phase === "waiting" &&
          this.role === "host" &&
          this.room &&
          !this.sawPeer
        ) {
          this.handlers.onStatus({ phase: "waiting", room: this.room });
        }
        return;
      }
      case "peer_joined":
        this.sawPeer = true;
        this.markConnected();
        this.handlers.onPeerJoined?.();
        return;
      case "peer_left":
        this.sawPeer = false;
        if (this.role && this.room) {
          this.handlers.onStatus({ phase: "waiting", room: this.room });
        }
        this.handlers.onPeerLeft();
        return;
    }

    const netMsg = parseMsg(msg);
    if (!netMsg) return;

    switch (netMsg.type) {
      case "sync":
        if (netMsg.role) this.role = netMsg.role;
        this.sawPeer = true;
        this.markConnected();
        this.handlers.onSync(netMsg);
        return;
      case "hello":
        this.sawPeer = true;
        this.markConnected();
        this.handlers.onHello(netMsg.setup);
        return;
      case "ready":
        this.handlers.onReady();
        return;
      case "push-subscribe":
        return;
      default:
        this.handlers.onAction(netMsg);
    }
  }
}

// ── parsers ────────────────────────────────────────────────────────

function parseRole(raw: unknown): NetRole | null {
  return raw === "host" || raw === "guest" ? raw : null;
}

/** undefined = field absent (older peer, don't touch caller default). */
function parseHighlight(raw: unknown): MoveHighlight | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.from === "string" && typeof r.to === "string") {
    return { from: r.from, to: r.to };
  }
  return null;
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
      const setup = msg.setup != null ? parseSetup(msg.setup) : null;
      const lastHighlight = parseHighlight(msg.lastHighlight);
      return {
        type: "sync",
        fen: msg.fen.trim(),
        seed,
        moveList: msg.moveList,
        ...(setup ? { setup } : {}),
        ...(role ? { role } : {}),
        ...(lastHighlight !== undefined ? { lastHighlight } : {}),
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
