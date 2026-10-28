import { logger } from "../core/logger.js";
import { getState, setState, logActivity } from "../core/state.js";
import { checkFile, loadImage } from "../core/image.js";
import { downloadBlob } from "../core/export.js";

const WORKER_URL = "https://pixelkit-ai.hashir-dev.workers.dev/generate"; // our Cloudflare Worker (see worker/); no key in the browser
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PROMPT = 300; // same limit as the Worker
const REQUEST_TIMEOUT = 90000; // generation can be slow
const COOLDOWN = 5000; // the Generate button stays off this long after each request

const $ = (id) => document.getElementById(id);
const openButtons = document.querySelectorAll("[data-ai-open]");

let shownResult = null;
let previewUrl = "";

function update(patch) {
  setState({ ai: { ...getState().ai, ...patch } });
}

// ---------- Generating ----------

// The only function that talks to the Worker: its URL, body and status codes.
// Fetches the bytes with fetch(), so the image is a local Blob and never taints a canvas.
async function requestImage(prompt) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (response.status === 401 || response.status === 403) throw new Error("The image service is not available right now.");
  if (response.status === 402 || response.status === 429) throw new Error("Today's free AI limit has been reached. Try again tomorrow.");
  if (!response.ok) throw new Error("The image service had a problem. Try again in a moment.");
  return response.blob();
}

async function fetchImage(prompt) {
  const blob = await requestImage(prompt);
  const file = new File([blob], `ai-image.${EXTENSIONS[blob.type] || "img"}`, { type: blob.type });
  if (await checkFile(file)) throw new Error("The service did not return a usable image. Try a different prompt."); // same checks as an upload
  logger.info("ai image downloaded", { type: file.type, bytes: file.size });
  return file;
}

function describeError(err) {
  if (err.name === "TimeoutError") return "The image took too long. Try again.";
  if (err instanceof TypeError) return "Could not reach the image service. Check your connection and try again.";
  return err.message;
}

async function generate() {
  const { busy, cooling } = getState().ai;
  if (busy || cooling) return; // one request at a time
  const prompt = $("ai-prompt").value.trim().slice(0, MAX_PROMPT);
  if (!prompt) return update({ error: "Type a prompt first." });
  update({ busy: true, error: "" });
  logActivity(`AI Studio: generating an image (prompt of ${prompt.length} characters)`); // never the prompt itself
  try {
    const file = await fetchImage(prompt);
    update({ result: file });
    logActivity(`AI Studio: image ready (${Math.round(file.size / 1024)} KB)`);
  } catch (err) {
    logger.error("ai generate failed", err);
    update({ error: describeError(err) });
  }
  update({ busy: false, cooling: true });
  setTimeout(() => update({ cooling: false }), COOLDOWN);
}

// ---------- Using the result ----------

function download() {
  const { result } = getState().ai;
  if (!result) return;
  downloadBlob(result, result.name);
  logActivity(`Downloaded ${result.name}`);
}

// Loads the image like a chosen file (same checks, new project), then switches to the tool.
async function openIn(tool) {
  const { result } = getState().ai;
  if (!result) return;
  await loadImage(result);
  const state = getState();
  if (state.image && state.image.file === result) {
    setState({ tool });
    logActivity(`Opened ${result.name} in ${tool}`);
    return;
  }
  update({ error: state.error || "The image was rejected." });
  setState({ error: "" }); // this tool shows the message itself
}

// ---------- Render from state ----------

function showPreview(result) {
  if (result === shownResult) return;
  shownResult = result;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = result ? URL.createObjectURL(result) : "";
  if (previewUrl) $("ai-image").src = previewUrl;
  else $("ai-image").removeAttribute("src");
}

export function renderAi(state) {
  const a = state.ai;
  $("ai-generate").disabled = a.busy || a.cooling;
  $("ai-generate").textContent = a.busy ? "Generating…" : "Generate";
  for (const button of openButtons) button.disabled = state.loading;

  $("ai-status").textContent = a.busy ? "Generating… this can take up to a minute." : "";
  $("ai-error").hidden = !a.error;
  $("ai-error").textContent = a.error;
  $("ai-empty").hidden = Boolean(a.result);
  $("ai-result").hidden = !a.result;
  showPreview(a.result);
}

export function initAi() {
  $("ai-generate").addEventListener("click", generate);
  window.addEventListener("online", () => update({ error: "" })); // a stale offline error should not outlive the outage
  $("ai-download").addEventListener("click", download);
  for (const button of openButtons) button.addEventListener("click", () => openIn(button.dataset.aiOpen));
}
