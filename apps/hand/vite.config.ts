import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { ahandConfig, cacheDir, conditions, outDir } from "./vite.shared.ts";

// The main build: index.html (the app) and gallery.html (the kit). exit.html is the second build
// (vite.exit.config.ts), written into the same folder afterwards; in dev Vite serves all three.
export default defineConfig({
  plugins: [ahandConfig(), react(), tailwindcss()],
  resolve: { conditions },
  cacheDir,
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        gallery: resolve(import.meta.dirname, "gallery.html"),
      },
    },
  },
});
