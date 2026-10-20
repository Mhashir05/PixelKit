import { logger } from "../core/logger.js";
import { getState, setState, logActivity } from "../core/state.js";

const CANVAS_SIZE = 1000; // the logo is always 1000 x 1000 px
const MAX_ELEMENTS = 30;
const MAX_TEXT = 40;
const LABELS = { text: "text", rect: "rectangle", circle: "circle" };
// System fonts only (same stacks as the Meme tool), so nothing is downloaded.
const FONTS = {
  impact: 'Impact, "Arial Black", sans-serif',
  arial: "Arial, Helvetica, sans-serif",
  georgia: "Georgia, serif",
  courier: '"Courier New", monospace',
};
// Starting values for each new element. For a rectangle, "size" is its width and the height is 60% of it.
const DEFAULTS = {
  text: { size: 160, color: "#ffffff", text: "Logo" },
  rect: { size: 300, color: "#c6ff00", text: "" },
  circle: { size: 240, color: "#ffffff", text: "" },
};

const $ = (id) => document.getElementById(id);
const canvas = $("logo-canvas");
const previewCtx = canvas.getContext("2d");
const addButtons = document.querySelectorAll("[data-add]");
const selectedControls = ["logo-text", "logo-font", "logo-color", "logo-size", "logo-x", "logo-y", "logo-delete"];

let drawPending = false;
let logTimer;
let drawnKey = "";
let listElements = null;
let listSelectedId = null;

function update(patch) {
  setState({ logo: { ...getState().logo, ...patch } });
}

function selectedElement(logo) {
  return logo.elements.find((e) => e.id === logo.selectedId);
}

// ---------- Drawing ----------
// Every drawing helper gets the context to draw on, so the preview and the export use the same code.

function fontString(element) {
  return `bold ${element.size}px ${FONTS[element.font]}`;
}

// The size of the box around an element, used for the selection outline and for clicking.
function elementBounds(ctx, element) {
  if (element.type === "text") {
    ctx.font = fontString(element);
    return { w: Math.max(ctx.measureText(element.text).width, 20), h: element.size * 1.1 };
  }
  if (element.type === "rect") return { w: element.size, h: element.size * 0.6 };
  return { w: element.size, h: element.size };
}

function drawElement(ctx, element) {
  ctx.fillStyle = element.color;
  if (element.type === "text") {
    ctx.font = fontString(element);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(element.text, element.x, element.y);
  } else if (element.type === "rect") {
    const { w, h } = elementBounds(ctx, element);
    ctx.fillRect(element.x - w / 2, element.y - h / 2, w, h);
  } else {
    ctx.beginPath();
    ctx.arc(element.x, element.y, element.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Grey squares show that the background is transparent. Preview only, never exported.
function drawChecker(ctx) {
  const tile = 25;
  for (let row = 0; row < CANVAS_SIZE / tile; row++) {
    for (let col = 0; col < CANVAS_SIZE / tile; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? "#808080" : "#6e6e6e";
      ctx.fillRect(col * tile, row * tile, tile, tile);
    }
  }
}

// Dashed outline with a dark line underneath, so it shows on any colour. Preview only.
function drawSelection(ctx, element) {
  const { w, h } = elementBounds(ctx, element);
  const pad = 12;
  const x = element.x - w / 2 - pad;
  const y = element.y - h / 2 - pad;
  ctx.setLineDash([]);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 6;
  ctx.strokeRect(x, y, w + pad * 2, h + pad * 2);
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = "#c6ff00";
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w + pad * 2, h + pad * 2);
  ctx.setLineDash([]);
}

// forPreview is false when exporting: no checkerboard and no selection outline.
function drawScene(ctx, logo, forPreview) {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (logo.backgroundOn) {
    ctx.fillStyle = logo.backgroundColor;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  } else if (forPreview) {
    drawChecker(ctx);
  }
  for (const element of logo.elements) drawElement(ctx, element);
  const selected = selectedElement(logo);
  if (forPreview && selected) drawSelection(ctx, selected);
}

function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    const { logo } = getState();
    const key = JSON.stringify([logo.elements, logo.selectedId, logo.backgroundOn, logo.backgroundColor]);
    if (key === drawnKey) return; // nothing visible changed
    drawnKey = key;
    drawScene(previewCtx, logo, true);
  });
}

