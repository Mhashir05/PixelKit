import { logger } from "../core/logger.js";
import { getState, setState, subscribe, logActivity } from "../core/state.js";
import { canvasToBlob, downloadBlob, cleanFileName } from "../core/export.js";

const FORMATS = {
  "image/jpeg": { label: "JPG", extension: "jpg" },
  "image/png": { label: "PNG", extension: "png" },
  "image/webp": { label: "WebP", extension: "webp" },
};
const COMPRESS_DELAY = 300; // wait for the slider to settle before compressing
const QUALITY_COMMIT_DELAY = 100; // wait for the slider to pause before saving its value to state

const $ = (id) => document.getElementById(id);
const formatButtons = document.querySelectorAll("[data-format]");

let compressTimer;
let qualityTimer;
let running = false; // only one compression at a time
let again = false; // something changed while one was running
let lastImage = null;
let imageVersion = 0;
let lastKey = "";
let shownResult = null;
let previewUrl = "";

// ---------- Small helpers ----------

function update(patch) {
  setState({ compressor: { ...getState().compressor, ...patch } });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// Asks the browser to export a 1x1 image in each format and checks what it really produced.
async function detectFormats() {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const supported = [];
  for (const type of Object.keys(FORMATS)) {
    const blob = await canvasToBlob(probe, type, 0.5);
    if (blob && blob.type === type) supported.push(type);
  }
  logger.info("export formats supported", supported);
  const { format } = getState().compressor;
  update({ formats: supported, format: supported.includes(format) ? format : supported[0] || "" });
}

// ---------- Compression ----------

// Never throws: returns { result } on success or { result: null, error } on failure.
async function runCompression(image, type, quality) {
  const label = FORMATS[type].label;
  try {
    const canvas = document.createElement("canvas"); // the original image, not the edited preview
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff"; // JPG has no transparency
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image.element, 0, 0);

    const started = performance.now();
    const blob = await canvasToBlob(canvas, type, type === "image/png" ? undefined : quality / 100);
    if (!blob) throw new Error("toBlob returned null");
    if (blob.type !== type) {
      logger.error("export format not supported", { wanted: type, got: blob.type });
      return { result: null, error: `${label} export is not supported by this browser (it produced ${blob.type || "an unknown format"}). Choose another format.` };
    }
    logger.info("compressed", {
      format: label,
      quality: type === "image/png" ? "n/a" : quality,
      beforeBytes: image.file.size,
      afterBytes: blob.size,
      ms: Math.round(performance.now() - started),
    });
    return { result: { blob, type, size: blob.size }, error: "" };
  } catch (err) {
    logger.error("compression failed", err);
    return { result: null, error: "Compression failed. The image may be too large for this browser." };
  }
}

// Only one compression runs at a time. If the settings or the image change while it runs, "again" is set,
// the outdated result is thrown away and the loop runs once more with the newest settings.
async function compress() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  do {
    again = false;
    const { image, compressor } = getState();
    if (!image || !compressor.format) {
      update({ busy: false });
      break;
    }
    update({ busy: true, error: "" });
    const outcome = await runCompression(image, compressor.format, compressor.quality);
    if (again) continue; // outdated: the settings or the image changed meanwhile, so run again
    update({ busy: false, result: outcome.result, error: outcome.error });
  } while (again);
  running = false;
}

function scheduleCompress() {
  clearTimeout(compressTimer);
  compressTimer = setTimeout(compress, COMPRESS_DELAY);
}

// Decides when a new compression is needed. "key" sums up everything that matters for it:
// if the key is the same as last time (for example only a filter changed), nothing is done.
function onStateChange(state) {
  if (state.image !== lastImage) {
    lastImage = state.image;
    imageVersion += 1;
    if (state.compressor.result) update({ result: null }); // the old result belongs to the previous image
  }
  const { quality, format } = getState().compressor;
  const active = state.tool === "compressor" && Boolean(state.image);
  const key = `${active}|${imageVersion}|${quality}|${format}`;
  if (key === lastKey) return;
  lastKey = key;
  if (active) scheduleCompress();
}

// ---------- Render from state ----------

function showPreview(result) {
  if (result === shownResult) return;
  shownResult = result;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = result ? URL.createObjectURL(result.blob) : "";
  if (previewUrl) $("compressor-preview").src = previewUrl;
  else $("compressor-preview").removeAttribute("src");
}

