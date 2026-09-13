import { defineConfig } from "vite";

export default defineConfig({
  // Served from a project page on GitHub Pages, so asset URLs must be relative
  // to the repo subpath rather than the domain root.
  base: "./",
  server: {
    // Honour PORT so the harness can assign one; falls back to Vite's default.
    port: process.env.PORT ? Number(process.env.PORT) : 5273,
    host: true,
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
});
