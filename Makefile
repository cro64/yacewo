.PHONY: test play build clean utop checkcode bisect bisect-clean doc web web-engine web-dev

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

web-engine:
	dune build web/bridge/bridge.bc.js
	mkdir -p web/ui/public
	cp -f _build/default/web/bridge/bridge.bc.js web/ui/public/yacewo_engine.js

web: web-engine
	cd web/ui && npm install && npm run build

web-dev: web-engine
	cd web/ui && npm install && npm run dev
