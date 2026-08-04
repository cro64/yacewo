// One ChessRoom instance = one game room. Mirrors the message shapes from
// web/ui/src/net.ts (NetMsg) so the client's message handling barely changes —
// only the transport (WebSocket instead of PeerJS DataConnection) and the
// fact that the DO, not the host's browser, is now the source of truth.

const MAX_PLAYERS = 2;

/** Finished games are cleared quickly; abandoned/in-progress rooms linger. */
const TTL_FINISHED_MS = 15 * 60 * 1000;
const TTL_UNFINISHED_MS = 24 * 60 * 60 * 1000;

export class ChessRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    // Connected sockets: { role: "host" | "guest", token, socket }
    this.sessions = [];

    this.room = null; // lazily loaded
  }

  async loadRoom() {
    if (this.room) return this.room;
    const stored = await this.state.storage.get("room");
    this.room = stored ?? {
      // Mirrors GameSetup from net.ts: { kind: "classical" | "anarchy" | ... }
      setup: null,
      fen: null,
      seed: null,
      moveList: "",
      status: "waiting", // waiting | active | finished
      playerTokens: { host: null, guest: null },
    };
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
    for (const s of this.sessions) {
      try {
        s.socket.close(1000, "Room expired");
      } catch {
        /* ignore */
      }
    }
    this.sessions = [];
    this.room = null;
    // compatibility_date < 2026-02-24: deleteAll does not clear alarms.
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
  }

  broadcast(payload, except = null) {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    for (const s of this.sessions) {
      if (s === except) continue;
      try {
        s.socket.send(raw);
      } catch {
        /* ignore broken sockets */
      }
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    // Persisted client-side (localStorage) per room, same purpose the
    // PeerJS peer ID served: proving "this is the same host/guest coming
    // back" independent of *when* they reconnect.
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response("Missing token", { status: 400 });
    }

    const room = await this.loadRoom();
    if (this.sessions.some((s) => s.token === token)) {
      return new Response("Already connected in another tab", { status: 409 });
    }

    const seated =
      (room.playerTokens.host ? 1 : 0) + (room.playerTokens.guest ? 1 : 0);

    let role;
    if (room.playerTokens.host === token) {
      role = "host"; // host is always White, matching current convention
    } else if (room.playerTokens.guest === token) {
      role = "guest"; // guest is always Black
    } else if (room.playerTokens.host === null) {
      role = "host";
      room.playerTokens.host = token;
    } else if (room.playerTokens.guest === null && seated < MAX_PLAYERS) {
      role = "guest";
      room.playerTokens.guest = token;
    } else {
      return new Response("Room full", { status: 403 });
    }
    await this.saveRoom();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    await this.handleSession(server, token, role);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSession(socket, token, role) {
    socket.accept();
    const session = { role, token, socket };
    this.sessions.push(session);

    const room = await this.loadRoom();
    const others = this.sessions.filter((s) => s !== session);

    // Catch up the newcomer from DO storage (not the peer's browser).
    if (room.status === "active" && room.fen) {
      socket.send(
        JSON.stringify({
          type: "sync",
          fen: room.fen,
          seed: room.seed,
          moveList: room.moveList,
          role,
        }),
      );
    } else if (room.setup) {
      // hello accepted but fen not seeded yet (or finished without fen).
      socket.send(JSON.stringify({ type: "status", phase: "waiting", role }));
      if (role === "guest") {
        socket.send(JSON.stringify({ type: "hello", setup: room.setup }));
      }
    } else {
      socket.send(JSON.stringify({ type: "status", phase: "waiting", role }));
    }

    // Tell the other side someone (re)joined so lobby → connected / rejoin UX.
    if (others.length > 0) {
      this.broadcast({ type: "peer_joined", role }, session);
      // If the opponent is already here and we're still in lobby, both should
      // see connected. Newcomer also gets peer_joined for the seated peer.
      for (const o of others) {
        socket.send(JSON.stringify({ type: "peer_joined", role: o.role }));
      }
    }

    socket.addEventListener("message", async (event) => {
      await this.handleMessage(session, event.data);
    });

    socket.addEventListener("close", () => {
      this.sessions = this.sessions.filter((s) => s !== session);
      this.broadcast({ type: "peer_left", role: session.role });
    });
  }

  async handleMessage(session, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const room = await this.loadRoom();

    switch (msg.type) {
      case "hello": {
        // Host's initial handshake — record setup, mark active.
        room.setup = msg.setup;
        room.status = "active";
        break;
      }
      case "ready":
        break; // guest ack — nothing to persist, just relay below
      case "sync": {
        // Authoritative state push (host or reconnect seed).
        room.fen = msg.fen;
        room.seed = msg.seed ?? null;
        room.moveList = msg.moveList ?? room.moveList;
        if (room.setup || room.fen) room.status = "active";
        break;
      }
      case "move":
      case "castle":
      case "notation":
      case "resign":
      case "draw": {
        // Client piggybacks { state: { fen, moveList } } on every action
        // since move/castle/notation don't carry fen/moveList themselves.
        if (msg.state?.fen) room.fen = msg.state.fen;
        if (typeof msg.state?.moveList === "string") {
          room.moveList = msg.state.moveList;
        }
        if (msg.type === "resign" || msg.type === "draw") {
          room.status = "finished";
        }
        break;
      }
      case "undo":
        // Client already restricts this to hotseat-only; DO just relays.
        break;
      default:
        return;
    }

    await this.saveRoom();
    this.broadcast(msg, session);
  }
}
