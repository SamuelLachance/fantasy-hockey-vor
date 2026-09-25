/**
 * Dev-only static server that behaves like GitHub Pages for `out/`, to try
 * the export before merging: the basePath, `/x` → `x.html` (even when a
 * directory `x/` exists), `/x/` → `x/index.html` or the 404 page, the 404
 * page served with status 404, and file names with `$` or other encoded
 * characters (per-segment payloads).
 *
 * Usage: GITHUB_PAGES=true npm run build:pages && GITHUB_PAGES=true npx tsx scripts/serve-pages.ts
 * (PORT=4190 by default; without GITHUB_PAGES the site is served at the root.)
 */
import { createReadStream, existsSync, statSync } from "fs";
import { createServer } from "http";
import { extname, join, normalize } from "path";

const OUT = join(process.cwd(), "out");
const BASE = process.env.GITHUB_PAGES === "true" ? "/fantasy-hockey-vor" : "";
const PORT = Number(process.env.PORT ?? 4190);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

function resolveFile(urlPath: string): string | null {
  const safe = normalize(join(OUT, urlPath));
  if (!safe.startsWith(OUT)) return null;
  if (urlPath.endsWith("/")) {
    const index = join(safe, "index.html");
    return isFile(index) ? index : null;
  }
  if (isFile(safe)) return safe;
  if (isFile(`${safe}.html`)) return `${safe}.html`;
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  const send = (file: string, status: number) => {
    res.writeHead(status, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  };
  const notFound = () => send(join(OUT, "404.html"), 404);

  if (BASE) {
    if (path === BASE) {
      res.writeHead(301, { location: `${BASE}/${url.search}` });
      res.end();
      return;
    }
    if (!path.startsWith(`${BASE}/`)) return notFound();
    path = path.slice(BASE.length);
  }
  const file = resolveFile(path);
  if (!file) return notFound();
  send(file, 200);
}).listen(PORT, () => {
  console.log(`Serving out/ like GitHub Pages at http://localhost:${PORT}${BASE}/`);
});
