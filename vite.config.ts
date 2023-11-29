import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";


function customResolverPlugin() {
  return {
    name: 'custom-resolver',
    resolveId(source) {
      if (source === 'process') {
        const possiblePaths = ['process/browser', 'process/'];

        for (const p of possiblePaths) {
          const resolvedPath = path.resolve('node_modules', p);

          if (fs.existsSync(resolvedPath)) {
            return resolvedPath;
          }
        }
      }
      return null;
    }
  };
}

export default defineConfig(({ command }) => ({
  define: {
    global: (() => {
      if (command !== "build") return "globalThis";

      let globalVariable = "globalThis";

      try {
        require.resolve("@safe-global/safe-apps-provider");
        require.resolve("@safe-global/safe-apps-sdk");
        globalVariable = "global";
      } catch (e) {
        globalVariable = "globalThis";
      }
      return globalVariable;
    })(),
  },
  plugins: [react(), customResolverPlugin()],
}));
