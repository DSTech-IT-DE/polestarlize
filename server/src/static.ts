import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

function send(c: Context, path: string, size: number, cache: string): Response {
  const body = c.req.method === 'HEAD' ? null : (Readable.toWeb(createReadStream(path)) as ReadableStream);
  return new Response(body, {
    headers: {
      'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(size),
      'Cache-Control': cache,
    },
  });
}

/** Serves the built SPA: hashed assets are immutable, index.html is always revalidated. */
export function staticHandler(rootDir: string) {
  const root = resolve(rootDir);
  return async (c: Context): Promise<Response> => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text('Bad request', 400);
    }
    const target = normalize(join(root, pathname));
    if (target !== root && !target.startsWith(root + sep)) return c.text('Not found', 404);

    const indexPath = join(root, 'index.html');
    if (pathname !== '/' && !pathname.endsWith('/')) {
      const size = await fileSize(target);
      if (size !== null) {
        const hashed = pathname.startsWith('/assets/');
        return send(c, target, size, hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      }
      // A missing file with an extension is a real 404, anything else is an SPA route.
      if (extname(pathname)) return c.text('Not found', 404);
    }
    const size = await fileSize(indexPath);
    if (size === null) return c.text('The web app has not been built (STATIC_DIR).', 404);
    return send(c, indexPath, size, 'no-cache');
  };
}
