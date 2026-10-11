import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = await realpath(resolve("apps/dashboard/dist"));
const upstream = new URL(process.env.HUNCH_API_URL ?? "http://127.0.0.1:8787");
if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error("HUNCH_API_URL must be an HTTP(S) origin without credentials.");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/v1/") || url.pathname === "/health") {
      const headers = { accept: "application/json" };
      for (const name of ["content-type", "origin", "x-hunch-mock-session"]) if (req.headers[name]) headers[name] = req.headers[name];
      if (process.env.HUNCH_DEMO_PROXY_TOKEN) headers.authorization = `Bearer ${process.env.HUNCH_DEMO_PROXY_TOKEN}`;
      const proxy = (upstream.protocol === "https:" ? httpsRequest : httpRequest)(new URL(url.pathname + url.search, upstream), { method: req.method, headers, timeout: 30000 }, response => {
        res.writeHead(response.statusCode ?? 502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.pipe(res);
      });
      proxy.on("timeout", () => proxy.destroy());
      proxy.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(JSON.stringify({ error: "Hunch API unavailable. Check the market before retrying an operation." })); });
      req.pipe(proxy);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    let file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    try { if (!(await stat(file)).isFile()) file = resolve(root, "index.html"); } catch { if (extname(file)) { res.writeHead(404); res.end(); return; } file = resolve(root, "index.html"); }
    const canonical = await realpath(file);
    if (!canonical.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=3600", "x-content-type-options": "nosniff" });
    if (req.method === "HEAD") res.end(); else createReadStream(file).pipe(res);
  } catch { res.writeHead(400); res.end("Invalid request"); }
});
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1", () => console.log("Hunch app server ready; frontend and API share one origin."));
