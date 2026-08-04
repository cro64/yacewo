import { chromium, devices } from "playwright";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "images");
const BASE = process.env.YACEWO_URL || "http://127.0.0.1:5173/yacewo/";

async function waitEngine(page) {
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector(".play-btn") ||
          document.querySelector(".landing-hero") ||
          document.querySelector(".board"),
      ),
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(600);
}

async function setTheme(page, theme) {
  await page.evaluate((mode) => {
    localStorage.setItem("yacewo-theme", mode);
    document.documentElement.dataset.theme = mode;
  }, theme);
}

async function gotoFresh(page, url = BASE, theme = "light") {
  await page.goto(url, { waitUntil: "networkidle" });
  await setTheme(page, theme);
  await page.reload({ waitUntil: "networkidle" });
  await waitEngine(page);
}

async function playMoves(page, moves) {
  for (const [from, to] of moves) {
    await page.locator(`[data-sq="${from}"]`).click();
    await page.waitForTimeout(160);
    await page.locator(`[data-sq="${to}"]`).click();
    await page.waitForTimeout(280);
  }
}

function withQuery(query) {
  const u = new URL(BASE);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}

function webmToGif(webm, gif, scale = 720) {
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      webm,
      "-vf",
      `fps=12,scale=${scale}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`,
      gif,
    ],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) {
    console.warn(`ffmpeg failed for ${path.basename(gif)}`);
    if (ff.stderr) console.warn(ff.stderr.slice(-400));
    return false;
  }
  return true;
}

