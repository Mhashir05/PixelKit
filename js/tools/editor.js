import { logger, logAfterPause } from "../core/logger.js";
import { getState, setState, logActivity } from "../core/state.js";
import { MAX_TRIM, MAX_TEXT, cutText, defaultEdits, editedSize, exportSize, drawEdited } from "../core/edits.js";
import { beginChange, endChange } from "../core/history.js";
import { canvasToBlob, downloadBlob, cleanFileName } from "../core/export.js";
import { loadImage } from "../core/image.js";

const PREVIEW_MAX = 1200; // longest side of the preview canvas; export uses the full size
const FILTER_SUPPORTED = "filter" in document.createElement("canvas").getContext("2d");

const $ = (id) => document.getElementById(id);
const canvas = $("editor-canvas");
const sliders = { brightness: $("brightness"), contrast: $("contrast"), blur: $("blur") };
const outputs = { brightness: $("out-brightness"), contrast: $("out-contrast"), blur: $("out-blur") };
const toggles = { grayscale: $("grayscale"), invert: $("invert") };
const cropSliders = { cropLeft: $("crop-left"), cropTop: $("crop-top"), cropRight: $("crop-right"), cropBottom: $("crop-bottom") };
const overlaySliders = { textSize: $("overlay-size"), textX: $("overlay-x"), textY: $("overlay-y") };
const percentSliders = { ...cropSliders, ...overlaySliders, resize: $("resize") }; // all sliders whose value is shown in percent
const OPPOSITE_EDGE = { cropLeft: "cropRight", cropRight: "cropLeft", cropTop: "cropBottom", cropBottom: "cropTop" };
const chooseButtons = document.querySelectorAll("[data-choose]"); // the "Choose image" button of the Editor, Compressor and Meme

// ---------- Drawing ----------

let drawPending = false;
let drawnImage = null;
let drawnEdits = "";

function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    drawPreview(getState());
  });
}

function drawPreview({ image, edits }) {
  if (!image) return;
  const key = JSON.stringify(edits);
  if (image === drawnImage && key === drawnEdits) return;
  drawnImage = image;
  drawnEdits = key;

  const size = editedSize(image, edits);
  const scale = Math.min(1, PREVIEW_MAX / Math.max(size.width, size.height));
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);
  drawEdited(canvas.getContext("2d"), image, edits, scale);
}

// ---------- Render from state ----------

export function renderEditor(state) {
  const hasImage = Boolean(state.image);
  const canEdit = hasImage;
  const canFilter = hasImage && FILTER_SUPPORTED; // only the five colour filters need canvas filters

  for (const id of ["editor-error", "compressor-error", "meme-error"]) { // the same upload error, shown in whichever tool is open
    $(id).hidden = !state.error;
    $(id).textContent = state.error;
  }
  $("editor-dropzone").hidden = hasImage;
  $("editor-preview").hidden = !hasImage;
  for (const button of chooseButtons) button.disabled = state.loading;
  $("choose-image").textContent = state.loading ? "Loading…" : "Choose image";

  for (const name of Object.keys(sliders)) {
    sliders[name].disabled = !canFilter;
    sliders[name].value = state.edits[name];
    outputs[name].textContent = name === "blur" ? `${state.edits.blur}px` : `${state.edits[name]}%`;
  }
  for (const name of Object.keys(percentSliders)) {
    percentSliders[name].disabled = !canEdit;
    percentSliders[name].value = state.edits[name];
    $(`out-${percentSliders[name].id}`).textContent = `${state.edits[name]}%`;
  }
  $("overlay-text").disabled = !canEdit;
  if (document.activeElement !== $("overlay-text")) $("overlay-text").value = state.edits.text; // do not overwrite while typing
  $("out-overlay-text").textContent = `${Array.from(state.edits.text).length}/${MAX_TEXT}`;
  $("overlay-color").disabled = !canEdit;
  $("overlay-color").value = state.edits.textColor;
  for (const name of Object.keys(toggles)) {
    toggles[name].disabled = !canFilter;
    toggles[name].setAttribute("aria-pressed", String(state.edits[name]));
  }
  for (const id of ["rotate-left", "rotate-right", "flip-h", "flip-v"]) $(id).disabled = !canEdit;
  $("flip-h").setAttribute("aria-pressed", String(state.edits.flipH));
  $("flip-v").setAttribute("aria-pressed", String(state.edits.flipV));
  $("reset").disabled = !canEdit;
  $("export").disabled = !(hasImage && (state.tool === "editor" || state.tool === "meme")); // the Meme tool has its own export listener

  if (!FILTER_SUPPORTED) $("editor-note").textContent = "This browser cannot apply canvas filters.";
  else if (!hasImage) $("editor-note").textContent = "Choose an image to use these controls.";
  else $("editor-note").textContent = "";

  if (hasImage) {
    $("file-name").textContent = state.image.name;
    const size = editedSize(state.image, state.edits);
    const result = exportSize(state.image, state.edits);
    const shown = `${size.width}×${size.height}`;
    const exported = `${result.width}×${result.height}`;
    $("file-dims").textContent = shown === exported ? shown : `${shown} → ${exported}`; // the preview keeps its size; the export is resized
    scheduleDraw();
  }
}

