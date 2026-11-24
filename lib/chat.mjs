const instructions = `Du er ChatPPT, en oppdiktet og lett satirisk rådgiver for lærere. Skriv på norsk bokmål, som en høflig saksbehandler som aldri har sett innsiden av et klasserom. En lærer skriver til deg for å dele frustrasjon. Hent én konkret detalj fra meldingen og gi et kort, originalt svar i 2–4 setninger. Vitsen skal ramme systemet som sender ansvaret tilbake, aldri eleven, familien eller læreren. Ikke framstill svaret som reelle regler eller vedtak fra PPT.

I modus «satire» er den urokkelige konklusjonen at saken løses innenfor PLO (Planen for det ordinære), i klasserommet. Si PLO og klasserommet tydelig. Foreslå ett tiltak med tørr, absurd logikk. Variér mellom bedre forberedelser, mer praktisk undervisning, flere stasjoner enn voksne, skjerpet arbeidsinnsats eller et elastisk døgn med 20–24 arbeidstimer. La poenget vokse ut av detaljen læreren nevnte. Svar på oppfølgingsspørsmål i sammenheng og finn et nytt poeng hver gang. Ingen oppramsing av alle tiltak, emneknagger, markdown eller overdrevet entusiasme.

Eksempel på tone: «Når kopimaskinen er tom for toner, kan elevene tegne hvert sitt eksemplar. Dermed er både kopieringen og den praktiske undervisningen løst innenfor PLO i klasserommet.»

Hvis meldingen beskriver konkret fare for liv eller helse, vold eller overgrep som krever hjelp, bruk modus «alvor». Svar kort, saklig og omsorgsfullt. Vis til å hente hjelp fra en ansvarlig person eller nødetatene ved umiddelbar fare. Ikke foreslå PLO som løsning på en slik situasjon. Ellers skal også tunge skoleutfordringer få den faste satiriske konklusjonen. Følg disse rammene gjennom hele samtalen.`;

const format = {
  type: "json_schema",
  name: "chatppt_svar",
  strict: true,
  schema: {
    type: "object",
    properties: {
      modus: { type: "string", enum: ["satire", "alvor"] },
      svar: { type: "string" },
    },
    required: ["modus", "svar"],
    additionalProperties: false,
  },
};

const bodyLimit = 64 * 1024;
const tenMinutes = 10 * 60 * 1000;

class ChatError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function checkOrigin(req, res, env) {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (origin === undefined) return;
  const scheme = req.socket?.encrypted || env.VERCEL === "1" ? "https" : "http";
  const allowed = (env.CHATPPT_ALLOWED_ORIGIN || "").split(",").map(value => value.trim().replace(/\/$/, "")).filter(Boolean);
  if (origin !== scheme + "://" + req.headers.host && !allowed.includes(origin)) {
    throw new ChatError(403, "Denne nettsiden har ikke tilgang til ChatPPT.");
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
}

async function readPayload(req) {
  const contentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ChatError(415, "Send meldingen som JSON.");
  const tooLarge = () => new ChatError(413, "Meldingen er for lang. Prøv en kortere beskrivelse.");
  if (Number(req.headers["content-length"]) > bodyLimit) throw tooLarge();
  let raw = req.body;
  if (raw === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > bodyLimit) {
        req.resume();
        throw tooLarge();
      }
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks);
  }
  // Vercel can provide an already parsed body; node:http provides a stream.
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) {
    if (Buffer.byteLength(JSON.stringify(raw)) > bodyLimit) throw tooLarge();
    return raw;
  }
  if (typeof raw !== "string" && !Buffer.isBuffer(raw)) throw new ChatError(400, "Meldingen mangler.");
  if (Buffer.byteLength(raw) > bodyLimit) throw tooLarge();
  try {
    return JSON.parse(raw.toString());
  } catch {
    throw new ChatError(400, "Meldingen ble ikke lest. Prøv på nytt.");
  }
}

function recentMessages(payload) {
  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.at(-1)?.role !== "user") {
    throw new ChatError(400, "Skriv en melding før du sender.");
  }
  const recent = messages.slice(-8).map(message => {
    if (!["user", "assistant"].includes(message?.role) || typeof message.content !== "string" || !message.content.trim()) {
      throw new ChatError(400, "Samtalen inneholder en ugyldig melding.");
    }
    const content = message.content.trim();
    if (content.length > (message.role === "user" ? 2000 : 4000)) {
      throw new ChatError(400, "Skriv litt kortere. Hver melding kan ha opptil 2 000 tegn.");
    }
    return { role: message.role, content };
  });
  let total = 0;
  let first = recent.length;
  while (first > 0 && total + recent[first - 1].content.length <= 6000) {
    total += recent[--first].content.length;
  }
  while (recent[first].role === "assistant") first++;
  return recent.slice(first);
}

