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

Install ANSITerminal, the only library needed right now.
```sh
opam install ANSITerminal
```

After successfully completing these steps, run `make clean` and `make build`.

To play the game, run `make play` and follow the instructions related to interacting with the UI and playing the game accordining.