import { logger } from "../core/logger.js";
import { getState, setState, logActivity } from "../core/state.js";
import { checkFile, decodeImage, loadImage } from "../core/image.js";
import { canvasToBlob, downloadBlob } from "../core/export.js";

const WORKER_URL = "https://pixelkit-ai.hashir-dev.workers.dev/generate"; // our Cloudflare Worker (see worker/); no key in the browser
const EDIT_URL = "https://pixelkit-ai.hashir-dev.workers.dev/edit";
const EDIT_INPUT_MAX = 512; // longest side of the copy sent for an edit; the model needs input images of at most 512x512
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

// The only function that talks to the Worker and reads its status codes.
// Fetches the bytes with fetch(), so the image is a local Blob and never taints a canvas.
async function requestImage(url, request) {
  const response = await fetch(url, { method: "POST", ...request, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (response.status === 401 || response.status === 403) throw new Error("The image service is not available right now.");
  if (response.status === 402 || response.status === 429) throw new Error("Today's free AI limit has been reached. Try again tomorrow.");
  if (!response.ok) throw new Error("The image service had a problem. Try again in a moment.");
  return response.blob();
}

async function fetchImage(url, request) {
  const blob = await requestImage(url, request);
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
    const file = await fetchImage(WORKER_URL, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
    update({ result: file, original: file, edits: [] });
    logActivity(`AI Studio: image ready (${Math.round(file.size / 1024)} KB)`);
  } catch (err) {
    logger.error("ai generate failed", err);
    update({ error: describeError(err) });
  }
  coolDown();
}

function coolDown() {
  update({ busy: false, cooling: true });
  setTimeout(() => update({ cooling: false }), COOLDOWN);
}

// ---------- Editing ----------

// A JPEG copy with both sides at most EDIT_INPUT_MAX, made fresh from the original for each edit.
async function shrink(file) {
  const element = await decodeImage(file);
  const scale = Math.min(1, EDIT_INPUT_MAX / Math.max(element.naturalWidth, element.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(element.naturalWidth * scale);
  canvas.height = Math.round(element.naturalHeight * scale);
  canvas.getContext("2d").drawImage(element, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, "image/jpeg", 0.9);
}

// Sends the original with all instructions so far, so edits add up without drifting.
async function applyEdit() {
  const { busy, cooling, original, edits } = getState().ai;
  if (busy || cooling || !original) return; // one request at a time
  const instruction = $("ai-edit").value.trim().slice(0, MAX_PROMPT);
  if (!instruction) return update({ error: "Describe a change first." });
  const next = [...edits, instruction];
  const prompt = next.join("; ");
  if (prompt.length > MAX_PROMPT) return update({ error: "These changes are too long together. Reset to original to start again." });
  update({ busy: true, error: "" });
  logActivity(`AI Studio: editing the image (${next.length} changes, ${prompt.length} characters)`); // never the text itself
  try {
    const body = new FormData();
    body.append("prompt", prompt);
    body.append("image", await shrink(original), "image.jpg");
    const file = await fetchImage(EDIT_URL, { body });
    update({ result: file, edits: next });
    $("ai-edit").value = "";
    logActivity(`AI Studio: edit ready (${Math.round(file.size / 1024)} KB)`);
  } catch (err) {
    logger.error("ai edit failed", err);
    update({ error: describeError(err) });
  }
  coolDown();
}

function reset() {
  const { busy, original } = getState().ai;
  if (busy || !original) return;
  update({ result: original, edits: [], error: "" });
  logActivity("AI Studio: reset to the original image");
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
  $("ai-generate").textContent = a.busy ? "Working…" : "Generate";
  $("ai-editing").hidden = !a.result;
  $("ai-apply").disabled = a.busy || a.cooling;
  $("ai-reset").disabled = a.busy || !a.edits.length;
  $("ai-model").textContent = a.edits.length ? "Edited by Cloudflare Workers AI (FLUX.2 klein 4B)" : "Generated by Cloudflare Workers AI (FLUX.1 schnell)";
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
  $("ai-apply").addEventListener("click", applyEdit);
  $("ai-reset").addEventListener("click", reset);
  $("ai-download").addEventListener("click", download);
  for (const button of openButtons) button.addEventListener("click", () => openIn(button.dataset.aiOpen));
}
