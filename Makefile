.PHONY: test

play:
	OCAMLRUNPARAM=b dune exec bin/main.exe

test:
	OCAMLRUNPARAM=b dune exec test/main.exe

code:
	-dune build
	code .
	! dune build --watch

build:
	dune build

clean:
	dune clean

utop:
	OCAMLRUNPARAM=b dune utop src

checkcode:
	cloc --by-file --include-lang=OCaml .

bisect: bisect-clean
	-dune exec --instrument-with bisect_ppx --force test/main.exe
	bisect-ppx-report html

bisect-clean:
	rm -rf _coverage bisect*.coverage

doc:
	dune build @doc