// ---------- Render from state ----------

function renderList(logo) {
  if (logo.elements === listElements && logo.selectedId === listSelectedId) return;
  listElements = logo.elements;
  listSelectedId = logo.selectedId;
  $("logo-list").replaceChildren(...logo.elements.map((element) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "element-item";
    button.dataset.id = element.id;
    button.setAttribute("aria-pressed", String(element.id === logo.selectedId));
    const label = LABELS[element.type];
    const number = element.id.split("-")[1];
    button.textContent = element.type === "text" ? `Text: ${element.text.slice(0, 24) || "(empty)"}` : `${label[0].toUpperCase()}${label.slice(1)} ${number}`;
    const item = document.createElement("li");
    item.append(button);
    return item;
  }));
}

export function renderLogo(state) {
  const logo = state.logo;
  const selected = selectedElement(logo);
  const isText = selected?.type === "text";

  renderList(logo);
  $("logo-list-empty").hidden = logo.elements.length > 0;
  $("logo-note").textContent = logo.elements.length
    ? "Select an element in the list or click it on the canvas."
    : "Add text, a rectangle or a circle to start.";
  for (const button of addButtons) button.disabled = logo.elements.length >= MAX_ELEMENTS;

  for (const id of selectedControls) $(id).disabled = !selected;
  $("logo-text").disabled = !isText;
  $("logo-font").disabled = !isText;
  if (selected) {
    if (document.activeElement !== $("logo-text")) $("logo-text").value = selected.text; // do not overwrite while typing
    $("logo-font").value = selected.font;
    $("logo-color").value = selected.color;
    $("logo-size").value = selected.size;
    $("logo-x").value = selected.x;
    $("logo-y").value = selected.y;
  }
  $("out-logo-text").textContent = isText ? `${selected.text.length}/${MAX_TEXT}` : "";
  $("out-logo-size").textContent = selected ? String(selected.size) : "";
  $("out-logo-x").textContent = selected ? String(selected.x) : "";
  $("out-logo-y").textContent = selected ? String(selected.y) : "";

  $("logo-bg-toggle").setAttribute("aria-pressed", String(logo.backgroundOn));
  $("logo-bg-color").disabled = !logo.backgroundOn;
  $("logo-bg-color").value = logo.backgroundColor;

  $("logo-meta").textContent = `${CANVAS_SIZE} × ${CANVAS_SIZE} px · PNG · ${logo.backgroundOn ? "solid background" : "transparent background (the grey squares are only a preview)"}`;
  $("logo-message").textContent = logo.message;
  $("logo-message").classList.toggle("note--error", Boolean(logo.message));

  if (state.tool === "logo") {
    $("export").disabled = logo.elements.length === 0; // the shared Export button
    scheduleDraw();
  }
}

// ---------- Actions ----------

// Logs after the user pauses. Never logs the logo text, only its length.
function logLater() {
  clearTimeout(logTimer);
  logTimer = setTimeout(() => {
    const selected = selectedElement(getState().logo);
    if (!selected) return;
    logger.info("logo element changed", { id: selected.id, type: selected.type, size: selected.size, color: selected.color, x: selected.x, y: selected.y, textLength: selected.text.length });
  }, 400);
}

function addElement(type) {
  const logo = getState().logo;
  if (logo.elements.length >= MAX_ELEMENTS) {
    update({ message: `A logo can have up to ${MAX_ELEMENTS} elements.` });
    return;
  }
  const offset = (logo.elements.length % 6) * 90; // each new element starts further along, so it does not cover the previous one
  const element = { id: `logo-${logo.nextNumber}`, type, x: 300 + offset, y: 300 + offset, font: "impact", ...DEFAULTS[type] };
  update({ elements: [...logo.elements, element], selectedId: element.id, nextNumber: logo.nextNumber + 1, message: "" });
  logActivity(`Logo: added ${LABELS[type]}`);
}

function selectElement(id) {
  if (id === getState().logo.selectedId) return;
  update({ selectedId: id });
  const element = selectedElement(getState().logo);
  logger.info("logo select", { id: id || "none", type: element ? element.type : "none" });
}

