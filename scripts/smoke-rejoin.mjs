/**
 * Smoke: guest mid-game rejoin via ?room=
 * Usage: node scripts/smoke-rejoin.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.YACEWO_URL ?? "http://127.0.0.1:4173/yacewo/";

async function waitEngine(page) {
  await page.waitForFunction(() => !!window.Yacewo, null, { timeout: 30000 });
  await page.waitForSelector(".landing, .lobby, .play", { timeout: 30000 });
}

async function main() {
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

    const room = await host.evaluate(() => {
      const m = location.search.match(/room=([2-9A-HJ-NP-Z]+)/i);
      if (m) return m[1].toUpperCase();
      const code = document.querySelector(".lobby-code")?.textContent?.trim();
      return code ? code.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "") : "";
    });
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
    console.log("moves", (await host.locator(".move-list").innerText()).trim());

    // Guest leaves (navigate away for a cleaner data-channel close than page.close)
    await guest.goto("about:blank");
    const left = await host
      .waitForFunction(
        () => {
          const banner = document.querySelector(".remote-banner")?.textContent || "";
          const err = document.querySelector(".error-line")?.textContent || "";
          return (
            banner.includes("waiting for rejoin") ||
            err.includes("waiting to rejoin") ||
            err.includes("Opponent disconnected")
          );
        },
        null,
        { timeout: 45000 },
      )
      .then(() => true)
      .catch(async () => {
        const dump = await host.evaluate(() => ({
          banner: document.querySelector(".remote-banner")?.textContent,
          err: document.querySelector(".error-line")?.textContent,
          status: document.querySelector(".status-turn")?.textContent,
          url: location.href,
        }));
        console.error("host state after guest left", dump);
        return false;
      });
    if (!left) throw new Error("Host did not notice guest disconnect");
    const hostAfterLeft = await host.evaluate(() => ({
      banner: document.querySelector(".remote-banner")?.textContent,
      err: document.querySelector(".error-line")?.textContent,
    }));
    console.log("host after leave", hostAfterLeft);
    if (
      !(hostAfterLeft.banner || "").includes("waiting for rejoin") &&
      !(hostAfterLeft.err || "").includes("waiting to rejoin")
    ) {
      throw new Error("Host tore down instead of waiting for rejoin");
    }
    console.log("host waiting for rejoin");

    // Guest rejoins via same link
    guest = await guestCtx.newPage();
    await guest.goto(`${BASE}?room=${room}`);
    await waitEngine(guest);
    await guest.waitForSelector(".play", { timeout: 45000 });
    await host.waitForFunction(
      () =>
        document.querySelector(".net-status, .remote-banner") &&
        !(document.querySelector(".remote-banner")?.textContent || "").includes(
          "waiting for rejoin",
        ) &&
        (document.querySelector(".error-line")?.textContent || "").trim() === "",
      null,
      { timeout: 45000 },
    );

    const hostFen = (await host.locator(".fen-box").innerText()).trim();
    const guestFen = (await guest.locator(".fen-box").innerText()).trim();
    const guestBanner = await guest.locator(".remote-banner").innerText();

    if (hostFen !== guestFen) {
      throw new Error(`FEN mismatch host=${hostFen} guest=${guestFen}`);
    }
    if (!hostFen.includes("b") && !/ b /.test(` ${hostFen} `)) {
      // FEN side-to-move should be black after 1.e4
      if (!hostFen.split(" ")[1]?.includes("b")) {
        console.warn("unexpected side to move in", hostFen);
      }
    }
    if (!/black/i.test(guestBanner)) {
      throw new Error(`Guest banner not Black: ${guestBanner}`);
    }
    if (hostFen !== fenAfterMove.trim()) {
      throw new Error(`Position reset on rejoin: was ${fenAfterMove.trim()} now ${hostFen}`);
    }

    console.log("OK — rejoined with matching FEN");
    console.log("guest banner:", guestBanner.trim());
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
