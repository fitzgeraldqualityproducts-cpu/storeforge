import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "fixtures", "site");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".txt": "text/plain",
  ".heic": "image/heic",
};

export interface FixtureServer {
  origin: string;
  hostPort: string;
  close: () => Promise<void>;
}

/**
 * Serves tests/fixtures/site plus a few special routes:
 *  /redirect-private   → 302 to http://10.0.0.5/ (must be rejected)
 *  /redirect-metadata  → 302 to http://169.254.169.254/latest/meta-data/ (must be rejected)
 *  /redirect-ok        → 302 to /product.html
 *  /products/<handle>  → <handle>.html  (Shopify-style storefront path)
 *  /fake-image.jpg     → HTML served with an image content type (magic-byte check)
 *  /blocked            → 403 with a CAPTCHA body
 */
export async function startFixtureServer(port = 0): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture.local");
    const p = url.pathname;
    if (p === "/redirect-private")
      return void res.writeHead(302, { Location: "http://10.0.0.5/" }).end();
    if (p === "/redirect-metadata")
      return void res
        .writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" })
        .end();
    if (p === "/redirect-ok") return void res.writeHead(302, { Location: "/product.html" }).end();
    if (p === "/fake-image.jpg")
      return void res
        .writeHead(200, { "Content-Type": "image/jpeg" })
        .end("<html>not an image</html>");
    if (p === "/blocked") {
      res.writeHead(403, { "Content-Type": "text/html" });
      return void createReadStream(path.join(ROOT, "captcha.html")).pipe(res);
    }
    let file = path.join(ROOT, p === "/" ? "product.html" : p);
    if (/^\/products\/[a-z0-9-]+$/.test(p)) file = path.join(ROOT, `${p}.html`);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return void res.end("not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${actual}`,
    hostPort: `127.0.0.1:${actual}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (process.argv[1] && process.argv[1].endsWith("fixture-server.ts")) {
  const port = Number(process.env.FIXTURE_PORT ?? 4555);
  void startFixtureServer(port).then((s) => console.log(`Fixture site on ${s.origin}`));
}
