/**
 * Smoke: mid-game rejoin via ?room= against a DO-backed rooms Worker.
 *
 * Requires:
 *   - UI with VITE_YACEWO_ROOMS_URL baked in (preview or YACEWO_URL)
 *   - Rooms Worker reachable from the browser
 *
 * Usage:
 *   YACEWO_URL=http://127.0.0.1:4173/yacewo/ node scripts/smoke-rejoin.mjs
 *
 * Optional: YACEWO_REJOIN_SIDE=guest|host (default guest) — who leaves and returns.
 */
import { chromium } from "playwright";

const BASE = process.env.YACEWO_URL ?? "http://127.0.0.1:4173/yacewo/";
const SIDE = (process.env.YACEWO_REJOIN_SIDE ?? "guest").toLowerCase();

async function waitEngine(page) {
  await page.waitForFunction(() => !!window.Yacewo, null, { timeout: 30000 });
  await page.waitForSelector(".landing, .lobby, .play", { timeout: 30000 });
}

async function roomCode(page) {
  return page.evaluate(() => {
    const m = location.search.match(/room=([2-9A-HJ-NP-Z]+)/i);
    if (m) return m[1].toUpperCase();
    const code = document.querySelector(".lobby-code")?.textContent?.trim();
    return code ? code.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "") : "";
  });
}

async function main() {
  if (!process.env.YACEWO_URL && !process.env.VITE_YACEWO_ROOMS_URL) {
    console.error(
      "Set YACEWO_URL to a UI build that has VITE_YACEWO_ROOMS_URL configured.\n" +
        "Example: deploy yacewo-worker, then:\n" +
        "  VITE_YACEWO_ROOMS_URL=https://…workers.dev npm run build\n" +
        "  YACEWO_URL=http://127.0.0.1:4173/yacewo/ node scripts/smoke-rejoin.mjs",
    );
    process.exit(2);
  }

  const browser = await chromium.launch();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  let guest = await guestCtx.newPage();

  try {
    await host.goto(BASE);
    await waitEngine(host);
    await host.getByRole("button", { name: /Create Room/i }).click();
    await host.waitForSelector(".lobby-code, .lobby", { timeout: 30000 });

    const createErr = await host.locator(".error-line").textContent().catch(() => "");
    if (createErr && /VITE_YACEWO_ROOMS_URL|Remote rooms need/i.test(createErr)) {
      throw new Error(
        `UI is missing rooms URL: ${createErr.trim()}\n` +
          "Rebuild with VITE_YACEWO_ROOMS_URL set to your Worker.",
      );
    }

    await host.waitForFunction(
      () => {
        const el =
          document.querySelector(".lobby-code") ||
          document.querySelector("[data-room]");
        const text = (el?.textContent || document.body.innerText).toUpperCase();
        return /[2-9A-HJ-NP-Z]{4,}/.test(text);
      },
      null,
      { timeout: 30000 },
    );

    const room = await roomCode(host);
    if (!room || room.length < 4) throw new Error("Host did not get a room code");
    console.log("room", room);

    await guest.goto(`${BASE}?room=${room}`);
    await waitEngine(guest);
    await host.waitForSelector(".play", { timeout: 45000 });
    await guest.waitForSelector(".play", { timeout: 45000 });

    // Host (white) plays e2-e4
    await host.locator('[data-sq="e2"]').click();
    await host.locator('[data-sq="e4"]').click();
    await host.waitForFunction(
      () => {
        const fen = document.querySelector(".fen-box")?.textContent || "";
        const moves = document.querySelector(".move-list")?.textContent || "";
        return fen.includes("4P3") || /e4/.test(moves);
      },
      null,
      { timeout: 15000 },
    );
    const fenAfterMove = await host.locator(".fen-box").innerText();
    console.log("fen after move", fenAfterMove.trim());

    const leaver = SIDE === "host" ? host : guest;
    const stayer = SIDE === "host" ? guest : host;
    const leaverCtx = SIDE === "host" ? hostCtx : guestCtx;

    await leaver.goto("about:blank");
    const left = await stayer
      .waitForFunction(
        () => {
          const banner = document.querySelector(".remote-banner")?.textContent || "";
          const err = document.querySelector(".error-line")?.textContent || "";
          return (
            banner.includes("waiting for rejoin") ||
            err.includes("waiting to rejoin") ||
            err.includes("Opponent left")
          );
        },
        null,
        { timeout: 45000 },
      )
      .then(() => true)
      .catch(async () => {
        const dump = await stayer.evaluate(() => ({
          banner: document.querySelector(".remote-banner")?.textContent,
          err: document.querySelector(".error-line")?.textContent,
          status: document.querySelector(".status-turn")?.textContent,
          url: location.href,
        }));
        console.error("stayer state after leave", dump);
        return false;
      });
    if (!left) throw new Error("Stayer did not notice opponent disconnect");
    console.log(`${SIDE} left; other side waiting for rejoin`);

    const rejoiner = await leaverCtx.newPage();
    await rejoiner.goto(`${BASE}?room=${room}`);
    await waitEngine(rejoiner);
    await rejoiner.waitForSelector(".play", { timeout: 45000 });
    await stayer.waitForFunction(
      () =>
        !(document.querySelector(".remote-banner")?.textContent || "").includes(
          "waiting for rejoin",
        ) &&
        !(document.querySelector(".error-line")?.textContent || "").includes(
          "waiting to rejoin",
        ),
      null,
      { timeout: 45000 },
    );

    const stayerFen = (await stayer.locator(".fen-box").innerText()).trim();
    const rejoinerFen = (await rejoiner.locator(".fen-box").innerText()).trim();
    const rejoinerBanner = await rejoiner.locator(".remote-banner").innerText();

    if (stayerFen !== rejoinerFen) {
      throw new Error(`FEN mismatch stayer=${stayerFen} rejoiner=${rejoinerFen}`);
    }
    if (stayerFen !== fenAfterMove.trim()) {
      throw new Error(
        `Position reset on rejoin: was ${fenAfterMove.trim()} now ${stayerFen}`,
      );
    }

    const expectColor = SIDE === "host" ? /white/i : /black/i;
    if (!expectColor.test(rejoinerBanner)) {
      throw new Error(`Rejoiner banner wrong color: ${rejoinerBanner}`);
    }

    console.log("OK — rejoined with matching FEN");
    console.log("rejoiner banner:", rejoinerBanner.trim());
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
