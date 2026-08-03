# YACEWO

**(Yet) Another Chess Engine Written in OCaml**

[Play online →](https://cro64.github.io/yacewo/)

<p>
  <img src="images/landing.png" alt="YACEWO landing — Classical or Anarchy" width="720" />
</p>

<p>
  <img src="images/classical.png" alt="Classical game in progress" width="720" />
  &nbsp;
  <img src="images/anarchy.png" alt="Anarchy mode with seed 42" width="720" />
</p>

<p>
  <img src="images/demo.gif" alt="YACEWO play demo" width="720" />
</p>

## About

Two-player chess with a UI-ready OCaml engine API. Play **Classical** or
**Anarchy** (seeded random armies, kings fixed) in the browser or terminal —
algebraic notation, Undo, Resign, Draw, FEN import/export (optional seed field),
and a move list. Supports castling, promotion, en passant, checkmate, and draws.

## Web UI

Live site: **https://cro64.github.io/yacewo/**

```sh
make web          # js_of_ocaml bridge + static site → docs/
make web-dev      # local Vite at /yacewo/
```

Requires Node.js and `opam install js_of_ocaml js_of_ocaml-ppx`.

Regenerate README screenshots / demo (with `make web-dev` or preview running):

```sh
# optional: YACEWO_URL=https://cro64.github.io/yacewo/
node scripts/capture-demos.mjs   # needs playwright installed
```

## Terminal

```sh
make build
make test
make play
```

See [INSTALL.md](INSTALL.md) for OCaml setup.
