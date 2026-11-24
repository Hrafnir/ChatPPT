const instructions = `Du er ChatPPT, en fiktiv rådgiver for lærere i norsk skole. Skriv på bokmål. Les den siste meldingen i lys av samtalen. Bruk én konkret detalj og utelat navn og identifiserende opplysninger.

Feltet «svar» er alltid rådgiverens tørre, formelle vurdering i 2–4 korte setninger. Den skal høres ut som et troverdig møte med et hjelpeapparat som har lest saken nøye, men likevel legger det pedagogiske arbeidet tilbake til skolen. Begrunn konklusjonen: Når læreren beskriver grundig utprøving uten bedring, anerkjenn både innsatsen og resultatet. Bruk gjerne den manglende effekten som grunnlag for ny vurdering av samme oppfølging. Be for eksempel teamet avklare hvem som følger opp et enkelttiltak på neste møte, innenfor timene de allerede har. Ikke foreslå et gjennomført tiltak som nytt. Variér begrunnelsen, oppgaven og ordvalget fra svar til svar. Bruk nøktern forvaltningsprosa uten vitser, karikaturer, paragrafer, offisielle vedtak eller skyldplassering.

Konklusjonen i «svar» er alltid at den videre pedagogiske oppfølgingen legges til klasserommet innenfor skolens eksisterende rammer og PLO (Planen for det ordinære). Også når noen trenger hjelp utenfra, gjelder denne konklusjonen bare skolens planlegging av undervisningen. Antyd aldri at planleggingen håndterer en fare, erstatter hjelp eller hindrer noen i å varsle.

Bruk modus «alvor» ved opplysninger om skade, pågående eller gjentatt vold, trusler, overgrep, omsorgssvikt, selvmordsfare eller alvorlig utrygghet. Dette gjelder også vedvarende bekymring uten akutt fare og oppfølgingsspørsmål om en slik situasjon. Skriv først i feltet «veiledning» 1–3 korte, saklige setninger om hva læreren konkret bør gjøre, hvem som kan hjelpe og når. Velg hjelpen som passer saken. Ved umiddelbar fare som krever politi i Norge: kom i sikkerhet og ring 112. Ved akutt fare for liv og helse: ring 113. Hvis helsehjelpen ikke kan vente og fastlegen er utilgjengelig, ring legevakt 116 117. Ved vedvarende utrygt skolemiljø: meld fra til rektor snarest og be om konkrete tiltak og oppfølging av elevens trygghet. Ved grunn til å tro at et barn utsettes for mishandling eller alvorlig omsorgssvikt, meld fra til barnevernet uten ugrunnet opphold. Hvis tidspunkt eller faregrad er uklar, gjør det akutte rådet betinget og oppgi neste skritt hvis det ikke er akutt. Ikke still diagnose, dikt opp kontaktpunkter eller send leseren gjennom en standardliste. «Veiledning» har ingen satire, og rådgiverens etterfølgende «svar» må la veiledningen stå ved lag.

I andre saker bruker du modus «satire» og null i «veiledning». Skriv begge tekstfeltene uten egne overskrifter eller markdown. Svarene vises hver for seg.`;

