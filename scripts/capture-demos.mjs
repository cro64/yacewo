import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "images");
const BASE = process.env.YACEWO_URL || "http://127.0.0.1:4173/yacewo/";

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
  await page.waitForTimeout(800);
}

async function forceLight(page) {
  await page.evaluate(() => {
    localStorage.setItem("yacewo-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
}

async function gotoFresh(page) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await forceLight(page);
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // 1) Landing — Classical / Anarchy + remote actions
  await gotoFresh(page);
  await page.screenshot({
    path: path.join(OUT, "landing.png"),
    fullPage: false,
  });

  // 2) Join Room panel on landing
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
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.join(OUT, "classical.png"),
    fullPage: false,
  });

  // 4) Anarchy with fixed seed
  await page.getByRole("button", { name: /New game/i }).click();
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

  // 5) Remote lobby — Create Room waiting + share link
  await page.getByRole("button", { name: /New game/i }).click();
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

  // 6) Short demo: landing → play opening
  const videoContext = await browser.newContext({
    viewport: { width: 1100, height: 780 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1100, height: 780 } },
  });
  const vpage = await videoContext.newPage();
  await gotoFresh(vpage);
  await vpage.waitForTimeout(500);
  await vpage.getByRole("button", { name: /^Play$/i }).click();
  await vpage.waitForSelector(".board");
  await vpage.waitForTimeout(400);
  await playMoves(vpage, [
    ["e2", "e4"],
    ["e7", "e5"],
    ["g1", "f3"],
    ["b8", "c6"],
    ["f1", "c4"],
  ]);
  await vpage.waitForTimeout(700);
  const videoPath = await vpage.video().path();
  await videoContext.close();

  const destWebm = path.join(OUT, "demo.webm");
  const destGif = path.join(OUT, "demo.gif");
  fs.renameSync(videoPath, destWebm);

  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      destWebm,
      "-vf",
      "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
      destGif,
    ],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) {
    console.warn("ffmpeg GIF conversion failed; install ffmpeg for README demo.gif");
    if (ff.stderr) console.warn(ff.stderr.slice(-400));
  }

  const files = [
    "landing.png",
    "classical.png",
    "anarchy.png",
    "remote-join.png",
    "remote-lobby.png",
    "demo.webm",
    "demo.gif",
  ];
  console.log("Wrote:");
  for (const f of files) {
    const p = path.join(OUT, f);
    if (fs.existsSync(p)) console.log(`  ${f} (${fs.statSync(p).size} bytes)`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
