import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createChatHandler } from "../lib/chat.mjs";

const defaultEnv = { OPENAI_API_KEY: "fixture" };
const question = { role: "user", content: "Kopimaskinen er tom for toner." };

function modelResult(svar = "Innenfor PLO i klasserommet får hver elev tegne sin egen kopi.", modus = "satire") {
  return Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ svar, modus }) }] }],
  });
}

async function call(handler, { messages = [question], method = "POST", headers = {}, body, streamed = false } = {}) {
  const data = body === undefined ? { messages } : body;
  const req = Readable.from(streamed ? [Buffer.from(data)] : []);
  if (!streamed) req.body = data;
  req.method = method;
  req.headers = { host: "localhost:4173", "content-type": "application/json", ...headers };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = {
    headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [key, value] of Object.entries(headers)) this.setHeader(key, value);
    },
    end(body) { this.body = body && JSON.parse(body); },
  };
  await handler(req, res);
  return res;
}

test("sends a bounded multi-turn request to Responses and serves the model's actual text", async () => {
  const calls = [];
  const chat = createChatHandler({
    env: defaultEnv,
    fetchImpl: async (url, init) => {
      calls.push({ url, ...JSON.parse(init.body) });
      return modelResult();
    },
  });
  const messages = Array.from({ length: 11 }, (_, index) =>
    ({ role: index % 2 ? "assistant" : "user", content: "x".repeat(998) + index }));
  messages.push({ role: "assistant", content: "Hva har du prøvd?" }, question);
  const res = await call(chat, { body: JSON.stringify({ messages }), streamed: true });
  assert.equal(res.status, 200);
  assert.match(res.body.reply, /tegne sin egen kopi/);
  const [request] = calls;
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.model, "gpt-5.6-luna");
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, "none");
  assert.equal(request.max_output_tokens, 300);
  assert.deepEqual(request.input.at(-1), question);
  assert.deepEqual(request.input.at(-2), messages.at(-2));
  assert.equal(request.input[0].role, "user");
  assert.ok(request.input.length <= 8);
  assert.ok(request.input.reduce((sum, item) => sum + item.content.length, 0) <= 6000);
});

test("guarantees the satirical conclusion while keeping serious responses intact", async () => {
  const replies = [modelResult("Vi kan utvide tirsdagen med fem timer."), modelResult("Hent hjelp nå.", "alvor")];
  const chat = createChatHandler({ env: defaultEnv, fetchImpl: async () => replies.shift() });
  assert.match((await call(chat)).body.reply, /PLO.*klasserommet/);
  assert.deepEqual((await call(chat)).body, { reply: "Hent hjelp nå." });
});

test("requires a key, a valid last user message, allowed roles, bounded text and JSON", async () => {
  let calls = 0;
  const chat = createChatHandler({ env: {}, fetchImpl: () => { calls++; } });
  assert.equal((await call(chat)).status, 503);
  assert.equal((await call(chat, { messages: [] })).status, 400);
  assert.equal((await call(chat, { messages: [{ ...question, role: "assistant" }] })).status, 400);
  assert.equal((await call(chat, { messages: [{ ...question, role: "system" }, question] })).status, 400);
  assert.equal((await call(chat, { messages: [{ ...question, content: " ".repeat(12) }] })).status, 400);
  assert.equal((await call(chat, { messages: [{ ...question, content: "x".repeat(2001) }] })).status, 400);
  assert.equal((await call(chat, { body: "{" })).status, 400);
  assert.equal((await call(chat, { body: "x".repeat(66_000), streamed: true })).status, 413);
  assert.equal((await call(chat, { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call(chat, { method: "GET" })).status, 405);
  assert.equal(calls, 0);
});

test("allows same origin and explicitly configured Pages preflight only", async () => {
  let calls = 0;
  const chat = createChatHandler({
    env: { ...defaultEnv, CHATPPT_ALLOWED_ORIGIN: "https://teacher.github.io" },
    fetchImpl: async () => { calls++; return modelResult(); },
  });
  const preflight = await call(chat, { method: "OPTIONS", headers: { origin: "https://teacher.github.io" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "https://teacher.github.io");
  assert.equal(calls, 0);
  assert.equal((await call(chat, { headers: { origin: "http://localhost:4173" } })).status, 200);
  assert.equal((await call(chat, { headers: { origin: "https://teacher.github.io" } })).status, 200);
  assert.equal((await call(chat, { headers: { origin: "https://teacher.github.io.example.org" } })).status, 403);
  assert.equal(calls, 2);
});

test("reserves quota before parallel requests and releases windows after expiry", async () => {
  let now = Date.UTC(2026, 0, 2);
  let calls = 0;
  const chat = createChatHandler({
    env: { ...defaultEnv, CHATPPT_DAILY_LIMIT: "13" },
    now: () => now,
    fetchImpl: async () => { calls++; return modelResult(); },
  });
  const burst = await Promise.all(Array.from({ length: 13 }, () => call(chat)));
  assert.equal(burst.filter(res => res.status === 200).length, 12);
  assert.equal(burst.find(res => res.status === 429).headers["retry-after"], "600");
  now += 600_000;
  assert.equal((await call(chat)).status, 200);
  assert.match((await call(chat)).body.error, /dagens meldingsgrense/);
  assert.equal(calls, 13);
  now += 86_400_000;
  assert.equal((await call(chat)).status, 200);
});

test("reports upstream timeouts, depleted credit and incomplete replies without exposing provider details", async () => {
  const bad = Response.json({ error: { code: "insufficient_quota", message: "provider-internal" } }, { status: 429 });
  const incomplete = Response.json({ status: "incomplete", output: [] });
  const replies = [() => bad, () => incomplete, () => { throw new DOMException("delay", "TimeoutError"); }];
  const chat = createChatHandler({ env: defaultEnv, fetchImpl: async () => replies.shift()() });
  const quota = await call(chat);
  assert.equal(quota.status, 503);
  assert.match(quota.body.error, /kvoten/i);
  assert.doesNotMatch(quota.body.error, /provider-internal/);
  assert.equal((await call(chat)).status, 502);
  assert.equal((await call(chat)).status, 504);
});