const format = {
  type: "json_schema",
  name: "chatppt_svar",
  strict: true,
  schema: {
    type: "object",
    properties: {
      modus: { type: "string", enum: ["satire", "alvor"] },
      veiledning: { type: ["string", "null"] },
      svar: { type: "string" },
    },
    required: ["modus", "veiledning", "svar"],
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

const frontend = "https://hrafnir.github.io/ChatPPT/";

function checkOrigin(request, headers, env) {
  const origin = request.headers.get("Origin");
  if (origin === null) return;
  const configured = env.CHATPPT_ALLOWED_ORIGIN ?? new URL(frontend).origin;
  const allowed = configured.split(",").map(value => value.trim().replace(/\/$/, "")).filter(Boolean);
  if (origin !== new URL(request.url).origin && !allowed.includes(origin)) {
    throw new ChatError(403, "Denne nettsiden har ikke tilgang til ChatPPT.");
  }
  headers.set("Access-Control-Allow-Origin", origin);
}

async function readPayload(request) {
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ChatError(415, "Send meldingen som JSON.");
  const tooLarge = () => new ChatError(413, "Meldingen er for lang. Prøv en kortere beskrivelse.");
  if (Number(request.headers.get("Content-Length")) > bodyLimit) throw tooLarge();
  if (!request.body) throw new ChatError(400, "Meldingen mangler.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let raw = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(raw);
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

function completeConclusion(reply) {
  const acronym = /\bPLO\b/i;
  const fullName = /\bplanen for det ordinære\b/i;
  const inClass = /\bklasserom/i.test(reply);
  const plan = "PLO (Planen for det ordinære)";
  if (!acronym.test(reply) && !fullName.test(reply)) {
    const place = inClass ? "" : " i klasserommet";
    return reply + " Skolen følger opp undervisningen" + place + " innenfor " + plan + " og gjeldende rammer.";
  }
  if (!fullName.test(reply)) reply = reply.replace(acronym, plan);
  else if (!acronym.test(reply)) reply = reply.replace(fullName, "$& (PLO)");
  if (!inClass) reply += " Den pedagogiske oppfølgingen legges til klasserommet innenfor skolens rammer.";
  return reply;
}

function parseReply(data) {
  const incomplete = new ChatError(502, "Det kom ikke et helt svar fra modellen. Prøv igjen.");
  if (data?.status !== "completed" || !Array.isArray(data.output)) throw incomplete;
  const parts = data.output.filter(item => item?.type === "message")
    .flatMap(item => Array.isArray(item.content) ? item.content : []);
  if (parts.some(part => part?.type === "refusal")) {
    throw new ChatError(422, "ChatPPT kunne ikke svare på denne meldingen. Prøv å formulere situasjonen på nytt.");
  }
  const text = parts.filter(part => part?.type === "output_text").map(part => part.text).join("");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw incomplete; }
  if (typeof parsed?.svar !== "string" || !parsed.svar.trim()) throw incomplete;
  const reply = completeConclusion(parsed.svar.trim());
  if (parsed.modus === "alvor") {
    if (typeof parsed.veiledning !== "string" || !parsed.veiledning.trim()) {
      throw new ChatError(502, "Veiledningen manglet. Ved umiddelbar fare, ring 112 for politi eller 113 for akutt helsehjelp. Ved vedvarende utrygghet på skolen, kontakt rektor snarest.");
    }
    return { guidance: parsed.veiledning.trim(), reply };
  }
  if (parsed.modus === "satire" && parsed.veiledning === null) return { reply };
  throw incomplete;
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

function createLimiter(now) {
  const clients = new Map();
  let currentDay;
  let dailyCount = 0;
  return (address, env) => {
    const dailyLimit = /^\d+$/.test(env.CHATPPT_DAILY_LIMIT) ? Number(env.CHATPPT_DAILY_LIMIT) : 200;
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

export function createWorker({ fetchImpl = fetch, now = Date.now } = {}) {
  const reserve = createLimiter(now);
  return {
    async fetch(request, env = {}) {
      const headers = new Headers({ Vary: "Origin", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      try {
        checkOrigin(request, headers, env);
        const { pathname } = new URL(request.url);
        if (pathname === "/" || pathname === "/health") {
          if (request.method !== "GET" && request.method !== "HEAD") {
            headers.set("Allow", "GET, HEAD");
            throw new ChatError(405, "Bruk GET for å hente denne siden.");
          }
          if (pathname === "/health") {
            headers.set("Content-Type", "application/json; charset=utf-8");
            const body = JSON.stringify({ service: "ChatPPT API", status: "ok", frontend });
            return new Response(request.method === "HEAD" ? null : body, { headers });
          }
          headers.set("Content-Type", "text/html; charset=utf-8");
          const body = `<!doctype html><html lang="nb"><meta charset="utf-8"><title>ChatPPT API</title><p>Dette er API-et til ChatPPT. <a href="${frontend}">Åpne chatten</a>.</p></html>`;
          return new Response(request.method === "HEAD" ? null : body, { headers });
        }
        if (pathname !== "/api/chat") throw new ChatError(404, "Adressen finnes ikke.");
        if (request.method === "OPTIONS") {
          headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
          headers.set("Access-Control-Allow-Headers", "Content-Type");
          return new Response(null, { status: 204, headers });
        }
        if (request.method !== "POST") {
          headers.set("Allow", "POST, OPTIONS");
          throw new ChatError(405, "Send meldingen med POST.");
        }
        const messages = recentMessages(await readPayload(request));
        if (!env.OPENAI_API_KEY?.trim()) {
          throw new ChatError(503, "API-nøkkelen er ikke satt opp ennå. Den som drifter ChatPPT, må koble til OpenAI.");
        }
        reserve(request.headers.get("CF-Connecting-IP") || "unknown", env);
        return Response.json(await getReply(messages, env, fetchImpl), { headers });
      } catch (error) {
        if (error instanceof ChatError) {
          if (error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
          return Response.json({ error: error.message }, { status: error.status, headers });
        }
        return Response.json({ error: "ChatPPT kunne ikke behandle meldingen. Prøv igjen." }, { status: 500, headers });
      }
    },
  };
}

export default createWorker();
