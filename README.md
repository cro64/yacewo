# YACEWO

**(Yet Another) Chess Engine Written in OCaml**

[Play online →](https://cro64.github.io/yacewo/)

Two-player chess in the browser or terminal — **Classical** openings, **Anarchy**
seeded armies, and **peer-to-peer rooms** you can share with a link.

<p align="center">
  <img src="images/demo.gif" alt="YACEWO play demo" width="720" />
</p>

## Features

- **Classical** — standard chess with castling, promotion, en passant, checkmate, and draws
- **Anarchy** — seeded random armies (kings fixed); same seed → same position
- **Remote play** — Create Room, share a link or code; guest auto-joins; host is White
- **Hotseat** — local two-player on one device
- **FEN & Seed** — load positions (optional 7th-field Anarchy seed); copy FEN from the panel
- **Notation** — click-to-move or type `e4`, `Nf3`, `O-O`, …
- **Undo / Resign / Draw** — including offer-and-accept draws

## Screenshots

### Landing

Classical or Anarchy, then Play — or create / join a remote room. FEN and Seed
open when you need a custom start.

<p>
  <img src="images/landing.png" alt="YACEWO landing — Classical or Anarchy, Create or Join Room" width="720" />
</p>

### Classical

Standard rules, move list, live FEN, and the usual game actions.

<p>
  <img src="images/classical.png" alt="Classical game in progress after 1. e4 e5 2. Nf3" width="720" />
</p>

### Anarchy

Pick or roll a seed; the army layout is reproducible and shown in the panel
(and in FEN as a seventh field).

<p>
  <img src="images/anarchy.png" alt="Anarchy mode with seed 42" width="720" />
</p>

### Remote rooms

**Create Room** opens a lobby with a code and a shareable link
(`?room=…`). Guests can paste a code on the landing page or open the link to
auto-join. Setup (Classical, Anarchy seed, or FEN) is sent with the handshake.

<p>
  <img src="images/remote-lobby.png" alt="Remote lobby — waiting for opponent with copy link" width="720" />
  &nbsp;
  <img src="images/remote-join.png" alt="Join Room with a six-character code" width="720" />
</p>

## Web UI

Live site: **https://cro64.github.io/yacewo/**

```sh
make web          # js_of_ocaml bridge + static site → docs/
make web-dev      # local Vite at /yacewo/
```

Requires Node.js and `opam install js_of_ocaml js_of_ocaml-ppx`.

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

See [INSTALL.md](INSTALL.md) for OCaml setup.
