import react from "@vitejs/plugin-react"

import { defineConfig } from "vite"


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
  plugins: [
    react(),
    customResolverPlugin(),
  ],
  server: {
    middlewares: [
      {
        name: 'handle-api-requests',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url?.startsWith('/api/')) {
              if (req.method === 'GET' && req.url === '/api/hello') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Hello, World!' }));
                return;
              }
              
              if (req.method === 'POST' && req.url === '/api/echo') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk.toString();
                });
                req.on('end', () => {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(body);
                });
                return;
              }
              
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not Found' }));
              return;
            }

            next();
          });
        },
      },
    ],
  },
}));
