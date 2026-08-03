import Peer, { type DataConnection, type PeerError } from "peerjs";

/** Alphabet without 0/O/1/I to keep room codes easy to read aloud. */
const ROOM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export type GameSetup =
  | { kind: "classical" }
  | { kind: "anarchy"; seed: number }
  | { kind: "fen"; fen: string };

export type NetMsg =
  | { type: "hello"; setup: GameSetup }
  | { type: "ready" }
  | { type: "move"; from: string; to: string; promo: string | null }
  | { type: "castle"; side: string }
  | { type: "notation"; n: string }
  | { type: "undo" }
  | { type: "resign" }
  | { type: "draw" };

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
  onAction: (msg: Exclude<NetMsg, { type: "hello" } | { type: "ready" }>) => void;
  onDisconnected: () => void;
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

type AnyPeerError = PeerError<string>;

function isPeerError(err: unknown): err is AnyPeerError {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    typeof (err as { type: unknown }).type === "string"
  );
}

export class NetSession {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private role: NetRole | null = null;
  private room = "";
  private disposed = false;
  private handlers: NetHandlers;

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  getRoom(): string {
    return this.room;
  }

  getRole(): NetRole | null {
    return this.role;
  }

  async createRoom(): Promise<string> {
    this.disposePeer();
    this.disposed = false;
    this.role = "host";

    for (let attempt = 0; attempt < 6; attempt++) {
      const room = randomRoomCode();
      this.room = room;
      this.handlers.onStatus({ phase: "creating", room });

      try {
        await this.openPeer(room);
        this.handlers.onStatus({ phase: "waiting", room });
        this.peer!.on("connection", (conn) => {
          if (this.conn) {
            conn.close();
            return;
          }
          this.attachConnection(conn);
        });
        return room;
      } catch (err) {
        this.disposePeer();
        if (isPeerError(err) && err.type === "unavailable-id") continue;
        const message =
          err instanceof Error ? err.message : "Could not create room";
        this.handlers.onStatus({ phase: "error", message, room });
        throw err;
      }
    }

    const message = "Could not reserve a room code — try again";
    this.handlers.onStatus({ phase: "error", message });
    throw new Error(message);
  }

  async joinRoom(rawRoom: string): Promise<void> {
    const room = normalizeRoom(rawRoom);
    if (room.length < 4) {
      const message = "Enter a valid room code";
      this.handlers.onStatus({ phase: "error", message });
      throw new Error(message);
    }

    this.disposePeer();
    this.disposed = false;
    this.role = "guest";
    this.room = room;
    this.handlers.onStatus({ phase: "joining", room });

    try {
      await this.openPeer();
      const conn = this.peer!.connect(room, { reliable: true });
      this.attachConnection(conn);
      await this.waitOpen(conn);
    } catch (err) {
      this.disposePeer();
      const message =
        err instanceof Error ? err.message : "Could not join room";
      this.handlers.onStatus({ phase: "error", message, room });
      throw err;
    }
  }

  send(msg: NetMsg): void {
    if (!this.conn || !this.conn.open) {
      throw new Error("Not connected");
    }
    this.conn.send(msg);
  }

  destroy(): void {
    this.disposed = true;
    this.disposePeer();
    this.handlers.onStatus({ phase: "idle" });
  }

  private openPeer(id?: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id) : new Peer();
      this.peer = peer;

      const onOpen = () => {
        cleanup();
        resolve(peer);
      };
      const onError = (err: AnyPeerError) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        peer.off("open", onOpen);
        peer.off("error", onError);
      };

      peer.on("open", onOpen);
      peer.on("error", onError);

      peer.on("disconnected", () => {
        if (this.disposed) return;
        try {
          peer.reconnect();
        } catch {
          this.handlers.onDisconnected();
        }
      });
    });
  }

  private waitOpen(conn: DataConnection): Promise<void> {
    if (conn.open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for host"));
      }, 20000);

      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error("Connection failed"));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        conn.off("open", onOpen);
        conn.off("error", onError);
      };

      conn.on("open", onOpen);
      conn.on("error", onError);
    });
  }

  private attachConnection(conn: DataConnection): void {
    this.conn = conn;

    const markConnected = () => {
      if (!this.role) return;
      this.handlers.onStatus({
        phase: "connected",
        room: this.room,
        role: this.role,
      });
    };

    if (conn.open) markConnected();
    else conn.on("open", markConnected);

    conn.on("data", (raw) => {
      const msg = parseMsg(raw);
      if (!msg) return;
      if (msg.type === "hello") this.handlers.onHello(msg.setup);
      else if (msg.type === "ready") this.handlers.onReady();
      else this.handlers.onAction(msg);
    });

    conn.on("close", () => {
      if (this.disposed) return;
      this.handlers.onDisconnected();
    });

    conn.on("error", () => {
      if (this.disposed) return;
      this.handlers.onDisconnected();
    });
  }

  private disposePeer(): void {
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    this.conn = null;
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    this.role = null;
    this.room = "";
  }
}

function parseMsg(raw: unknown): NetMsg | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case "hello": {
      const setup = parseSetup(msg.setup);
      return setup ? { type: "hello", setup } : null;
    }
    case "ready":
      return { type: "ready" };
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
      return { type: "castle", side: msg.side };
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
  if (s.kind === "fen" && typeof s.fen === "string" && s.fen.trim()) {
    return { kind: "fen", fen: s.fen.trim() };
  }
  return null;
}

export { normalizeRoom };