function updateSelected(patch) {
  const logo = getState().logo;
  if (!selectedElement(logo)) return;
  update({ elements: logo.elements.map((e) => (e.id === logo.selectedId ? { ...e, ...patch } : e)) });
  logLater();
}

function deleteSelected() {
  const logo = getState().logo;
  const selected = selectedElement(logo);
  if (!selected) return;
  update({ elements: logo.elements.filter((e) => e.id !== selected.id), selectedId: "", message: "" });
  logActivity(`Logo: deleted ${LABELS[selected.type]}`);
}

// Turns a click on the canvas into canvas units. The canvas is shown with object-fit: contain, so it may have empty margins.
function canvasPoint(event) {
  const box = canvas.getBoundingClientRect();
  const side = Math.min(box.width, box.height);
  const x = ((event.clientX - box.left - (box.width - side) / 2) / side) * CANVAS_SIZE;
  const y = ((event.clientY - box.top - (box.height - side) / 2) / side) * CANVAS_SIZE;
  return { x, y };
}

// The element drawn last is on top, so look from the end.
function elementAt(point) {
  const { elements } = getState().logo;
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element.type === "circle") {
      if (Math.hypot(point.x - element.x, point.y - element.y) <= element.size / 2) return element;
    } else {
      const { w, h } = elementBounds(previewCtx, element);
      if (Math.abs(point.x - element.x) <= w / 2 && Math.abs(point.y - element.y) <= h / 2) return element;
    }
  }
  return null;
}

// Draws again on a fresh canvas without the preview extras, at the full size.
async function exportLogo() {
  const { logo } = getState();
  if (!logo.elements.length) return;
  update({ message: "" });
  try {
    const out = document.createElement("canvas");
    out.width = CANVAS_SIZE;
    out.height = CANVAS_SIZE;
    drawScene(out.getContext("2d"), logo, false);
    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
    if (!blob || blob.type !== "image/png") throw new Error(`export gave ${blob ? blob.type : "null"}`);

    const filename = `logo-${CANVAS_SIZE}x${CANVAS_SIZE}.png`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logActivity(`Exported ${filename} (${Math.round(blob.size / 1024)} KB, ${logo.backgroundOn ? "solid" : "transparent"} background)`);
  } catch (err) {
    logger.error("logo export failed", err);
    update({ message: "Export failed. Try again." });
  }
}

export function initLogo() {
  for (const button of addButtons) button.addEventListener("click", () => addElement(button.dataset.add));

  $("logo-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (button) selectElement(button.dataset.id);
  });
  canvas.addEventListener("click", (event) => {
    const hit = elementAt(canvasPoint(event));
    selectElement(hit ? hit.id : ""); // clicking empty space clears the selection
  });

  // These handlers only change state; the drawing happens later in requestAnimationFrame.
  $("logo-text").addEventListener("input", () => {
    const text = $("logo-text").value.slice(0, MAX_TEXT); // the limit is enforced here, not only by maxlength
    if (text !== $("logo-text").value) $("logo-text").value = text;
    updateSelected({ text });
  });
  $("logo-font").addEventListener("change", () => updateSelected({ font: $("logo-font").value }));
  $("logo-color").addEventListener("input", () => updateSelected({ color: $("logo-color").value }));
  $("logo-size").addEventListener("input", () => updateSelected({ size: Number($("logo-size").value) }));
  $("logo-x").addEventListener("input", () => updateSelected({ x: Number($("logo-x").value) }));
  $("logo-y").addEventListener("input", () => updateSelected({ y: Number($("logo-y").value) }));
  $("logo-delete").addEventListener("click", deleteSelected);

  $("logo-bg-toggle").addEventListener("click", () => {
    const on = !getState().logo.backgroundOn;
    update({ backgroundOn: on });
    logActivity(`Logo background: ${on ? "solid colour" : "transparent"}`);
  });
  $("logo-bg-color").addEventListener("input", () => {
    update({ backgroundColor: $("logo-bg-color").value });
    clearTimeout(logTimer);
    logTimer = setTimeout(() => logger.info("logo background colour", { color: getState().logo.backgroundColor }), 400);
  });

  $("export").addEventListener("click", () => {
    if (getState().tool === "logo") setTimeout(exportLogo, 0); // keep the heavy work out of the click handler
  });
}
