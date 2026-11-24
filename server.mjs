import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createChatHandler } from "./lib/chat.mjs";

const publicDir = fileURLToPath(new URL("./public/", import.meta.url));
const types = new Map(Object.entries({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
}));

function fail(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

export function createApp(options = {}) {
  const chat = createChatHandler(options);
  return createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      return fail(res, 400, "Ugyldig adresse.");
    }
    if (pathname === "/api/chat") return chat(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return fail(res, 405, "Metoden er ikke støttet.");
    }
    const path = pathname === "/" ? "/index.html" : pathname;
    const type = types.get(extname(path).toLowerCase());
    if (!type || /[:\\\x00]/.test(path) || path.split("/").some(part => part.startsWith("."))) {
      return fail(res, 404, "Filen finnes ikke.");
    }
    try {
      const root = await realpath(publicDir);
      const file = await realpath(resolve(root, "." + path));
      if (!file.startsWith(root + sep)) return fail(res, 404, "Filen finnes ikke.");
      const content = await readFile(file);
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": content.byteLength,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      fail(res, 404, "Filen finnes ikke.");
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "127.0.0.1";
  createApp().listen(port, host, () => console.log(`ChatPPT er klar på http://${host}:${port}/`));
}