// ---------- Actions ----------

function changeFilter(name, value) {
  setState({ edits: { ...getState().edits, [name]: value } });
  logAfterPause("filter", "filter changed", () => {
    const { brightness, contrast, blur, grayscale, invert } = getState().edits;
    return { brightness, contrast, blur, grayscale, invert };
  });
}

// The limit for one edge: with the opposite edge, it may crop at most 90%, so at least 10% of the picture stays.
function changeCrop(name, value) {
  const edits = getState().edits;
  setState({ edits: { ...edits, [name]: Math.min(value, MAX_TRIM - edits[OPPOSITE_EDGE[name]]) } });
  logAfterPause("crop", "crop changed", () => {
    const { cropLeft, cropTop, cropRight, cropBottom } = getState().edits;
    return { cropLeft, cropTop, cropRight, cropBottom };
  });
}

function changeResize(value) {
  setState({ edits: { ...getState().edits, resize: value } });
  logAfterPause("resize", "resize changed", () => ({ resize: getState().edits.resize }));
}

// Only the length of the text is logged, never the text itself.
function changeOverlay(patch) {
  setState({ edits: { ...getState().edits, ...patch } });
  logAfterPause("overlay", "text overlay changed", () => {
    const { text, textColor, textSize, textX, textY } = getState().edits;
    return { textLength: text.length, textColor, textSize, textX, textY };
  });
}

// A slider drag (or typing) fires "input" many times, but "change" only once when it is let go (or the box is left):
// that is one undo step. changeValue gets the value as text.
function watchInput(input, changeValue) {
  input.addEventListener("input", () => {
    beginChange();
    changeValue(input.value);
  });
  input.addEventListener("change", endChange);
}

// A rotate or flip click is one undo step.
function changeOnce(patch, message) {
  beginChange();
  setState({ edits: { ...getState().edits, ...patch } });
  endChange();
  logActivity(message);
}

function rotate(degrees) {
  const rotation = (getState().edits.rotation + degrees + 360) % 360;
  changeOnce({ rotation }, `Rotated to ${rotation}°`);
}

function flip(name) {
  const on = !getState().edits[name];
  changeOnce({ [name]: on }, `${name === "flipH" ? "Horizontal" : "Vertical"} flip ${on ? "on" : "off"}`);
}

function resetEdits() {
  beginChange();
  setState({ edits: defaultEdits() });
  endChange();
  logActivity("Reset all edits to the original image");
}

async function exportImage() {
  const { image, edits } = getState();
  const isPng = image.type === "image/png";
  const type = isPng ? "image/png" : "image/jpeg"; // WebP sources are saved as JPG for now

  const out = document.createElement("canvas");
  const size = exportSize(image, edits);
  out.width = size.width;
  out.height = size.height;
  const ctx = out.getContext("2d");
  if (!isPng) {
    ctx.fillStyle = "#fff"; // JPG has no transparency
    ctx.fillRect(0, 0, out.width, out.height);
  }
  drawEdited(ctx, image, edits, edits.resize / 100);

  const blob = await canvasToBlob(out, type, 0.92);
  if (!blob) {
    logger.error("export failed", { name: image.name, type });
    setState({ error: "Export failed. The image may be too large for this browser." });
    return;
  }
  const filename = `${cleanFileName(image.name)}-edited.${isPng ? "png" : "jpg"}`;
  downloadBlob(blob, filename);
  logActivity(`Exported ${filename} (${Math.round(blob.size / 1024)} KB)`);
}

export function initEditor() {
  for (const button of chooseButtons) button.addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = ""; // lets the same file be chosen again
    if (file) loadImage(file);
  });

  for (const name of Object.keys(sliders)) watchInput(sliders[name], (value) => changeFilter(name, Number(value)));
  for (const name of Object.keys(cropSliders)) watchInput(cropSliders[name], (value) => changeCrop(name, Number(value)));
  watchInput($("resize"), (value) => changeResize(Number(value)));
  watchInput($("overlay-text"), (value) => {
    const text = cutText(value); // the limit is enforced here, not only by maxlength
    if (text !== value) $("overlay-text").value = text;
    changeOverlay({ text });
  });
  watchInput($("overlay-color"), (value) => changeOverlay({ textColor: value }));
  for (const name of Object.keys(overlaySliders)) watchInput(overlaySliders[name], (value) => changeOverlay({ [name]: Number(value) }));
  for (const name of Object.keys(toggles)) {
    toggles[name].addEventListener("click", () => {
      const on = !getState().edits[name];
      beginChange();
      changeFilter(name, on);
      endChange();
      logActivity(`${name} ${on ? "on" : "off"}`);
    });
  }
  $("rotate-left").addEventListener("click", () => rotate(-90));
  $("rotate-right").addEventListener("click", () => rotate(90));
  $("flip-h").addEventListener("click", () => flip("flipH"));
  $("flip-v").addEventListener("click", () => flip("flipV"));
  $("reset").addEventListener("click", resetEdits);
  $("export").addEventListener("click", () => {
    if (getState().tool === "editor") exportImage();
  });
}
