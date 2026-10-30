// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// The page is prerendered to static HTML. Only /api/waitlist runs on demand, so the
// adapter can be swapped for the chosen host (Vercel, Netlify, Cloudflare...) without
// touching the page.
export default defineConfig({
  output: "static",
  adapter: node({ mode: "standalone" }),
  build: { inlineStylesheets: "auto" },
  devToolbar: { enabled: false },
});
