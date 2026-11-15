/**
 * Ballistic Workbench - local static server for development and local use.
 * Run with: npm start   (or: node scripts/serve.mjs [port])
 *
 * Why not `python3 -m http.server`: it accepts only 5 queued connections, and the app loads ~30
 * JavaScript modules in parallel, so some requests are reset and the app fails to start.
 * This server has no dependencies, serves only files inside the repo, and binds to localhost.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(ROOT, pathname);
  // Only files inside the repo, never dotfiles (.git, .env) or node_modules
  if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])(\.|node_modules)/.test(path.relative(ROOT, file))) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ballistic Workbench running at http://localhost:${PORT}/  (Ctrl+C to stop)`);
});