function describeChange(before, after) {
  if (after === before) return "No change";
  if (after < before) {
    const saved = Math.round((1 - after / before) * 100);
    return saved === 0 ? "Saved less than 1%" : `Saved ${saved}%`;
  }
  const larger = Math.round((after / before - 1) * 100);
  return larger === 0 ? "Slightly larger" : `${larger}% larger`;
}

function describeMessage(c, before) {
  if (c.error) return c.error;
  if (c.busy) return "Compressing…";
  if (!c.result) return "";
  if (c.result.size > before) {
    const hint = c.result.type === "image/png" ? "JPG or WebP usually give smaller files for photos." : "A lower quality or a different format may help.";
    return `The compressed file is larger than the original. ${hint}`;
  }
  if (c.result.type === "image/png") return "PNG is lossless, so quality does not apply. The size changed only because the file was re-encoded.";
  return "";
}

export function renderCompressor(state) {
  const c = state.compressor;
  const hasImage = Boolean(state.image);
  const isPng = c.format === "image/png";

  $("compressor-empty").hidden = hasImage;
  $("compressor-result").hidden = !hasImage;

  $("c-quality").disabled = !hasImage || isPng || !c.formats.length;
  if (document.activeElement !== $("c-quality")) { // while dragging, the slider shows its own newer value
    $("c-quality").value = c.quality;
    $("out-quality").textContent = isPng ? "n/a" : String(c.quality);
  }
  for (const button of formatButtons) {
    const supported = c.formats.includes(button.dataset.format);
    button.disabled = !supported;
    button.title = supported || !c.formats.length ? "" : "This browser cannot export this format";
    button.setAttribute("aria-pressed", String(button.dataset.format === c.format));
  }

  const unsupported = Object.keys(FORMATS).filter((type) => !c.formats.includes(type));
  let note = isPng ? "PNG is lossless, so the quality slider does not apply." : "A lower quality gives a smaller file with more visible loss.";
  if (!hasImage) note = "Choose an image to compress it.";
  if (c.formats.length && unsupported.length) note += ` Not supported here: ${unsupported.map((type) => FORMATS[type].label).join(", ")}.`;
  $("compressor-note").textContent = note;

  if (!hasImage) {
    showPreview(null);
    return;
  }
  showPreview(c.result);
  const before = state.image.file.size;
  $("size-before").textContent = `${formatSize(before)} (${FORMATS[state.image.type].label})`;
  $("size-after").textContent = c.result ? formatSize(c.result.size) : "—";
  $("size-change").textContent = c.result ? describeChange(before, c.result.size) : "—";
  $("out-format").textContent = c.result ? FORMATS[c.result.type].label : "—";
  $("compressor-result").setAttribute("aria-busy", String(c.busy));
  $("compressor-message").textContent = describeMessage(c, before);
  $("compressor-message").classList.toggle("note--error", Boolean(c.error));
  $("c-download").disabled = !c.result;
}

// ---------- Actions ----------

function downloadResult() {
  const { image, compressor } = getState();
  const { result } = compressor;
  if (!result) return;
  const filename = `${cleanFileName(image.name)}-compressed.${FORMATS[result.type].extension}`;
  downloadBlob(result.blob, filename);
  logActivity(`Downloaded ${filename} (${formatSize(result.size)})`);
}

export function initCompressor() {
  // Keep this handler tiny: update the readout and start a timer. The state update (which redraws
  // the whole UI and schedules the compression) happens later, in the timer.
  $("c-quality").addEventListener("input", () => {
    const quality = Number($("c-quality").value);
    $("out-quality").textContent = String(quality);
    clearTimeout(qualityTimer);
    qualityTimer = setTimeout(() => {
      update({ quality });
      logger.info("compressor quality", { quality });
    }, QUALITY_COMMIT_DELAY);
  });
  for (const button of formatButtons) {
    button.addEventListener("click", () => {
      update({ format: button.dataset.format });
      logActivity(`Compressor format: ${button.textContent}`);
    });
  }
  $("c-download").addEventListener("click", downloadResult);

  subscribe(onStateChange);
  detectFormats().catch((err) => {
    logger.error("could not check export formats", err);
    update({ error: "Could not check which formats this browser can export." });
  });
}
