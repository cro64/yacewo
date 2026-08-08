// One ChessRoom instance = one game room. Uses the Hibernation WebSocket
// API so idle rooms (thinking time, lobby wait) don't burn DO duration —
// Cloudflare keeps client sockets open while the isolate sleeps.
// Message shapes mirror web/ui/src/net.ts (NetMsg).

import { buildPushHTTPRequest } from "@pushforge/builder";

const MAX_PLAYERS = 2;

/** Finished games are cleared quickly; abandoned/in-progress rooms linger. */
const TTL_FINISHED_MS = 15 * 60 * 1000;
const TTL_UNFINISHED_MS = 24 * 60 * 60 * 1000;

/** Application WebSocket close codes (4000–4999). */
const CLOSE = {
  ERROR: 4000,
  /** Same token opened a newer socket — kick the stale one. */
  REPLACED: 4001,
  ROOM_FULL: 4003,
  ROOM_NOT_FOUND: 4004,
  CONFLICT: 4009,
};

function emptyRoom() {
  return {
    // Mirrors GameSetup from net.ts: { kind: "classical" | "anarchy" | ... }
    setup: null,
    fen: null,
    seed: null,
    moveList: "",
    /** Exact from/to of the last move — persisted for reconnect highlight. */
    lastHighlight: null,
    status: "waiting", // waiting | active | finished
    playerTokens: { host: null, guest: null },
    /** @type {{ host: object | null, guest: object | null }} */
    pushSubscriptions: { host: null, guest: null },
    /** Room code from /room/:id — used in push navigate URLs. */
    roomId: null,
  };
}

/**
 * Resolve seat for a connecting token.
 * @returns {{ role: "host" | "guest" } | { error: string, code: number }}
 */
function assignSeat(room, token, intent) {
  const { host, guest } = room.playerTokens;

  // Reconnect — same localStorage token keeps host/guest (White/Black).
  if (host === token) return { role: "host" };
  if (guest === token) return { role: "guest" };

  if (intent === "create") {
    if (host !== null) {
      return { error: "Room already exists", code: CLOSE.CONFLICT };
    }
    room.playerTokens.host = token;
    return { role: "host" };
  }

  // intent === "join" — never mint an empty host lobby (no setup/game).
  if (host === null) {
    return { error: "Room not found", code: CLOSE.ROOM_NOT_FOUND };
  }
  if (guest === null) {
    const seated = (host ? 1 : 0) + (guest ? 1 : 0);
    if (seated < MAX_PLAYERS) {
      room.playerTokens.guest = token;
      return { role: "guest" };
    }
  }
  return { error: "Room full", code: CLOSE.ROOM_FULL };
}

/** Persist relay state from a client message. Returns false if ignored. */
function applyMessage(room, msg) {
  switch (msg.type) {
    case "hello":
      room.setup = msg.setup;
      room.status = "active";
      return true;
    case "ready":
    case "undo":
      return true;
    case "sync":
      room.fen = msg.fen;
      room.seed = msg.seed ?? null;
      room.moveList = msg.moveList ?? room.moveList;
      if (msg.setup) room.setup = msg.setup;
      if ("lastHighlight" in msg) room.lastHighlight = msg.lastHighlight;
      if (room.setup || room.fen) room.status = "active";
      return true;
    case "move":
    case "castle":
    case "notation":
    case "resign":
    case "draw":
      if (msg.state?.fen) room.fen = msg.state.fen;
      if (typeof msg.state?.moveList === "string") {
        room.moveList = msg.state.moveList;
      }
      if (msg.state && "highlight" in msg.state) {
        room.lastHighlight = msg.state.highlight;
      }
      if (msg.type === "resign" || msg.type === "draw") {
        room.status = "finished";
      }
      return true;
    default:
      return false;
  }
}

function isMoveNotifyType(type) {
  return type === "move" || type === "castle" || type === "notation";
}

