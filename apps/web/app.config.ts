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
  },
});
