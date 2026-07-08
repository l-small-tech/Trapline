/**
 * Serves the web UI from assets embedded in the standalone executable.
 *
 * Node SEA offers getAsset(key) but no way to enumerate assets, so the
 * build script (scripts/build-sea.mjs) embeds a `web-manifest.json` asset
 * listing every web asset key (paths like "web/index.html",
 * "web/assets/index-abc.js"). Replaces @fastify/static, which needs a real
 * directory on disk.
 */
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { getAsset, getAssetText } from '../sea.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** "/trapline/assets/x.js" → "web/assets/x.js", or null if outside the UI. */
export function urlToAssetKey(url: string, basePath: string): string | null {
  const pathname = url.split('?', 1)[0]!.split('#', 1)[0]!;
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice(basePath.length)).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (rel === '') rel = 'index.html';
  // Normalize and refuse anything that escapes the web root.
  const normalized = path.posix.normalize(rel);
  if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) return null;
  return `web/${normalized}`;
}

export async function registerEmbeddedStatic(app: FastifyInstance, basePath: string): Promise<void> {
  const manifest = new Set(JSON.parse(getAssetText('web-manifest.json')) as string[]);
  const cache = new Map<string, Buffer>();
  const load = (key: string): Buffer => {
    let buf = cache.get(key);
    if (!buf) {
      buf = getAsset(key);
      cache.set(key, buf);
    }
    return buf;
  };

  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(404).send({ error: 'not found' });
    }
    if (req.url.startsWith(`${basePath}/api/`)) {
      return reply.code(404).send({ error: 'not found' });
    }
    const key = urlToAssetKey(req.url, basePath);
    if (key === null) return reply.code(404).send({ error: 'not found' });

    if (manifest.has(key)) {
      const ext = path.posix.extname(key).toLowerCase();
      // Vite emits content-hashed filenames under assets/ — cache those hard.
      const immutable = key.startsWith('web/assets/');
      return reply
        .type(MIME[ext] ?? 'application/octet-stream')
        .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
        .send(load(key));
    }
    // SPA fallback: any other GET under the base path serves the app shell.
    return reply.type(MIME['.html']!).header('cache-control', 'no-cache').send(load('web/index.html'));
  });
}
