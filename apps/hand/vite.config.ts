import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { ahandConfig, cacheDir, conditions, cspMeta, isLocalChain, outDir, previewHeaders, workspaceAlias } from "./vite.shared.ts";

// The main build: index.html (the app) and, in local builds only, gallery.html (the kit, ARCHITECTURE
// §7). exit.html is the second build (vite.exit.config.ts), written into the same folder afterwards;
// in dev Vite serves all three. isLocalChain() throws for chain.local on any chain but 31337.
const local = isLocalChain();

export default defineConfig({
  plugins: [ahandConfig(), react(), tailwindcss(), cspMeta()],
  resolve: { conditions, alias: workspaceAlias },
  // routes.ts reads it; with false the local-only screens are dead code and never emitted.
  define: { __AHAND_LOCAL__: JSON.stringify(local) },
  cacheDir,
  // `vite preview` serves the build with the same headers as face (ARCHITECTURE §11).
  preview: { headers: previewHeaders() },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        ...(local ? { gallery: resolve(import.meta.dirname, "gallery.html") } : {}),
      },
    },
  },
});
