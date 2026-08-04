# yacewo-rooms

Cloudflare Worker + Durable Object that hosts YACEWO remote rooms.
Game state lives in the Durable Object — either player can close their tab
and rejoin without ending the game.

## Deploy

```bash
npm install
npx wrangler login   # one-time, opens browser
npm run deploy
```

Wrangler prints a live URL, e.g. `https://yacewo-rooms.<subdomain>.workers.dev`.

Point the web UI at it:

```bash
# web/ui/.env.local (or CI env)
VITE_YACEWO_ROOMS_URL=https://yacewo-rooms.<subdomain>.workers.dev
```

Then rebuild the UI (`make web` / `npm run build` in `web/ui`).

## Local dev

```bash
npm run dev          # wrangler dev — usually http://127.0.0.1:8787
```

```bash
VITE_YACEWO_ROOMS_URL=http://127.0.0.1:8787 npm run dev   # in web/ui
```

## Protocol

WebSocket `GET /room/:code?token=<uuid>`. Token is stored in the browser
(`localStorage` key `yacewo-token-<ROOM>`) so reconnects keep the same
host/guest role. Message shapes match `web/ui/src/net.ts` (`NetMsg`), plus
transport events `status`, `peer_joined`, and `peer_left`.

Move legality is still trusted client-side (same as the old PeerJS path).

## Expiry

Durable Object storage is cleared via an alarm:

- **Finished** games (`resign` / `draw`) — **15 minutes** after last activity
- **Unfinished** rooms (waiting / in progress) — **24 hours** after last activity

Any connect or message resets the timer for that room’s current status.
