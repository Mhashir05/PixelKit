import { logger } from "../core/logger.js";
import { getState, setState, logActivity, defaultFilters } from "../core/state.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000; // keeps a small file with huge dimensions from exhausting memory
const THUMBNAIL_SIZE = 96; // longest side of the Recents thumbnail
const PREVIEW_MAX = 1200; // longest side of the preview canvas; export uses the full size
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const FILTER_SUPPORTED = "filter" in document.createElement("canvas").getContext("2d");

const $ = (id) => document.getElementById(id);
const canvas = $("editor-canvas");
const sliders = { brightness: $("brightness"), contrast: $("contrast"), blur: $("blur") };
const outputs = { brightness: $("out-brightness"), contrast: $("out-contrast"), blur: $("out-blur") };
const toggles = { grayscale: $("grayscale"), invert: $("invert") };

// ---------- Validation ----------

// Reads the first bytes of the file to find out what it really is.
async function sniffType(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (list, offset = 0) => list.every((byte, i) => bytes[offset + i] === byte);
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return "";
}

// Returns a message if the file is not allowed, or "" if it is fine.
async function checkFile(file) {
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_BYTES) return `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`;
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) return "SVG files are not allowed. Use a JPG, PNG or WebP image.";
  if (!ALLOWED_TYPES.includes(file.type)) return "Only JPG, PNG or WebP images are allowed.";
  if ((await sniffType(file)) !== file.type) return "The file contents do not match a JPG, PNG or WebP image.";
  return "";
}

// ---------- Loading ----------

export function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => { URL.revokeObjectURL(url); resolve(element); };
    element.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    element.src = url;
  });
}

function rejectFile(file, reason) {
  logger.error("upload rejected", { name: file.name, reason });
  setState({ error: `${file.name.slice(0, 60)}: ${reason}`, loading: false });
}

export async function loadImage(file) {
  setState({ loading: true, error: "" });
  logger.info("image selected", { name: file.name, type: file.type, bytes: file.size });
  try {
    const problem = await checkFile(file);
    if (problem) return rejectFile(file, problem);

    const element = await decodeImage(file);
    if (element.naturalWidth * element.naturalHeight > MAX_PIXELS) return rejectFile(file, "The image has too many pixels (limit is 40 megapixels).");

    const image = { name: file.name, type: file.type, width: element.naturalWidth, height: element.naturalHeight, element, file };
    // A new image starts a new project; autosave (projects.js) picks it up.
    const projectId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setState({ image, filters: defaultFilters(), projectId, projectName: "Untitled design", loading: false });
    logActivity(`Loaded ${file.name} (${image.width}×${image.height})`);
  } catch (err) {
    logger.error("image decode failed", err);
    rejectFile(file, "The image could not be read.");
  }
}

// ---------- Drawing ----------

// scale is 1 for export; the preview is smaller, so the blur radius shrinks with it.
function filterString(filters, scale) {
  return `brightness(${filters.brightness}%) contrast(${filters.contrast}%) grayscale(${filters.grayscale ? 100 : 0}%) invert(${filters.invert ? 100 : 0}%) blur(${filters.blur * scale}px)`;
}

let drawPending = false;
let drawnImage = null;
let drawnFilters = "";

function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    drawPreview(getState());
  });
}

function drawPreview({ image, filters }) {
  if (!image) return;
  const key = JSON.stringify(filters);
  if (image === drawnImage && key === drawnFilters) return;
  drawnImage = image;
  drawnFilters = key;

  const scale = Math.min(1, PREVIEW_MAX / Math.max(image.width, image.height));
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.filter = filterString(filters, scale);
  ctx.drawImage(image.element, 0, 0, canvas.width, canvas.height);
}

// Small JPEG data URL of the current preview, for the Recents list.
export function makeThumbnail() {
  drawPreview(getState()); // make sure the preview is up to date
  const thumb = document.createElement("canvas");
  const scale = THUMBNAIL_SIZE / Math.max(canvas.width, canvas.height);
  thumb.width = Math.max(1, Math.round(canvas.width * scale));
  thumb.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = thumb.getContext("2d");
  ctx.fillStyle = "#141414"; // JPEG has no transparency
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.6);
}

