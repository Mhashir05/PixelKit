import { logger, logAfterPause } from "../core/logger.js";
import { getState, setState, logActivity, defaultFilters } from "../core/state.js";
import { canvasToBlob, downloadBlob, cleanFileName } from "../core/export.js";
import { loadImage, filterString } from "../core/image.js";

const PREVIEW_MAX = 1200; // longest side of the preview canvas; export uses the full size
const FILTER_SUPPORTED = "filter" in document.createElement("canvas").getContext("2d");

const $ = (id) => document.getElementById(id);
const canvas = $("editor-canvas");
const sliders = { brightness: $("brightness"), contrast: $("contrast"), blur: $("blur") };
const outputs = { brightness: $("out-brightness"), contrast: $("out-contrast"), blur: $("out-blur") };
const toggles = { grayscale: $("grayscale"), invert: $("invert") };
const chooseButtons = document.querySelectorAll("[data-choose]"); // the "Choose image" button of the Editor, Compressor and Meme

// ---------- Drawing ----------

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

// ---------- Render from state ----------

export function renderEditor(state) {
  const hasImage = Boolean(state.image);
  const canEdit = hasImage && FILTER_SUPPORTED;

  for (const id of ["editor-error", "compressor-error", "meme-error"]) { // the same upload error, shown in whichever tool is open
    $(id).hidden = !state.error;
    $(id).textContent = state.error;
  }
  $("editor-dropzone").hidden = hasImage;
  $("editor-preview").hidden = !hasImage;
  for (const button of chooseButtons) button.disabled = state.loading;
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

function changeFilter(name, value) {
  setState({ filters: { ...getState().filters, [name]: value } });
  logAfterPause("filter", "filter changed", () => ({ ...getState().filters }));
}

function resetFilters() {
  setState({ filters: defaultFilters() });
  logActivity("Reset filters to the original image");
}

async function exportImage() {
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
