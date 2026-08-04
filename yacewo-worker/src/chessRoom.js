// One ChessRoom instance = one game room. Uses the Hibernation WebSocket
// API so idle rooms (thinking time, lobby wait) don't burn DO duration —
// Cloudflare keeps client sockets open while the isolate sleeps.
// Message shapes mirror web/ui/src/net.ts (NetMsg).

const MAX_PLAYERS = 2;

/** Finished games are cleared quickly; abandoned/in-progress rooms linger. */
const TTL_FINISHED_MS = 15 * 60 * 1000;
const TTL_UNFINISHED_MS = 24 * 60 * 60 * 1000;

export class ChessRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Rebuilt from storage after every hibernation wake — do not rely on
    // other in-memory fields surviving idle.
    this.room = null;
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
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.close(1000, "Room expired");
      } catch {
        /* ignore */
      }
    }
    this.room = null;
    // compatibility_date < 2026-02-24: deleteAll does not clear alarms.
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
  }

  attachment(ws) {
    try {
      return ws.deserializeAttachment();
    } catch {
      return null;
    }
  }

  broadcast(payload, except = null) {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(raw);
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
    // Persisted client-side (localStorage) per room — same host/guest on reconnect.
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response("Missing token", { status: 400 });
    }

    const room = await this.loadRoom();

    for (const ws of this.state.getWebSockets()) {
      const att = this.attachment(ws);
      if (att?.token === token) {
        return new Response("Already connected in another tab", { status: 409 });
      }
    }

    const seated =
      (room.playerTokens.host ? 1 : 0) + (room.playerTokens.guest ? 1 : 0);

    let role;
    if (room.playerTokens.host === token) {
      role = "host"; // host is always White
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

    // Hibernation accept — DO can sleep while clients stay connected.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ role, token });

    await this.sendCatchUp(server, role);

    const others = this.state.getWebSockets().filter((ws) => ws !== server);
    if (others.length > 0) {
      this.broadcast({ type: "peer_joined", role }, server);
      for (const o of others) {
        const att = this.attachment(o);
        if (att?.role) {
          server.send(JSON.stringify({ type: "peer_joined", role: att.role }));
        }
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async sendCatchUp(socket, role) {
    const room = await this.loadRoom();

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
      socket.send(JSON.stringify({ type: "status", phase: "waiting", role }));
      if (role === "guest") {
        socket.send(JSON.stringify({ type: "hello", setup: room.setup }));
      }
    } else {
      socket.send(JSON.stringify({ type: "status", phase: "waiting", role }));
    }
  }

  async webSocketMessage(ws, message) {
    const att = this.attachment(ws);
    if (!att?.role) return;
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    await this.handleMessage({ role: att.role, token: att.token, socket: ws }, raw);
  }

  async webSocketClose(ws, code, reason, _wasClean) {
    const att = this.attachment(ws);
    if (att?.role) {
      this.broadcast({ type: "peer_left", role: att.role }, ws);
    }
    try {
      ws.close(code, reason);
    } catch {
      /* ignore */
    }
  }

  async webSocketError(ws) {
    const att = this.attachment(ws);
    if (att?.role) {
      this.broadcast({ type: "peer_left", role: att.role }, ws);
    }
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      /* ignore */
    }
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
        room.setup = msg.setup;
        room.status = "active";
        break;
      }
      case "ready":
        break;
      case "sync": {
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
        break;
      default:
        return;
    }

    await this.saveRoom();
    this.broadcast(msg, session.socket);
  }
}
