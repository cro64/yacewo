.PHONY: test play build clean utop checkcode bisect bisect-clean doc web web-engine web-dev web-engine-check web-smoke

# Fail CI/local production builds if the browser engine grows past these.
# Release whole-program + opt 3 + browser target is ~117KB / ~40KB gzip (2026-08).
WEB_ENGINE_MAX_RAW ?= 200000
WEB_ENGINE_MAX_GZIP ?= 80000

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

# Whole-program js_of_ocaml (dune --profile release) — required for a small
# browser engine. Dev profile separate compilation stays ~2.6MB and is only
# for fast local iteration of the bridge itself.
web-engine:
	dune build --profile release web/bridge/bridge.bc.js
	mkdir -p web/ui/public
	cp -f _build/default/web/bridge/bridge.bc.js web/ui/public/yacewo_engine.js
	@$(MAKE) web-engine-check

web-engine-check:
	@raw=$$(wc -c < web/ui/public/yacewo_engine.js | tr -d ' '); \
	gz=$$(gzip -c web/ui/public/yacewo_engine.js | wc -c | tr -d ' '); \
	echo "yacewo_engine.js: $$raw bytes ($$gz gzip)"; \
	if [ "$$raw" -gt "$(WEB_ENGINE_MAX_RAW)" ] || [ "$$gz" -gt "$(WEB_ENGINE_MAX_GZIP)" ]; then \
		echo "error: engine exceeds size budget (raw<=$(WEB_ENGINE_MAX_RAW) gzip<=$(WEB_ENGINE_MAX_GZIP))"; \
		echo "hint: build with --profile release; see web/bridge/dune"; \
		exit 1; \
	fi

web: web-engine
	cd web/ui && npm install && npm run build

web-dev: web-engine
	cd web/ui && npm install && npm run dev

web-smoke: web-engine
	node scripts/smoke-engine.mjs
