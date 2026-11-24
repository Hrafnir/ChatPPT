import { Readable } from "node:stream";
import { createWorker } from "./worker.mjs";

function requestBody(req) {
  if (req.method !== "POST") return undefined;
  if (req.body !== undefined) {
    return typeof req.body === "string" || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
  }
  // A size-limit rejection may cancel the Web stream. Keep the HTTP socket open to send the 413.
  return Readable.toWeb(Readable.from(req.iterator({ destroyOnReturn: false })));
}

export function createChatHandler({ env = process.env, fetchImpl, now } = {}) {
  const worker = createWorker({ fetchImpl, now });
  return async function chat(req, res) {
    try {
      const scheme = req.socket?.encrypted ? "https" : "http";
      const url = new URL("/api/chat", scheme + "://" + req.headers.host);
      const headers = new Headers();
      for (const key of ["origin", "content-type", "content-length"]) {
        if (req.headers[key] !== undefined) headers.set(key, req.headers[key]);
      }
      headers.set("CF-Connecting-IP", req.socket?.remoteAddress || "unknown");
      const request = new Request(url, { method: req.method, headers, body: requestBody(req), duplex: "half" });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Forespørselen kunne ikke leses. Prøv igjen." }));
    } finally {
      req.resume();
    }
  };
}
