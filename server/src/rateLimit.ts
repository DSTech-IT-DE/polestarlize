import type { MiddlewareHandler } from 'hono';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  /** Sustained requests per minute; also the burst size. */
  perMinute: number;
  /** Resolves the client key (IP address) of a request. */
  keyOf: (c: Parameters<MiddlewareHandler>[0]) => string;
  now?: () => number;
}

/** In-memory token bucket per client. Good enough for a single-process self-hosted server. */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;
  const refillPerMs = options.perMinute / 60_000;
  let lastSweep = now();

  return async (c, next) => {
    const t = now();
    // Drop idle buckets now and then so the map cannot grow without bound.
    if (t - lastSweep > 60_000) {
      lastSweep = t;
      for (const [key, bucket] of buckets) if (t - bucket.updatedAt > 120_000) buckets.delete(key);
    }

    const key = options.keyOf(c);
    const bucket = buckets.get(key) ?? { tokens: options.perMinute, updatedAt: t };
    bucket.tokens = Math.min(options.perMinute, bucket.tokens + (t - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = t;
    buckets.set(key, bucket);

    if (bucket.tokens < 1) {
      const retryAfter = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests' }, 429);
    }
    bucket.tokens -= 1;
    await next();
  };
}
