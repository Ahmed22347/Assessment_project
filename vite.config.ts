/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_DEV_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Dev-only shim that serves api/*.ts the way Vercel's Node runtime does
 * (parsed JSON body, res.status().json()), so `npm run dev` works without `vercel dev`.
 */
function localApi(): Plugin {
  return {
    name: 'local-vercel-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!/^[a-z-]+$/.test(name)) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_DEV_BODY_BYTES) {
              res.statusCode = 413;
              return res.end(JSON.stringify({ error: 'Request body too large' }));
            }
            chunks.push(chunk as Buffer);
          }
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: unknown = undefined;
          if (raw) {
            try { body = JSON.parse(raw); } catch { body = raw; }
          }
          const vreq = Object.assign(req, { body, query: Object.fromEntries(new URL(req.url ?? '', 'http://x').searchParams) });
          const vres = Object.assign(res, {
            status(code: number) { res.statusCode = code; return vres; },
            json(data: unknown) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return vres; },
          });
          await mod.default(vreq, vres);
        } catch (err) {
          server.config.logger.error(String(err));
          if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: 'Dev API error' })); }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load ALL vars (not just VITE_) into process.env for the dev API shim only; they are never injected into client code.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [react(), tailwindcss(), localApi()],
    test: { include: ['tests/**/*.test.ts'] },
  };
});
