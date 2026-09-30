import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { rateLimit } from './rateLimit.ts';
import { staticHandler } from './static.ts';
import { Store, VaultLimitError, vaultKey } from './store.ts';
import { isUuid, LIMITS, parseSyncRequest, ValidationError } from './validation.ts';

export interface AppOptions {
  store: Store;
  version: string;
  /** Directory of the built web app; omitted = API only. */
  staticDir?: string;
  /** Origins allowed to call the API from a browser. Empty = CORS disabled. */
  corsOrigins?: string[];
  /** Trust the last X-Forwarded-For entry as client address (behind a reverse proxy). */
  trustProxy?: boolean;
  syncEnabled?: boolean;
  /** Requests per minute and client on /api. */
  rateLimitPerMinute?: number;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // ECharts and MapLibre set inline styles at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "font-src 'self' data: https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    // The last entry is the one appended by our own proxy; earlier ones can be forged.
    const last = forwarded?.split(',').pop()?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createApp(options: AppOptions): Hono {
  const { store, version } = options;
  const syncEnabled = options.syncEnabled ?? true;
  const app = new Hono();

  app.use(async (c, next) => {
    await next();
    c.res.headers.set('Content-Security-Policy', CSP);
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });
  app.use(compress());

  const api = new Hono();
  if (options.corsOrigins && options.corsOrigins.length > 0) {
    api.use(
      cors({
        origin: options.corsOrigins,
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: 600,
      }),
    );
  }
  api.use(rateLimit({ perMinute: options.rateLimitPerMinute ?? 120, keyOf: (c) => clientAddress(c, options.trustProxy ?? false) }));
  api.use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  api.get('/health', (c) => c.json({ status: 'ok', version, sync: syncEnabled }));

  if (syncEnabled) {
    const authenticate = (c: Context): string | null => {
      const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
      return match && isUuid(match[1]) ? vaultKey(match[1]) : null;
    };

    api.post(
      '/sync',
      bodyLimit({
        maxSize: LIMITS.maxBodyBytes,
        onError: (c) => c.json({ error: 'Request body too large' }, 413),
      }),
      async (c) => {
        const key = authenticate(c);
        if (!key) return c.json({ error: 'Missing or invalid Authorization: Bearer <uuid>' }, 401);
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json({ error: 'Body is not valid JSON' }, 400);
        }
        try {
          return c.json(store.sync(key, parseSyncRequest(body)));
        } catch (error) {
          if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
          if (error instanceof VaultLimitError) return c.json({ error: error.message }, 413);
          throw error;
        }
      },
    );

    api.delete('/vault', (c) => {
      const key = authenticate(c);
      if (!key) return c.json({ error: 'Missing or invalid Authorization: Bearer <uuid>' }, 401);
      return c.json({ deleted: store.deleteVault(key) });
    });
  }

  api.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.route('/api/v1', api);
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  if (options.staticDir) {
    const serve = staticHandler(options.staticDir);
    app.on(['GET', 'HEAD'], '*', serve);
  }

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Internal server error' }, 500);
  });
  return app;
}
