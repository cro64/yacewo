# yacewo-rooms

Cloudflare Worker + Durable Object that hosts YACEWO remote rooms.
Game state lives in the Durable Object — either player can close their tab
and rejoin without ending the game.

Sockets use the **Hibernation WebSocket API**: idle rooms (lobby wait, think
time) sleep without disconnecting clients, so free-tier duration is mostly
handler time rather than wall-clock while connected.

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
VITE_VAPID_PUBLIC_KEY=<public key from vapid generation>
```

Then rebuild the UI (`make web` / `npm run build` in `web/ui`).

### Push notifications (VAPID)

Generate a keypair once (PushForge, Workers-compatible):

```bash
npx @pushforge/builder vapid
```

Set the **private** JWK as a Worker secret (paste the JSON on one line):

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

Put the **public** key in the UI build as `VITE_VAPID_PUBLIC_KEY` (see
`.env.example`). For GitHub Pages CI, add it as a repository Actions variable
alongside `VITE_YACEWO_ROOMS_URL`.

`SITE_ORIGIN` / `VAPID_SUBJECT` in `wrangler.toml` `[vars]` are public and used
for notification navigate/icon URLs and the VAPID contact claim.

Local `wrangler dev` reads secrets from `.dev.vars` (gitignored).

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

`push-subscribe` is client → DO only (stores a Web Push subscription per
seat). On `move` / `castle` / `notation`, if the opponent has no live
socket, the DO sends a Declarative Web Push payload via PushForge.

Move legality is still trusted client-side (same as the old PeerJS path).

## Expiry

Durable Object storage is cleared via an alarm:

- **Finished** games (`resign` / `draw`) — **15 minutes** after last activity
- **Unfinished** rooms (waiting / in progress) — **24 hours** after last activity

Any connect or message resets the timer for that room’s current status.

Idle connected clients do **not** keep the DO awake (hibernation); only
messages, connects, and alarms wake it for billing duration.