// ---------- Render from state ----------

export function renderEditor(state) {
  const hasImage = Boolean(state.image);
  const canEdit = hasImage && FILTER_SUPPORTED;

  $("editor-error").hidden = !state.error;
  $("editor-error").textContent = state.error;
  $("editor-dropzone").hidden = hasImage;
  $("editor-preview").hidden = !hasImage;
  $("choose-image").disabled = state.loading;
  $("choose-image").textContent = state.loading ? "Loading…" : "Choose image";

  for (const name of Object.keys(sliders)) {
    sliders[name].disabled = !canEdit;
    sliders[name].value = state.filters[name];
    outputs[name].textContent = name === "blur" ? `${state.filters.blur}px` : `${state.filters[name]}%`;
  }
  for (const name of Object.keys(toggles)) {
    toggles[name].disabled = !canEdit;
    toggles[name].setAttribute("aria-pressed", String(state.filters[name]));
  }
  $("reset").disabled = !canEdit;
  $("export").disabled = !(hasImage && (state.tool === "editor" || state.tool === "meme")); // the Meme tool has its own export listener

  if (!FILTER_SUPPORTED) $("editor-note").textContent = "This browser cannot apply canvas filters.";
  else if (!hasImage) $("editor-note").textContent = "Choose an image to use these controls. Rotate and Crop are not built yet.";
  else $("editor-note").textContent = "Rotate and Crop are not built yet.";

  if (hasImage) {
    $("file-name").textContent = state.image.name;
    $("file-dims").textContent = `${state.image.width}×${state.image.height}`;
    scheduleDraw();
  }
}

// ---------- Actions ----------

let filterLogTimer;

function changeFilter(name, value) {
  setState({ filters: { ...getState().filters, [name]: value } });
  // Log once the user pauses, not on every step of a slider drag.
  clearTimeout(filterLogTimer);
  filterLogTimer = setTimeout(() => logger.info("filter changed", { ...getState().filters }), 400);
}

function resetFilters() {
  setState({ filters: defaultFilters() });
  logActivity("Reset filters to the original image");
}

function exportName(name, extension) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "image";
  return `${base}-edited.${extension}`;
}

function exportImage() {
  const { image, filters } = getState();
  const isPng = image.type === "image/png";
  const type = isPng ? "image/png" : "image/jpeg"; // WebP sources are saved as JPG for now

  const out = document.createElement("canvas");
  out.width = image.width;
  out.height = image.height;
  const ctx = out.getContext("2d");
  if (!isPng) {
    ctx.fillStyle = "#fff"; // JPG has no transparency
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.filter = filterString(filters, 1);
  ctx.drawImage(image.element, 0, 0);

  out.toBlob((blob) => {
    if (!blob) {
      logger.error("export failed", { name: image.name, type });
      setState({ error: "Export failed. The image may be too large for this browser." });
      return;
    }
    const filename = exportName(image.name, isPng ? "png" : "jpg");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logActivity(`Exported ${filename} (${Math.round(blob.size / 1024)} KB)`);
  }, type, 0.92);
}

export function initEditor() {
  $("choose-image").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = ""; // lets the same file be chosen again
    if (file) loadImage(file);
  });

  for (const name of Object.keys(sliders)) {
    sliders[name].addEventListener("input", () => changeFilter(name, Number(sliders[name].value)));
  }
  for (const name of Object.keys(toggles)) {
    toggles[name].addEventListener("click", () => {
      const on = !getState().filters[name];
      changeFilter(name, on);
      logActivity(`${name} ${on ? "on" : "off"}`);
    });
  }
  $("reset").addEventListener("click", resetFilters);
  $("export").addEventListener("click", () => {
    if (getState().tool === "editor") exportImage();
  });
}
