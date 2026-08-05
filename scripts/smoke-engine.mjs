#!/usr/bin/env node
/**
 * Smoke-test the js_of_ocaml bridge without a browser.
 * With a CommonJS-like `module` in scope, the IIFE attaches to module.exports
 * (in the browser it uses globalThis).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enginePath = path.join(root, "web/ui/public/yacewo_engine.js");

if (!fs.existsSync(enginePath)) {
  console.error(`missing ${enginePath}; run: make web-engine`);
  process.exit(1);
}

const module = { exports: {} };
const code = fs.readFileSync(enginePath, "utf8");
// Run in this realm so browser APIs (TextDecoder, etc.) exist; inject `module`.
new Function("module", "exports", code)(module, module.exports);

const Yacewo = module.exports.Yacewo;
if (!Yacewo || typeof Yacewo.createClassical !== "function") {
  console.error("Yacewo.createClassical missing", Object.keys(module.exports));
  process.exit(1);
}

const start = Yacewo.createClassical();
if (!start.ok || !start.game?.fen?.includes("rnbqkbnr/pppppppp")) {
  console.error("createClassical failed", start);
  process.exit(1);
}

const moved = Yacewo.applyNotation("e4");
if (!moved.ok || !String(moved.game?.fen ?? "").includes("4P3")) {
  console.error("applyNotation e4 failed", moved);
  process.exit(1);
}

const raw = fs.statSync(enginePath).size;
console.log(
  `smoke-engine ok (${raw} bytes): ${start.game.fen} -> ${moved.game.fen}`,
);
