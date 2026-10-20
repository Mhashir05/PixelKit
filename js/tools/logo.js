import { logger, logAfterPause } from "../core/logger.js";
import { getState, setState, logActivity } from "../core/state.js";
import { canvasToBlob, downloadBlob } from "../core/export.js";
import { FONTS } from "../core/fonts.js";

const CANVAS_SIZE = 1000; // the logo is always 1000 x 1000 px
const MAX_ELEMENTS = 30;
const MAX_TEXT = 40;
const LABELS = { text: "text", rect: "rectangle", circle: "circle" };
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
const selectedControls = ["logo-color", "logo-size", "logo-x", "logo-y", "logo-delete"]; // enabled whenever an element is selected

let drawPending = false;
let drawnKey = "";
let drag = null; // { id, offsetX, offsetY } while an element is being dragged
let listKey = "";

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

// The text of a list item: "Text: Hello" for text, "Rectangle 2" for shapes.
function listLabel(element) {
  if (element.type === "text") return `Text: ${element.text.slice(0, 24) || "(empty)"}`;
  const name = LABELS[element.type];
  const number = element.id.split("-")[1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${number}`;
}

function renderList(logo) {
  // Only rebuild when the list itself changes, not when an element just moves. This keeps keyboard focus on the item.
  const key = JSON.stringify([logo.elements.map((e) => [e.id, e.text]), logo.selectedId]);
  if (key === listKey) return;
  listKey = key;
  const focusedId = $("logo-list").contains(document.activeElement) ? document.activeElement.dataset.id : null;
  const topFirst = [...logo.elements].reverse(); // the top layer is the last element, so it is listed first
  $("logo-list").replaceChildren(...topFirst.map((element) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "element-item";
    button.dataset.id = element.id;
    button.setAttribute("aria-pressed", String(element.id === logo.selectedId));
    button.textContent = listLabel(element);
    const item = document.createElement("li");
    item.append(button);
    return item;
  }));
  if (focusedId) $("logo-list").querySelector(`[data-id="${focusedId}"]`)?.focus();
}

// The controls for the selected element: which are enabled, and what they show.
function renderSelectedControls(logo, selected) {
  const isText = selected?.type === "text";
  const index = logo.elements.indexOf(selected);
  for (const id of selectedControls) $(id).disabled = !selected;
  $("logo-text").disabled = !isText;
  $("logo-font").disabled = !isText;
  $("logo-forward").disabled = !selected || index === logo.elements.length - 1;
  $("logo-backward").disabled = !selected || index === 0;
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
}

export function renderLogo(state) {
  const logo = state.logo;

  renderList(logo);
  $("logo-list-empty").hidden = logo.elements.length > 0;
  $("logo-note").textContent = logo.elements.length
    ? "Select an element in the list or click it on the canvas."
    : "Add text, a rectangle or a circle to start.";
  for (const button of addButtons) button.disabled = logo.elements.length >= MAX_ELEMENTS;

  renderSelectedControls(logo, selectedElement(logo));

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

// Never logs the logo text, only its length.
function logLater() {
  logAfterPause("logo element", "logo element changed", () => {
    const selected = selectedElement(getState().logo);
    if (!selected) return;
    return { id: selected.id, type: selected.type, size: selected.size, color: selected.color, x: selected.x, y: selected.y, textLength: selected.text.length };
  });
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

// Changes some fields of the selected element, for example { x: 10 }.
function changeSelected(patch) {
  const logo = getState().logo;
  update({ elements: logo.elements.map((e) => (e.id === logo.selectedId ? { ...e, ...patch } : e)) });
}

// For the form controls: change the element, then log once the user pauses.
function updateSelected(patch) {
  if (!selectedElement(getState().logo)) return;
  changeSelected(patch);
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
// Example: the box is 800 wide and 600 high, so the drawing is 600 x 600 with a 100 px margin on the left.
// A click 400 px from the left edge is (400 - 100) / 600 * 1000 = 500 canvas units from the left.
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

function clamp(value) {
  return Math.min(CANVAS_SIZE, Math.max(0, Math.round(value)));
}

function startDrag(event) {
  if (drag || event.button !== 0) return; // ignore a second finger or a right click
  const point = canvasPoint(event);
  const hit = elementAt(point);
  selectElement(hit ? hit.id : ""); // pressing empty space clears the selection
  if (!hit) return;
  drag = { id: hit.id, offsetX: point.x - hit.x, offsetY: point.y - hit.y };
  canvas.setPointerCapture(event.pointerId);
  logger.info("logo drag start", { id: hit.id, x: hit.x, y: hit.y });
}

function moveDrag(event) {
  if (!drag) return;
  const point = canvasPoint(event);
  changeSelected({ x: clamp(point.x - drag.offsetX), y: clamp(point.y - drag.offsetY) });
}

function endDrag() {
  if (!drag) return;
  const element = selectedElement(getState().logo);
  logger.info("logo drag end", { id: drag.id, x: element.x, y: element.y });
  drag = null;
}

// Arrow keys move the selected element. Shift makes the step bigger.
function moveWithKeys(event) {
  const selected = selectedElement(getState().logo);
  if (!selected) return;
  let dx = 0;
  let dy = 0;
  if (event.key === "ArrowLeft") dx = -1;
  else if (event.key === "ArrowRight") dx = 1;
  else if (event.key === "ArrowUp") dy = -1;
  else if (event.key === "ArrowDown") dy = 1;
  else return;
  event.preventDefault(); // stop the page or the list from scrolling
  const step = event.shiftKey ? 50 : 5;
  changeSelected({ x: clamp(selected.x + dx * step), y: clamp(selected.y + dy * step) });
  logAfterPause("logo keys", "logo keyboard move", () => {
    const moved = selectedElement(getState().logo);
    if (moved) return { id: moved.id, x: moved.x, y: moved.y };
  });
}

// The last element is drawn on top, so "forward" means one place later in the array.
function moveLayer(change) {
  const logo = getState().logo;
  const from = logo.elements.findIndex((e) => e.id === logo.selectedId);
  const to = from + change;
  if (from < 0 || to < 0 || to >= logo.elements.length) return;
  const elements = [...logo.elements];
  const moved = elements[from];
  elements[from] = elements[to];
  elements[to] = moved;
  update({ elements });
  logger.info("logo layer move", { id: logo.selectedId, from, to });
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
    const blob = await canvasToBlob(out, "image/png");
    if (!blob || blob.type !== "image/png") throw new Error(`export gave ${blob ? blob.type : "null"}`);

    const filename = `logo-${CANVAS_SIZE}x${CANVAS_SIZE}.png`;
    downloadBlob(blob, filename);
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
  $("logo-list").addEventListener("keydown", moveWithKeys);
  canvas.addEventListener("keydown", moveWithKeys);
  canvas.addEventListener("pointerdown", startDrag);
  canvas.addEventListener("pointermove", moveDrag);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  $("logo-forward").addEventListener("click", () => moveLayer(1));
  $("logo-backward").addEventListener("click", () => moveLayer(-1));

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
    logAfterPause("logo background", "logo background colour", () => ({ color: getState().logo.backgroundColor }));
  });

  $("export").addEventListener("click", () => {
    if (getState().tool === "logo") setTimeout(exportLogo, 0); // keep the heavy work out of the click handler
  });
}
