import { defineConfig } from "vitest/config";

// Unit tests only. Test files live next to the code (src/**/*.test.ts) and are
// never imported by pages, so Astro's build does not bundle them.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
