import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { Store } from './store.ts';

function readVersion(): string {
  // src/ and dist/ both sit one level below the server package, which sits one level below the repo root.
  for (const relative of ['../../package.json', '../package.json']) {
    try {
      const parsed = JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // Try the next candidate.
    }
  }
  return 'unknown';
}

const flag = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === '' ? fallback : !['0', 'false', 'no', 'off'].includes(value.toLowerCase());

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const staticDir = resolve(process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)));
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const store = new Store(resolve(dataDir, 'polestarlize.sqlite'));
const app = createApp({
  store,
  version: readVersion(),
  staticDir,
  corsOrigins,
  trustProxy: flag(process.env.TRUST_PROXY, false),
  syncEnabled: flag(process.env.SYNC_ENABLED, true),
});

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`polestarlize listening on http://${info.address}:${info.port} (data: ${dataDir}, static: ${staticDir})`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  (server as Server).closeIdleConnections();
  // Keep-alive connections can hold the server open; do not wait for them forever.
  setTimeout(() => {
    store.close();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
