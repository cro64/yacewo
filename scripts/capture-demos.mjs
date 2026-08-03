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
    () => typeof window.Yacewo !== "undefined" || document.querySelector(".mode-btn"),
    null,
    { timeout: 30000 },
  );
  // Allow engine script load + first paint
  await page.waitForTimeout(800);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // 1) Landing
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitEngine(page);
  await page.evaluate(() => {
    localStorage.setItem("yacewo-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
  await page.reload({ waitUntil: "networkidle" });
  await waitEngine(page);
  await page.screenshot({
    path: path.join(OUT, "landing.png"),
    fullPage: false,
  });

  // 2) Classical play mid-opening
  await page.getByRole("button", { name: /Classical/i }).click();
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForSelector(".board");
  await page.waitForTimeout(400);
  // e2 -> e4 via clicks
  await page.locator('[data-sq="e2"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-sq="e4"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-sq="e7"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-sq="e5"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-sq="g1"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-sq="f3"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(OUT, "classical.png"),
    fullPage: false,
  });

  // 3) Anarchy with fixed seed
  await page.getByRole("button", { name: /New game/i }).click();
  await page.waitForSelector(".landing-hero");
  await page.getByRole("button", { name: /Anarchy/i }).click();
  await page.fill("#seed", "42");
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForSelector(".board");
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, "anarchy.png"),
    fullPage: false,
  });

  // 4) Short demo video (opening moves on classical)
  await page.getByRole("button", { name: /New game/i }).click();
  await page.waitForSelector(".landing-hero");
  const videoContext = await browser.newContext({
    viewport: { width: 1100, height: 780 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1100, height: 780 } },
  });
  const vpage = await videoContext.newPage();
  await vpage.goto(BASE, { waitUntil: "networkidle" });
  await vpage.evaluate(() => {
    localStorage.setItem("yacewo-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
  await vpage.reload({ waitUntil: "networkidle" });
  await waitEngine(vpage);
  await vpage.waitForTimeout(600);
  await vpage.getByRole("button", { name: /^Play$/i }).click();
  await vpage.waitForSelector(".board");
  await vpage.waitForTimeout(500);
  for (const [from, to] of [
    ["e2", "e4"],
    ["e7", "e5"],
    ["g1", "f3"],
    ["b8", "c6"],
  ]) {
    await vpage.locator(`[data-sq="${from}"]`).click();
    await vpage.waitForTimeout(280);
    await vpage.locator(`[data-sq="${to}"]`).click();
    await vpage.waitForTimeout(450);
  }
  await vpage.waitForTimeout(800);
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

  console.log("Wrote:");
  for (const f of ["landing.png", "classical.png", "anarchy.png", "demo.webm", "demo.gif"]) {
    const p = path.join(OUT, f);
    if (fs.existsSync(p)) console.log(`  ${f} (${fs.statSync(p).size} bytes)`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
