// @ts-check
import process from "node:process";
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vercel from "@astrojs/vercel";

// Vercel needs its Build Output API layout for static pages and the signup function.
// Keep the standalone Node adapter for the existing local production preview.
export default defineConfig({
  output: "static",
  adapter: process.env.VERCEL === "1" ? vercel() : node({ mode: "standalone" }),
  build: { inlineStylesheets: "auto" },
  devToolbar: { enabled: false },
});