async function finalizeVideo(context, destWebm, destGif, scale = 720) {
  const pages = context.pages();
  const page = pages[0];
  const videoPath = await page.video().path();
  await context.close();
  fs.renameSync(videoPath, destWebm);
  webmToGif(destWebm, destGif, scale);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ── Static screenshots (desktop) ─────────────────────────────────────
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // 1) Landing
  await gotoFresh(page);
  await page.screenshot({
    path: path.join(OUT, "landing.png"),
    fullPage: false,
  });

  // 2) Join Room panel
  await page.getByRole("button", { name: /Join Room/i }).click();
  await page.waitForSelector("#room");
  await page.fill("#room", "K7M2PQ");
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, "remote-join.png"),
    fullPage: false,
  });

  // 3) Classical mid-opening
  await page.locator('[data-mode="classical"]').click();
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForSelector(".board");
  await page.waitForTimeout(400);
  await playMoves(page, [
    ["e2", "e4"],
    ["e7", "e5"],
    ["g1", "f3"],
  ]);
  await page.getByRole("button", { name: /^Last move$/i }).click();
  await page.getByRole("button", { name: /^Coords$/i }).click();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.join(OUT, "classical.png"),
    fullPage: false,
  });

  // Light / dark theme pair (same mid-game position)
  await page.screenshot({
    path: path.join(OUT, "theme-light.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: /^Light$/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(OUT, "theme-dark.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: /^Dark$/i }).click();
  await page.waitForTimeout(200);

  // Grab FEN for later recovery showcase
  const midFen = await page.locator(".fen-box").innerText();

  // 4) Anarchy
  await page.getByRole("button", { name: /^Quit$/i }).click();
  await page.waitForSelector(".landing-hero");
  await page.locator('[data-mode="anarchy"]').click();
  await page.waitForSelector("#seed");
  await page.fill("#seed", "42");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForSelector(".board");
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, "anarchy.png"),
    fullPage: false,
  });

  // 5) Chess960
  await page.getByRole("button", { name: /^Quit$/i }).click();
  await page.waitForSelector(".landing-hero");
  await gotoFresh(page, withQuery({ mode: "chess960", seed: "518" }));
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForSelector(".board");
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, "chess960.png"),
    fullPage: false,
  });

  // 6) Horde
  await page.getByRole("button", { name: /^Quit$/i }).click();
  await page.waitForSelector(".landing-hero");
  await page.locator('[data-mode="horde"]').click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForSelector(".board");
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, "horde.png"),
    fullPage: false,
  });

  // 7) Queer easter egg
  await page.getByRole("button", { name: /^Quit$/i }).click();
  await page.waitForSelector(".landing-hero");
  await gotoFresh(page, withQuery({ mode: "dk" }));
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForSelector(".board");
  await page.waitForTimeout(400);
  await playMoves(page, [
    ["e2", "e4"],
    ["e7", "e5"],
  ]);
  await page.getByRole("button", { name: /^Last move$/i }).click();
  await page.locator('[data-sq="g1"]').click();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: path.join(OUT, "queer.png"),
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // 8) Remote lobby
  await page.getByRole("button", { name: /^Quit$/i }).click();
  await page.waitForSelector(".landing-hero");
  await page.locator('[data-mode="classical"]').click();
  await page.getByRole("button", { name: /Create Room/i }).click();
  await page.waitForSelector(".lobby-code", { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(OUT, "remote-lobby.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: /Cancel/i }).click();
  await page.waitForSelector(".landing-hero");

  // 9) FEN recovery — paste a mid-game FEN on landing, then Load
  await page.getByRole("button", { name: /^FEN$/i }).click();
  await page.waitForSelector("#fen");
  await page.fill("#fen", midFen.trim());
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.join(OUT, "fen-panel.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: /^Load$/i }).click();
  await page.waitForSelector(".board");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Last move$/i }).click().catch(() => {});
  await page.getByRole("button", { name: /^Coords$/i }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUT, "fen-load.png"),
    fullPage: false,
  });

  await context.close();

  // ── Mobile portrait fitting ──────────────────────────────────────────
  const iphone = devices["iPhone 13"];
  const mobileCtx = await browser.newContext({
    ...iphone,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileCtx.newPage();
  await gotoFresh(mobile);
  await mobile.waitForTimeout(400);
  await mobile.screenshot({
    path: path.join(OUT, "mobile-portrait.png"),
    fullPage: false,
  });
  await mobile.getByRole("button", { name: /^Play$/i }).click();
  await mobile.waitForSelector(".board");
  await mobile.waitForTimeout(500);
  await mobile.screenshot({
    path: path.join(OUT, "mobile-play.png"),
    fullPage: false,
  });
  await mobileCtx.close();

  // ── Rotate-to-portrait gate (landscape phone) ────────────────────────
  const rotateCtx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    recordVideo: { dir: OUT, size: { width: 844, height: 390 } },
  });
  const rotatePage = await rotateCtx.newPage();
  await rotatePage.goto(BASE, { waitUntil: "networkidle" });
  await setTheme(rotatePage, "light");
  await rotatePage.reload({ waitUntil: "networkidle" });
  await rotatePage.waitForSelector(".rotate-gate", { state: "visible", timeout: 10000 });
  // Let the phone icon animate through ~2 cycles
  await rotatePage.waitForTimeout(5200);
  await finalizeVideo(
    rotateCtx,
    path.join(OUT, "mobile-rotate.webm"),
    path.join(OUT, "mobile-rotate.gif"),
    560,
  );

  // ── Landing modes + Classical playthrough demo ───────────────────────
  const demoCtx = await browser.newContext({
    viewport: { width: 1100, height: 780 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1100, height: 780 } },
  });
  const vpage = await demoCtx.newPage();
  await gotoFresh(vpage);
  await vpage.waitForTimeout(700);
  // Cycle modes so the landing preview board animates
  for (const mode of ["anarchy", "chess960", "horde", "classical"]) {
    await vpage.locator(`[data-mode="${mode}"]`).click();
    await vpage.waitForTimeout(900);
  }
  await vpage.getByRole("button", { name: /^Play$/i }).click();
  await vpage.waitForSelector(".board");
  await vpage.waitForTimeout(450);
  await playMoves(vpage, [
    ["e2", "e4"],
    ["e7", "e5"],
    ["g1", "f3"],
    ["b8", "c6"],
    ["f1", "c4"],
    ["g8", "f6"],
  ]);
  await vpage.waitForTimeout(900);
  await finalizeVideo(
    demoCtx,
    path.join(OUT, "demo.webm"),
    path.join(OUT, "demo.gif"),
    720,
  );

  // ── Multiplayer: host lobby → guest joins → a few plies ──────────────
  const mpHostCtx = await browser.newContext({
    viewport: { width: 1100, height: 780 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1100, height: 780 } },
  });
  const mpGuestCtx = await browser.newContext({
    viewport: { width: 1100, height: 780 },
    deviceScaleFactor: 1,
  });
  const host = await mpHostCtx.newPage();
  const guest = await mpGuestCtx.newPage();

  await gotoFresh(host);
  await host.locator('[data-mode="classical"]').click();
  await host.getByRole("button", { name: /Create Room/i }).click();
  await host.waitForSelector(".lobby-code", { timeout: 20000 });
  await host.waitForTimeout(900);

  const room = await host.evaluate(() => {
    const m = location.search.match(/room=([2-9A-HJ-NP-Z]+)/i);
    if (m) return m[1].toUpperCase();
    const code = document.querySelector(".lobby-code")?.textContent?.trim();
    return code ? code.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "") : "";
  });
  if (!room) throw new Error("No room code for multiplayer demo");

  await gotoFresh(guest, withQuery({ room }));
  // Guest may land straight in lobby/play via ?room=
  await guest.waitForSelector(".board, .lobby-code, .landing-hero", {
    timeout: 20000,
  });
  // If still on landing with join UI, confirm join
  const joinBtn = guest.getByRole("button", { name: /Join/i });
  if (await joinBtn.isVisible().catch(() => false)) {
    await joinBtn.click();
  }
  await host.waitForSelector(".board", { timeout: 20000 });
  await guest.waitForSelector(".board", { timeout: 20000 });
  await host.waitForTimeout(700);

  // Host (White) and guest (Black) alternate
  await playMoves(host, [["e2", "e4"]]);
  await guest.waitForTimeout(400);
  await playMoves(guest, [["e7", "e5"]]);
  await host.waitForTimeout(350);
  await playMoves(host, [["g1", "f3"]]);
  await guest.waitForTimeout(350);
  await playMoves(guest, [["b8", "c6"]]);
  await host.waitForTimeout(800);

  await mpGuestCtx.close();
  await finalizeVideo(
    mpHostCtx,
    path.join(OUT, "multiplayer.webm"),
    path.join(OUT, "multiplayer.gif"),
    720,
  );

  const files = [
    "landing.png",
    "classical.png",
    "anarchy.png",
    "chess960.png",
    "horde.png",
    "queer.png",
    "remote-join.png",
    "remote-lobby.png",
    "theme-light.png",
    "theme-dark.png",
    "fen-panel.png",
    "fen-load.png",
    "mobile-portrait.png",
    "mobile-play.png",
    "mobile-rotate.gif",
    "demo.gif",
    "multiplayer.gif",
  ];
  console.log("Wrote:");
  for (const f of files) {
    const p = path.join(OUT, f);
    if (fs.existsSync(p)) console.log(`  ${f} (${fs.statSync(p).size} bytes)`);
    else console.warn(`  MISSING ${f}`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
