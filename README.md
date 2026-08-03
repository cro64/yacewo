# YACEWO

**Yet Another Chess Engine Written in OCaml**

<img src="images/playmode.png" alt="Menu" width="450"/> <br>
<img src="images/classicalmode.png" alt="Classical Game Mode" width="450"/>
<img src="images/anarchymode.png" alt="Anarchy Game Mode" width="450"/>

# About

Two-player chess in OCaml with a UI-ready engine API. Play Classical or
**Anarchy** (randomized armies, kings fixed) in the terminal with Unicode pieces
and algebraic notation — plus Undo, Resign, Draw, FEN import/export, and a move
list. Supports castling, promotion, en passant, checkmate, and draws.

# Installation

Follow the instructions in [INSTALL.md](INSTALL.md).

```sh
make build
make test
make play
```

# Web UI (GitHub Pages)

Pastel-sage board UI with light/dark themes. Requires Node.js and
`js_of_ocaml` (`opam install js_of_ocaml js_of_ocaml-ppx`).

```sh
make web          # builds engine bridge + static site into docs/
make web-dev      # local Vite server at /yacewo/
```

Enable GitHub Pages with source **Deploy from a branch** → `main` / `docs`.
The site expects the project URL path `/yacewo/`.
