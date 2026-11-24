"use strict";

const byId = (id) => document.getElementById(id);
const shell = document.querySelector(".app-shell");
const main = document.querySelector("main");
const sidebar = byId("sidebar");
const input = byId("message");
const scrollArea = byId("scroll-area");
const dialog = byId("about-dialog");
const mobile = window.matchMedia("(max-width: 760px)");
const threads = [];
let active = newThread();

function newThread() {
  return { turns: [], draft: "", pending: false };
}

function icon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const element = document.createElementNS(ns, "svg");
  const reference = document.createElementNS(ns, "use");
  element.setAttribute("class", "icon");
  element.setAttribute("aria-hidden", "true");
  reference.setAttribute("href", "#" + name);
  element.append(reference);
  return element;
}

function announce(text) {
  byId("announcer").textContent = text;
}

function renderHistory() {
  byId("empty-history").hidden = threads.length > 0;
  const list = byId("history-list");
  list.replaceChildren();
  for (const thread of threads) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const label = document.createElement("span");
    label.textContent = thread.turns[0].question;
    button.className = "history-item";
    button.type = "button";
    button.title = label.textContent;
    if (thread === active) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => selectThread(thread));
    button.append(icon("i-file"), label);
    item.append(button);
    list.append(item);
  }
}

function createMessage(author, text, className) {
  const item = document.createElement("article");
  const body = document.createElement("div");
  const name = document.createElement("p");
  const content = document.createElement("p");
  item.className = "message " + className;
  if (author === "ChatPPT") {
    const avatar = document.createElement("img");
    avatar.className = "message-avatar";
    avatar.src = "./icon.svg";
    avatar.alt = "";
    item.append(avatar);
  }
  body.className = "message-body";
  name.className = "message-author";
  name.textContent = author;
  content.className = "message-content";
  content.textContent = text;
  body.append(name, content);
  item.append(body);
  return { item, body };
}

function renderTranscript(scrollToEnd = false) {
  const log = byId("transcript");
  const hasTurns = active.turns.length > 0;
  byId("welcome").hidden = hasTurns;
  log.hidden = !hasTurns;
  const fragment = document.createDocumentFragment();
  for (const turn of active.turns) {
    fragment.append(createMessage("Du", turn.question, "user").item);
    if (turn.reply) {
      fragment.append(createMessage("ChatPPT", turn.reply, "assistant").item);
    } else if (turn.error) {
      const failure = createMessage("ChatPPT", turn.error, "error");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "retry";
      retry.textContent = "Prøv igjen";
      retry.disabled = active.pending;
      retry.addEventListener("click", () => requestReply(active, turn));
      failure.body.append(retry);
      fragment.append(failure.item);
    } else {
      fragment.append(createMessage("ChatPPT", "Leter i Planen for det ordinære …", "pending").item);
    }
  }
  log.replaceChildren(fragment);
  updateComposer();
  if (scrollToEnd) scrollArea.scrollTop = scrollArea.scrollHeight;
}

function updateComposer() {
  input.style.height = "auto";
  input.style.height = input.scrollHeight + "px";
  byId("send").disabled = active.pending || !input.value.trim();
}

function setDrawer(open, focusTrigger = true) {
  const wasOpen = shell.classList.contains("drawer-open");
  shell.classList.toggle("drawer-open", open);
  byId("open-nav").setAttribute("aria-expanded", String(open));
  byId("backdrop").hidden = !open;
  main.inert = open;
  sidebar.inert = mobile.matches && !open;
  if (open) byId("close-nav").focus();
  else if (wasOpen && focusTrigger && mobile.matches) byId("open-nav").focus();
}

function selectThread(thread) {
  active.draft = input.value;
  active = thread;
  input.value = thread.draft;
  setDrawer(false);
  renderHistory();
  renderTranscript(true);
  if (!mobile.matches) input.focus();
}

function sendQuestion(question) {
  const clean = question.trim();
  if (!clean || active.pending || clean.length > 2000) return;
  if (!active.turns.length) threads.unshift(active);
  const turn = { question: clean, reply: "", error: "" };
  active.turns.push(turn);
  active.draft = "";
  input.value = "";
  renderHistory();
  requestReply(active, turn);
}

async function requestReply(thread, turn) {
  if (thread.pending) return;
  thread.pending = true;
  turn.error = "";
  const previous = thread.turns.slice(0, thread.turns.indexOf(turn));
  const messages = previous.filter((entry) => entry.reply).slice(-3).flatMap((entry) => [
    { role: "user", content: entry.question },
    { role: "assistant", content: entry.reply.slice(0, 4000) }
  ]);
  messages.push({ role: "user", content: turn.question });
  renderTranscript(true);
  announce("ChatPPT tenker.");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 55000);
  try {
    const endpoint = globalThis.CHATPPT_API_URL || "./api/chat";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ messages }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      turn.error = typeof data?.error === "string" && data.error.trim()
        ? data.error : "ChatPPT fikk ikke hentet et svar. Prøv igjen om litt.";
    } else if (typeof data?.reply === "string" && data.reply.trim()) {
      turn.reply = data.reply.trim();
    } else {
      turn.error = "Jeg fikk et tomt svar fra rådgiverrommet. Prøv igjen.";
    }
  } catch (error) {
    turn.error = error.name === "AbortError"
      ? "Svaret tok for lang tid. Spørsmålet ditt ligger her, så du kan prøve igjen."
      : "Klarte ikke å nå rådgiverrommet. Sjekk forbindelsen og prøv igjen.";
  } finally {
    window.clearTimeout(timer);
    thread.pending = false;
    if (thread === active) {
      const nearEnd = scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight < 100;
      renderTranscript(nearEnd);
      announce(turn.error || "ChatPPT svarte. " + turn.reply);
    }
  }
}

byId("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  sendQuestion(input.value);
});
input.addEventListener("input", () => {
  active.draft = input.value;
  updateComposer();
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    sendQuestion(input.value);
  }
});
document.querySelectorAll("[data-starter]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!mobile.matches) input.focus();
    sendQuestion(button.dataset.starter);
  });
});
byId("new-chat").addEventListener("click", () => {
  selectThread(newThread());
  announce("Ny samtale.");
});
byId("open-nav").addEventListener("click", () => setDrawer(true));
byId("close-nav").addEventListener("click", () => setDrawer(false));
byId("backdrop").addEventListener("click", () => setDrawer(false));
mobile.addEventListener("change", () => setDrawer(false));
document.addEventListener("keydown", (event) => {
  if (!shell.classList.contains("drawer-open")) return;
  if (event.key === "Escape") setDrawer(false);
  if (event.key === "Tab") {
    const first = byId("close-nav");
    const last = byId("about");
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
byId("about").addEventListener("click", () => {
  setDrawer(false);
  dialog.showModal();
});
byId("close-about").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
dialog.addEventListener("close", () => {
  (mobile.matches ? byId("open-nav") : byId("about")).focus();
});
setDrawer(false);
updateComposer();
