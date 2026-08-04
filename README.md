# YACEWO

**Yet Another Chess Enigma, Written in OCaml**

[Play online →](https://cro64.github.io/yacewo/)

Two-player chess in the browser or terminal — **Classical** openings, **Anarchy**
seeded armies, **Chess960**, **Horde**, and **shareable rooms** backed by a
Cloudflare Durable Object (either player can refresh and rejoin).

<p align="center">
  <img src="images/demo.gif" alt="YACEWO play demo" width="720" />
</p>

## Features

- **Classical** — standard chess with castling, promotion, en passant, checkmate, and draws
- **Anarchy** — seeded random armies (kings fixed); same seed → same position; shareable `?seed=…` links
- **Chess960** — FIDE / Scharnagl IDs **0–959** (SP-518 = classical); share as `?mode=chess960&seed=…`
- **Horde** — Lichess-style: White has 36 pawns (rank-1 may double-step); Black wins by wiping the horde; share as `?mode=horde`
- **Remote play** — Create Room, share a link or code; either player can rejoin after a drop; you can still move on your turn while the opponent is away
- **Board prefs** — Last move highlights, Coords, and hotseat Auto-flip (all off by default); critical pieces tint when in check
- **Hotseat** — local two-player on one device; Auto-flip keeps the side to move at the bottom
- **FEN & Seed** — load positions (optional 7th-field seed / `960` / `horde` / `dk` / `dq`); one-click copy for FEN, moves, or seed/ID
- **Notation** — click-to-move or type `e4`, `Nf3`, `O-O`, …; Escape clears selection / Help
- **Undo / Resign / Draw / Quit** — offer-and-accept draws; Undo is hotseat only (disabled online)

## Screenshots

### Landing

Classical, Anarchy, Chess960, or Horde, then Play — or create / join a remote
room. FEN and Seed/ID open when you need a custom start. Anarchy seeds sync as
`?seed=…`; Chess960 as `?mode=chess960&seed=…`; Horde as `?mode=horde`.

<p>
  <img src="images/landing.png" alt="YACEWO landing — Classical, Anarchy, Chess960, or Horde; Create or Join Room" width="720" />
</p>

### Classical

Standard rules, move list, live FEN with copy, optional Last move / Coords /
Auto-flip, and the usual game actions (Quit returns to the landing screen).

<p>
  <img src="images/classical.png" alt="Classical game in progress after 1. e4 e5 2. Nf3" width="720" />
</p>

### Anarchy

Pick or roll a seed; the army layout is reproducible and shown in the panel
(and in FEN as a seventh field). Open `/yacewo/?seed=42` to land on that army.

<p>
  <img src="images/anarchy.png" alt="Anarchy mode with seed 42" width="720" />
</p>

### Chess960

Uses the FIDE / Scharnagl numbering (**0–959**). SP-518 is the classical
starting array. Castling follows Chess960 (king ends on c/g, rook on d/f).
Open `/yacewo/?mode=chess960&seed=518` for the familiar layout. Out-of-range
URL values wrap modulo 960; the ID field itself only accepts 0–959.

<p>
  <img src="images/chess960.png" alt="Chess960 position with FIDE ID 518" width="720" />
</p>

### Horde

White fields 36 pawns; Black keeps a normal army. Rank-1 White pawns may
double-step. Black wins by capturing every White piece (not only the king).
Open `/yacewo/?mode=horde`.

<p>
  <img src="images/horde.png" alt="Horde — White's 36-pawn army vs Black" width="720" />
</p>

### Remote rooms

**Create Room** opens a lobby with a code and a shareable link
(`?room=…`). Guests paste the code or open the link to join. Host is White;
guest is Black. Setup (Classical, Anarchy seed, Chess960 ID, Horde, Queer, or
FEN) is sent with the handshake.

Rooms are **not** peer-to-peer: state lives in a [Cloudflare Durable
Object](yacewo-worker/) (`yacewo-rooms`). Either player can refresh or drop and
rejoin with the same link — a per-browser identity token keeps host/guest
roles stable. The side to move can still play while the opponent is away; the
DO stores moves and syncs them on rejoin. Idle sockets hibernate (no duration
while thinking). Finished games expire after **15 minutes**, unfinished rooms
after **24 hours** of inactivity.

<p>
  <img src="images/remote-lobby.png" alt="Remote lobby — waiting for opponent with copy link" width="720" />
  &nbsp;
  <img src="images/remote-join.png" alt="Join Room with a six-character code" width="720" />
</p>

## Easter Egg

### Queer

Hidden on the landing menu except during Pride Month (June) — or whenever you
open the share link. Double Kings (`RNBKKBNR`) or Double Queens (`RNBQQBNR`):
every critical piece must stay safe each turn; pawns may promote to king.
Open `/yacewo/?mode=dk` or `/yacewo/?mode=dq`.

<p>
  <img src="images/queer.png" alt="Queer Double Kings — pastel board and legal markers" width="720" />
</p>

## Web UI

Live site: **[https://cro64.github.io/yacewo/](https://cro64.github.io/yacewo/)**

```sh
make web          # js_of_ocaml bridge + static site → docs/ (GitHub Pages)
make web-dev      # local Vite at http://localhost:5173/yacewo/
```

Requires Node.js and `opam install js_of_ocaml js_of_ocaml-ppx`.

### Remote rooms setup

1. **Deploy the Worker** (once per Cloudflare account) — see
   [yacewo-worker/README.md](yacewo-worker/README.md):

   ```sh
   cd yacewo-worker
   npm install
   npx wrangler login
   npm run deploy
   ```

   Free-plan Durable Objects need `new_sqlite_classes` in `wrangler.toml`
   (already set). Copy the printed URL, e.g.
   `https://yacewo-rooms.<subdomain>.workers.dev`.

2. **Point the UI at it** before building (Vite bakes the URL in at build time):

   ```sh
   # web/ui/.env.local — gitignored
   VITE_YACEWO_ROOMS_URL=https://yacewo-rooms.<subdomain>.workers.dev
   ```

3. **Build / run**

   ```sh
   make web-dev   # local UI → live Worker; test join in an incognito window
   make web       # writes docs/ for GitHub Pages — then commit & push docs/
   ```

   Two players need **separate browser profiles** (or incognito): the same
   profile reuses the room identity token and cannot open two seats.

Regenerate README screenshots / demo (with `make web-dev` or `vite preview` running):

```sh
# optional: YACEWO_URL=https://cro64.github.io/yacewo/
node scripts/capture-demos.mjs   # needs playwright + ffmpeg
```

## Terminal

```sh
make build
make test
make play
```

See [INSTALL.md](INSTALL.md) for OCaml and web setup.

## Credits

Main Engine started as CS3110 @ Cornell final-project. Heavily modified since.

Queer mode inspired by [homonormative-chess](https://github.com/SwiftWinds/homonormative-chess) 💅
