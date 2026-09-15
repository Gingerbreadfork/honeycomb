import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const host = process.env.TAURI_DEV_HOST;

/** Dev-only bridge: POST JS to /__eval (header x-profile picks the instance) and it runs inside that app page. */
function evalBridge(): Plugin {
  return {
    name: 'honeycomb-eval-bridge',
    apply: 'serve',
    configureServer(server) {
      const pending = new Map<string, (r: unknown) => void>();
      server.ws.on('honeycomb:result', (data: { id: string }) => {
        pending.get(data.id)?.(data);
        pending.delete(data.id);
      });
      server.middlewares.use('/__eval', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const id = Math.random().toString(36).slice(2);
          const profile = String(req.headers['x-profile'] ?? '');
          const timer = setTimeout(() => {
            pending.delete(id);
            res.statusCode = 504;
            res.end('timeout');
          }, 120000);
          pending.set(id, (r) => {
            clearTimeout(timer);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(r));
          });
          server.ws.send('honeycomb:eval', { id, code: body, profile });
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), evalBridge()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'safari15',
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
