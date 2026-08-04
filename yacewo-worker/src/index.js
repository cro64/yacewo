import { ChessRoom } from "./chessRoom.js";

export { ChessRoom };

/**
 * Route WebSocket upgrades to a Durable Object keyed by room code.
 * GET /room/:id?token=… → ChessRoom DO
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([^/]+)\/?$/);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const roomId = decodeURIComponent(match[1]).toUpperCase();
    if (!roomId) {
      return new Response("Missing room id", { status: 400 });
    }

    const id = env.CHESS_ROOM.idFromName(roomId);
    const stub = env.CHESS_ROOM.get(id);
    return stub.fetch(request);
  },
};
