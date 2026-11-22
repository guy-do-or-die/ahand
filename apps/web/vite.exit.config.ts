import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

import { ahandConfig, cacheDir, conditions, cssTarget, outDir, workspaceAlias } from "./vite.shared.ts";

// exit.html: one self-contained file (scripts, styles and fonts inlined) that still moves money
// when the site is gone. Built after the main build into the same folder, so it must not empty it.
export default defineConfig({
  plugins: [ahandConfig(), tailwindcss(), viteSingleFile()],
  resolve: { conditions, alias: workspaceAlias },
  cacheDir,
  build: {
    outDir,
    emptyOutDir: false,
    cssTarget,
    rollupOptions: {
      input: resolve(import.meta.dirname, "exit.html"),
    },
  },
});