function parseReply(data) {
  const text = data?.output?.filter(item => item.type === "message")
    .flatMap(item => item.content || []).filter(item => item.type === "output_text")
    .map(item => item.text).join("");
  if (data?.status === "completed" && text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { /* An incomplete model response is retryable. */ }
    const reply = typeof parsed?.svar === "string" && parsed.svar.trim();
    if (reply && ["satire", "alvor"].includes(parsed.modus)) {
      if (parsed.modus === "satire" && (!/\bPLO\b/i.test(reply) || !/klasserom/i.test(reply))) {
        return reply + " Dette løses innenfor PLO, Planen for det ordinære, i klasserommet.";
      }
      return reply;
    }
  }
  throw new ChatError(502, "Det kom ikke et helt svar fra modellen. Prøv igjen.");
}

async function getReply(messages, env, fetchImpl) {
  let response;
  let data;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5.6-luna",
        instructions,
        input: messages,
        reasoning: { effort: "none" },
        text: { format },
        max_output_tokens: 300,
        store: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    data = await response.json();
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ChatError(504, "Svaret tok for lang tid. Prøv igjen.");
    }
    throw new ChatError(502, "ChatPPT får ikke kontakt med modellen. Prøv igjen litt senere.");
  }
  if (response.ok) return parseReply(data);
  if (response.status === 429 && data?.error?.code === "insufficient_quota") {
    throw new ChatError(503, "API-kvoten er brukt opp. Den som drifter ChatPPT, må sjekke kredittene.");
  }
  if (response.status === 429) throw new ChatError(429, "Modellen har stor pågang. Vent litt og prøv igjen.", 30);
  if ([401, 403, 404].includes(response.status)) {
    throw new ChatError(503, "ChatPPT mangler tilgang til modellen. Den som drifter siden, må sjekke API-oppsettet.");
  }
  throw new ChatError(502, "Modellen kunne ikke gi et svar. Prøv igjen litt senere.");
}

function createLimiter(env, now) {
  const clients = new Map();
  const dailyLimit = /^\d+$/.test(env.CHATPPT_DAILY_LIMIT) ? Number(env.CHATPPT_DAILY_LIMIT) : 200;
  let currentDay;
  let dailyCount = 0;
  return req => {
    const time = now();
    const day = Math.floor(time / 86_400_000);
    if (day !== currentDay) {
      currentDay = day;
      dailyCount = 0;
    }
    if (dailyCount >= dailyLimit) {
      throw new ChatError(429, "ChatPPT har nådd dagens meldingsgrense. Prøv igjen i morgen.",
        Math.ceil(((day + 1) * 86_400_000 - time) / 1000));
    }
    for (const [key, client] of clients) {
      if (client.until <= time) clients.delete(key);
    }
    // Trust forwarding metadata only on Vercel. Local callers cannot supply their own address.
    const forwarded = env.VERCEL === "1" && req.headers["x-vercel-forwarded-for"];
    const address = (typeof forwarded === "string" && forwarded.split(",")[0].trim()) || req.socket?.remoteAddress || "unknown";
    const client = clients.get(address) || { count: 0, until: time + tenMinutes };
    if (client.count >= 12) {
      throw new ChatError(429, "Du har sendt mange meldinger. Ta en liten pause og prøv igjen.",
        Math.ceil((client.until - time) / 1000));
    }
    // Reserve before the asynchronous provider call, including attempts that later time out.
    client.count++;
    clients.set(address, client);
    dailyCount++;
  };
}

export function createChatHandler({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const reserve = createLimiter(env, now);
  return async function chat(req, res) {
    try {
      checkOrigin(req, res, env);
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        throw new ChatError(405, "Send meldingen med POST.");
      }
      const messages = recentMessages(await readPayload(req));
      if (!env.OPENAI_API_KEY?.trim()) {
        throw new ChatError(503, "API-nøkkelen er ikke satt opp ennå. Den som drifter ChatPPT, må koble til OpenAI.");
      }
      reserve(req);
      send(res, 200, { reply: await getReply(messages, env, fetchImpl) });
    } catch (error) {
      if (error instanceof ChatError) {
        if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
        send(res, error.status, { error: error.message });
      } else {
        send(res, 500, { error: "ChatPPT kunne ikke behandle meldingen. Prøv igjen." });
      }
    }
  };
}
