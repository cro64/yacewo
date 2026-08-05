# Installation

Before attempting to run this game, make sure that OCaml is installed on the machine.

If you are not sure about how to install OCaml, follow the official guide at [ocaml.org/install](https://ocaml.org/install).

## Steps

Update OPAM to prepare for installing the necessary package(s). Do be patient in the updating process.

```sh
opam update
```

The command will also prompt you to upgrade packages:

```sh
opam upgrade
```

Install the terminal UI dependency:

```sh
opam install ANSITerminal
```

After successfully completing these steps, run `make clean` and `make build`.

To play in the terminal, run `make play` and follow the on-screen instructions.

## Web UI (optional)

The browser client needs Node.js plus the js_of_ocaml toolchain:

```sh
opam install js_of_ocaml js_of_ocaml-ppx
```

Then:

```sh
make web-dev   # Vite at http://localhost:5173/yacewo/
# or
make web       # production build into docs/ (gitignored; for local preview)
```

`make web` builds a **release** js_of_ocaml engine (`dune --profile release`), runs
`npm install` in `web/ui`, and writes the static site to `docs/`. GitHub Pages is
deployed by Actions on `main` — do not commit `docs/`.