function isPushSubscription(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (typeof raw.endpoint !== "string" || !raw.endpoint.startsWith("https://")) {
    return false;
  }
  const keys = raw.keys;
  if (!keys || typeof keys !== "object") return false;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

function safeSend(ws, payload) {
  try {
    ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  } catch {
    /* ignore broken sockets */
  }
}

function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    /* ignore */
  }
}

export class ChessRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Rebuilt from storage after every hibernation wake — do not rely on
    // other in-memory fields surviving idle.
    this.room = null;
  }

  // ── persistence ──────────────────────────────────────────────────

  async loadRoom() {
    if (this.room) return this.room;
    const stored = await this.state.storage.get("room");
    this.room = stored ?? emptyRoom();
    // Older rooms may predate push / highlight fields.
    if (!this.room.pushSubscriptions) {
      this.room.pushSubscriptions = { host: null, guest: null };
    }
    if (!("lastHighlight" in this.room)) {
      this.room.lastHighlight = null;
    }
    return this.room;
  }

  async saveRoom() {
    await this.state.storage.put("room", this.room);
    await this.scheduleExpiry();
  }

  /** Reset TTL from now: 15m if finished, else 24h (bumped on activity). */
  async scheduleExpiry() {
    const room = this.room ?? (await this.loadRoom());
    const ttl =
      room.status === "finished" ? TTL_FINISHED_MS : TTL_UNFINISHED_MS;
    await this.state.storage.setAlarm(Date.now() + ttl);
  }

  async alarm() {
    for (const ws of this.state.getWebSockets()) {
      safeClose(ws, 1000, "Room expired");
    }
    this.room = null;
    // compatibility_date < 2026-02-24: deleteAll does not clear alarms.
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
  }

  // ── websockets ───────────────────────────────────────────────────

  attachment(ws) {
    try {
      return ws.deserializeAttachment();
    } catch {
      return null;
    }
  }

  broadcast(payload, except = null) {
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      safeSend(ws, payload);
    }
  }

  roleConnected(role) {
    for (const ws of this.state.getWebSockets()) {
      if (this.attachment(ws)?.role === role) return true;
    }
    return false;
  }

  /** Accept then immediately fail so the client can read the error. */
  rejectSocket(message, code = CLOSE.ERROR) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    safeSend(server, { type: "error", message });
    safeClose(server, code, message);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Abrupt tab closes often leave hibernated sockets still listed in
   * getWebSockets(), so presence alone cannot mean "still connected."
   * A new connect with the same token always wins — kick the old socket
   * rather than reject with "Already connected in another tab."
   */
  kickTokenSessions(token) {
    for (const ws of this.state.getWebSockets()) {
      if (this.attachment(ws)?.token !== token) continue;
      safeClose(ws, CLOSE.REPLACED, "Replaced by new connection");
    }
  }

  async acceptPlayer(role, token) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation accept — DO can sleep while clients stay connected.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ role, token });

    await this.sendCatchUp(server, role);
    this.announceJoin(server, role);

    return new Response(null, { status: 101, webSocket: client });
  }

  async sendCatchUp(socket, role) {
    const room = await this.loadRoom();

    if (room.status === "active" && room.fen) {
      safeSend(socket, {
        type: "sync",
        fen: room.fen,
        seed: room.seed,
        moveList: room.moveList,
        ...(room.setup ? { setup: room.setup } : {}),
        role,
        lastHighlight: room.lastHighlight,
      });
      return;
    }

    safeSend(socket, { type: "status", phase: "waiting", role });
    if (room.setup && role === "guest") {
      safeSend(socket, { type: "hello", setup: room.setup });
    }
  }

  announceJoin(server, role) {
    const others = this.state.getWebSockets().filter((ws) => ws !== server);
    if (others.length === 0) return;

    this.broadcast({ type: "peer_joined", role }, server);
    for (const ws of others) {
      const peerRole = this.attachment(ws)?.role;
      if (peerRole) safeSend(server, { type: "peer_joined", role: peerRole });
    }
  }

  announceLeave(ws) {
    const role = this.attachment(ws)?.role;
    if (role) this.broadcast({ type: "peer_left", role }, ws);
  }

  // ── push ─────────────────────────────────────────────────────────

  roomShareUrl(roomId) {
    const origin = (this.env.SITE_ORIGIN || "").replace(/\/$/, "");
    if (!origin || !roomId) return null;
    return `${origin}/?room=${encodeURIComponent(roomId)}`;
  }

  async notifyOpponent(sessionRole) {
    const room = this.room;
    if (!room) return;

    const opponentRole = sessionRole === "host" ? "guest" : "host";
    if (this.roleConnected(opponentRole)) return;

    const sub = room.pushSubscriptions?.[opponentRole];
    if (!isPushSubscription(sub)) return;

    const privateKey = this.env.VAPID_PRIVATE_KEY;
    if (!privateKey) return;

    const navigate = this.roomShareUrl(room.roomId);
    const origin = (this.env.SITE_ORIGIN || "").replace(/\/$/, "");
    const mover = sessionRole === "host" ? "White" : "Black";
    const payload = {
      web_push: 8030,
      notification: {
        title: "Your move",
        body: `${mover} just moved`,
        ...(navigate ? { navigate } : {}),
        ...(origin ? { icon: `${origin}/icon.png` } : {}),
        app_badge: 1,
      },
    };

    let privateJWK;
    try {
      privateJWK =
        typeof privateKey === "string" ? JSON.parse(privateKey) : privateKey;
    } catch {
      return;
    }

    try {
      const { endpoint, headers, body } = await buildPushHTTPRequest({
        privateJWK,
        subscription: sub,
        message: {
          payload,
          adminContact: this.env.VAPID_SUBJECT || "mailto:yacewo@example.com",
          options: { urgency: "high", ttl: 3600 },
        },
      });

      const res = await fetch(endpoint, { method: "POST", headers, body });
      if (res.status === 404 || res.status === 410) {
        room.pushSubscriptions[opponentRole] = null;
        await this.saveRoom();
      }
    } catch {
      /* push failures must not break move relay */
    }
  }

  // ── Durable Object entrypoints ───────────────────────────────────

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    // Persisted client-side (localStorage) per room — same host/guest on reconnect.
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response("Missing token", { status: 400 });
    }

    // create = claim empty host seat; join = existing room / reconnect only.
    const intent =
      url.searchParams.get("intent") === "create" ? "create" : "join";

    // Same localStorage token reconnecting (or a second tab) — take over.
    this.kickTokenSessions(token);

    const room = await this.loadRoom();
    const pathMatch = url.pathname.match(/\/room\/([^/]+)\/?$/);
    if (pathMatch) {
      room.roomId = decodeURIComponent(pathMatch[1]).toUpperCase();
    }

    const seat = assignSeat(room, token, intent);
    if (seat.error) {
      return this.rejectSocket(seat.error, seat.code);
    }

    await this.saveRoom();
    return this.acceptPlayer(seat.role, token);
  }

  async webSocketMessage(ws, message) {
    const att = this.attachment(ws);
    if (!att?.role) return;

    let msg;
    try {
      const raw =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const room = await this.loadRoom();

    if (msg.type === "push-subscribe") {
      if (!isPushSubscription(msg.subscription)) return;
      room.pushSubscriptions = room.pushSubscriptions ?? {
        host: null,
        guest: null,
      };
      room.pushSubscriptions[att.role] = msg.subscription;
      await this.saveRoom();
      return; // never relay
    }

    if (!applyMessage(room, msg)) return;

    await this.saveRoom();
    this.broadcast(msg, ws);

    if (isMoveNotifyType(msg.type)) {
      await this.notifyOpponent(att.role);
    }
  }

  async webSocketClose(ws, code, reason) {
    // Replaced sockets are immediately succeeded by the same seat —
    // don't flash peer_left to the opponent during a tab take-over.
    if (code !== CLOSE.REPLACED) this.announceLeave(ws);
    safeClose(ws, code, reason);
  }

  async webSocketError(ws) {
    this.announceLeave(ws);
    safeClose(ws, 1011, "WebSocket error");
  }
}
