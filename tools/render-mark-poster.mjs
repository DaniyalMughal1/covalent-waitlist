// Renders the hero's real scene at its exact arrival pose, with transparency, and writes
// src/assets/mark-poster.png. Re-run it whenever the geometry, pose or lighting changes,
// so the poster and the first frame stay the same picture.
//
//   WAITLIST_PROVIDER=test npx astro dev --port 4331
//   node tools/render-mark-poster.mjs http://localhost:4331
//
// Playwright is not a project dependency. Point PLAYWRIGHT_FROM at any folder that has it.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const origin = process.argv[2] ?? "http://localhost:4321";
const size = Number(process.argv[3] ?? 1280);
const out = fileURLToPath(new URL("../src/assets/mark-poster.png", import.meta.url));

const require = createRequire(process.env.PLAYWRIGHT_FROM ? `${process.env.PLAYWRIGHT_FROM}/` : import.meta.url);
const { chromium } = require("playwright");

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

await page.goto(new URL("/?mark-poster", origin).href, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.__markPoster === "function", null, { timeout: 60_000 });
const dataUrl = await page.evaluate((length) => window.__markPoster(length), size);
await browser.close();

await writeFile(out, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log(`Wrote ${out} at ${size}x${size}`);
