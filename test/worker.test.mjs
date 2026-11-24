import assert from "node:assert/strict";
import test from "node:test";
import worker, { createWorker } from "../lib/worker.mjs";

const base = "https://chatppt.example";
const pages = "https://hrafnir.github.io";
const message = { messages: [{ role: "user", content: "Kan vi få flere lærebøker?" }] };

function post(body, headers = {}) {
  return new Request(base + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: pages, ...headers },
    body, duplex: "half",
  });
}

test("the Sites entry point identifies the API and points visitors to the published chat", async () => {
  const health = await worker.fetch(new Request(base + "/health"), {});
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { service: "ChatPPT API", status: "ok", frontend: pages + "/ChatPPT/" });
  const home = await worker.fetch(new Request(base + "/"), {});
  assert.match(await home.text(), /href="https:\/\/hrafnir.github.io\/ChatPPT\/"/);
  assert.equal((await worker.fetch(new Request(base + "/missing"), {})).status, 404);
});

test("a Pages browser can read preflight, missing key and invalid body responses", async () => {
  const configured = { CHATPPT_ALLOWED_ORIGIN: pages };
  const preflight = await worker.fetch(new Request(base + "/api/chat", {
    method: "OPTIONS", headers: { Origin: pages, "Access-Control-Request-Method": "POST" },
  }), configured);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), pages);
  assert.equal(preflight.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  for (const [body, status] of [[JSON.stringify(message), 503], ["{", 400]]) {
    const res = await worker.fetch(post(body), configured);
    assert.equal(res.status, status);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), pages);
    assert.ok((await res.json()).error);
  }
  const denied = await worker.fetch(post("{}", { Origin: pages + ".example.org" }), configured);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

test("worker limits chunked requests and cancels the unread body without contacting OpenAI", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(33_000)); },
    cancel() { cancelled = true; },
  });
  const res = await worker.fetch(post(body), {});
  assert.equal(res.status, 413);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), pages);
  assert.ok(cancelled);
});

test("the worker takes its key and model from Sites bindings and retains limits across calls", async () => {
  const env = { OPENAI_API_KEY: "worker-fixture", OPENAI_MODEL: "model-fixture", CHATPPT_DAILY_LIMIT: "1" };
  let sent;
  const api = createWorker({
    fetchImpl: async (url, init) => {
      sent = { keyHeader: init.headers.Authorization, request: JSON.parse(init.body) };
      return Response.json({ status: "completed", output: [{ type: "message", content: [{
        type: "output_text", text: JSON.stringify({ modus: "satire", veiledning: null, svar: "Bokbehovet tas opp på neste møte." }),
      }] }] });
    },
  });
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const ok = await api.fetch(post(stream), env);
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).reply, /PLO/);
  assert.deepEqual(sent.request.input, message.messages);
  assert.equal(sent.request.model, env.OPENAI_MODEL);
  assert.equal(sent.keyHeader, "Bearer " + env.OPENAI_API_KEY);
  const limit = await api.fetch(post(JSON.stringify(message)), env);
  assert.equal(limit.status, 429);
  assert.equal(limit.headers.get("Access-Control-Allow-Origin"), pages);
});
