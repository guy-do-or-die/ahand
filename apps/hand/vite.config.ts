import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { ahandConfig, cacheDir, conditions, isLocalChain, outDir } from "./vite.shared.ts";

// The main build: index.html (the app) and gallery.html (the kit). exit.html is the second build
// (vite.exit.config.ts), written into the same folder afterwards; in dev Vite serves all three.
export default defineConfig({
  plugins: [ahandConfig(), react(), tailwindcss()],
  resolve: { conditions },
  // routes.ts reads it; with false the local-only screens are dead code and never emitted.
  define: { __AHAND_LOCAL__: JSON.stringify(isLocalChain()) },
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
