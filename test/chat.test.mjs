import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createChatHandler } from "../lib/chat.mjs";

const defaultEnv = { OPENAI_API_KEY: "fixture" };
const question = { role: "user", content: "Kopimaskinen er tom for toner." };

const ordinary = "Teamet bes gjennomgå behovet for kopier i neste planleggingsøkt. Den videre oppfølgingen skjer i klasserommet innenfor skolens rammer og PLO (Planen for det ordinære).";

function modelResult(svar = ordinary, modus = "satire", veiledning = null) {
  return Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ modus, veiledning, svar }) }] }],
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
  assert.deepEqual(res.body, { reply: ordinary });
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

test("a serious answer carries separate factual guidance and an administrative classroom conclusion", async () => {
  const messages = [{ role: "user", content: "En elev har kollapset i gymsalen og svarer ikke." }];
  const guidance = "Ring 113 nå og følg veiledningen fra operatøren.";
  const satire = "Når eleven har fått hjelp, bes teamet avklare hvem som følger opp undervisningsplanen.";
  const chat = createChatHandler({ env: defaultEnv, fetchImpl: async () => modelResult(satire, "alvor", guidance) });
  const res = await call(chat, { messages });
  assert.equal(res.status, 200);
  assert.equal(res.body.guidance, guidance);
  assert.ok(res.body.reply.startsWith(satire));
  assert.match(res.body.reply, /PLO \(Planen for det ordinære\)/);
  assert.match(res.body.reply, /klasserommet/);
  assert.doesNotMatch(res.body.reply, /113/);
});

test("persistent concerns can receive practical guidance without an emergency referral", async () => {
  const messages = [{ role: "user", content: "En elev har gruet seg til friminuttene i flere uker." }];
  const guidance = "Meld fra til rektor snarest. Avtal med eleven hvem som følger opp tryggheten i friminuttene.";
  const satire = "Innenfor skolens rammer følges planarbeidet videre i klasserommet etter PLO (Planen for det ordinære).";
  const chat = createChatHandler({ env: defaultEnv, fetchImpl: async () => modelResult(satire, "alvor", guidance) });
  assert.deepEqual((await call(chat, { messages })).body, { guidance, reply: satire });
});

test("completes only missing PLO and classroom details without duplicating present terms", async () => {
  const partial = [
    "Den videre gjennomgangen legges til PLO.",
    "Tiltakene i klasserommet følges opp i Planen for det ordinære.",
    "Arbeidsdelingen i klasserommet tas opp på neste møte.",
  ];
  const chat = createChatHandler({ env: defaultEnv, fetchImpl: async () => modelResult(partial.shift()) });
  while (partial.length) {
    const { reply } = (await call(chat)).body;
    assert.equal(reply.match(/\bPLO\b/gi)?.length, 1);
    assert.equal(reply.match(/planen for det ordinære/gi)?.length, 1);
    assert.equal(reply.match(/klasserommet/gi)?.length, 1);
  }
});

test("missing serious guidance, malformed model fields and refusals never return satire on its own", async () => {
  const refusal = Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "refusal", refusal: "provider details" }] }],
  });
  const bad = [
    modelResult(ordinary, "alvor", null), modelResult(ordinary, "alvor", " "),
    modelResult(" ", "alvor", "Kontakt rektor."), modelResult(ordinary, "satire", "Kontakt rektor."),
    { invalid: true },
  ];
  const chat = createChatHandler({
    env: defaultEnv, fetchImpl: async () => {
      const next = bad.shift();
      return next?.invalid ? Response.json({ status: "completed", output: {} }) : next || refusal;
    },
  });
  while (bad.length) {
    const res = await call(chat);
    assert.equal(res.status, 502);
    assert.ok(res.body.error);
    assert.equal(res.body.reply, undefined);
  }
  assert.equal((await call(chat)).status, 422);
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
