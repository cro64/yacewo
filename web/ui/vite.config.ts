import { defineConfig } from "vite";

export default defineConfig({
  // Project GitHub Pages: username.github.io/yacewo/
  base: "/yacewo/",
  publicDir: "public",
  build: {
    outDir: "../../docs",
    emptyOutDir: true,
  },
});
