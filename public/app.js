"use strict";

const chat = document.querySelector(".chat");
const transcript = document.getElementById("transcript");
const form = document.getElementById("composer");
const input = document.getElementById("message");
const sendButton = document.getElementById("send");
const announcer = document.getElementById("announcer");
const turns = [];
let pending = false;

function updateComposer() {
  input.style.height = "auto";
  input.style.height = input.scrollHeight + "px";
  sendButton.disabled = pending || !input.value.trim();
}

function message(label, text, className) {
  const article = document.createElement("article");
  article.className = "message " + className;
  const name = document.createElement("h2");
  name.textContent = label;
  const content = document.createElement("p");
  content.textContent = text;
  article.append(name, content);
  return article;
}

function contextFor(turn) {
  const previous = turns.slice(0, turns.indexOf(turn)).filter((item) => item.reply);
  const messages = previous.slice(-3).flatMap((item) => {
    const answer = item.guidance
      ? ["Reell veiledning", item.guidance, "", "ChatPPT · satire", item.reply].join("\n")
      : item.reply;
    return [
      { role: "user", content: item.question },
      { role: "assistant", content: answer.slice(0, 4000) }
    ];
  });
  messages.push({ role: "user", content: turn.question });
  return messages;
}

function showResponse(turn) {
  const elements = [];
  if (turn.error) {
    const failure = message("Svar uteble", turn.error, "failure");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry";
    retry.textContent = "Prøv igjen";
    retry.addEventListener("click", () => requestReply(turn));
    failure.append(retry);
    elements.push(failure);
  } else {
    if (turn.guidance) elements.push(message("Reell veiledning", turn.guidance, "guidance"));
    elements.push(message("ChatPPT · satire", turn.reply, "assistant"));
  }
  turn.response.replaceChildren(...elements);
}

function scrollToResponse(turn) {
  const offset = turn.response.getBoundingClientRect().top - transcript.getBoundingClientRect().top;
  transcript.scrollTop += offset - 16;
}

function setPending(value) {
  pending = value;
  updateComposer();
  for (const button of transcript.querySelectorAll(".retry")) button.disabled = value;
}

async function requestReply(turn) {
  if (pending) return;
  setPending(true);
  turn.error = "";
  turn.response.replaceChildren(message("ChatPPT", "Skriver …", "pending"));
  scrollToResponse(turn);
  announcer.textContent = "ChatPPT skriver.";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch(globalThis.CHATPPT_API_URL || "./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ messages: contextFor(turn) }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      turn.error = typeof data?.error === "string" && data.error.trim()
        ? data.error : "Kunne ikke hente svar. Prøv igjen om litt.";
    } else if (typeof data?.reply === "string" && data.reply.trim()) {
      turn.reply = data.reply.trim();
      turn.guidance = typeof data.guidance === "string" ? data.guidance.trim() : "";
    } else {
      turn.error = "Svaret var tomt. Prøv igjen.";
    }
  } catch (error) {
    turn.error = error.name === "AbortError"
      ? "Svaret tok for lang tid. Du kan prøve igjen."
      : "Fikk ikke kontakt med ChatPPT. Sjekk forbindelsen og prøv igjen.";
  } finally {
    window.clearTimeout(timer);
    const transcriptBounds = transcript.getBoundingClientRect();
    const responseBounds = turn.response.getBoundingClientRect();
    const wasViewingResponse = responseBounds.bottom > transcriptBounds.top && responseBounds.top < transcriptBounds.bottom;
    showResponse(turn);
    setPending(false);
    if (wasViewingResponse) scrollToResponse(turn);
    const summary = turn.guidance ? "Reell veiledning. " + turn.guidance + " " : "";
    announcer.textContent = turn.error || summary + "ChatPPT · satire. " + turn.reply;
  }
}

function submitMessage() {
  const question = input.value.trim();
  if (pending || !question || question.length > 2000) return;
  const row = document.createElement("div");
  row.className = "turn";
  const response = document.createElement("div");
  const turn = { question, reply: "", guidance: "", error: "", response };
  turns.push(turn);
  row.append(message("Du", question, "user"), response);
  transcript.append(row);
  transcript.hidden = false;
  chat.classList.add("has-messages");
  input.value = "";
  input.focus({ preventScroll: true });
  requestReply(turn);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitMessage();
});
input.addEventListener("input", updateComposer);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    submitMessage();
  }
});
updateComposer();
