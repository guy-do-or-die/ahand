import { defineConfig } from "@tanstack/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    build: {
      target: "es2022",
    },
    server: {
      allowedHosts: true,
    },
    optimizeDeps: {
      // XMTP ships WASM that vite's prebundler corrupts; keep it out —
      // but prebundle its bare imports up front, or vite discovers them on
      // the first send and mid-session re-optimization races in-flight
      // requests ("Cannot set headers after they are sent").
      exclude: ["@xmtp/wasm-bindings", "@xmtp/browser-sdk"],
      include: ["@xmtp/browser-sdk > @xmtp/content-type-primitives", "viem/accounts"],
    },
  },
});
