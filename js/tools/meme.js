import { logger } from "../core/logger.js";
import { getState, setState, logActivity } from "../core/state.js";

// Common sizes: 1080 px wide is what Instagram and WhatsApp display; the heights give the usual ratios.
const PRESETS = {
  square: { label: "Instagram post", width: 1080, height: 1080, ratio: "1:1" },
  portrait: { label: "Instagram portrait", width: 1080, height: 1350, ratio: "4:5" },
  status: { label: "WhatsApp Status", width: 1080, height: 1920, ratio: "9:16" },
};
// System fonts only: nothing to download, so the Content Security Policy is not involved.
// Each stack ends with a generic family, so a missing font falls back to something readable.
const FONTS = {
  impact: 'Impact, "Arial Black", sans-serif',
  arial: "Arial, Helvetica, sans-serif",
  georgia: "Georgia, serif",
  courier: '"Courier New", monospace',
};
const EXPORT_TYPES = { "image/jpeg": { label: "JPG", extension: "jpg" }, "image/png": { label: "PNG", extension: "png" } };

const MAX_TEXT = 100;
const PREVIEW_MAX = 900; // longest side of the preview canvas; export uses the full preset size
const SIDE_MARGIN = 0.05; // text may use 90% of the width
const MAX_BLOCK = 0.4; // top or bottom text may use up to 40% of the height

const $ = (id) => document.getElementById(id);
const canvas = $("meme-canvas");
const presetButtons = document.querySelectorAll("[data-preset]");
const typeButtons = document.querySelectorAll("[data-export-type]");

let drawPending = false;
let drawnImage = null;
let drawnKey = "";
let logTimer;

function update(patch) {
  setState({ meme: { ...getState().meme, ...patch } });
}

// ---------- Drawing ----------

// Fills the canvas with the image, centred and cropped (the "cover" fit).
function drawImageCover(ctx, width, height, element) {
  const scale = Math.max(width / element.naturalWidth, height / element.naturalHeight);
  const sourceW = width / scale;
  const sourceH = height / scale;
  const sourceX = (element.naturalWidth - sourceW) / 2;
  const sourceY = (element.naturalHeight - sourceH) / 2;
  ctx.drawImage(element, sourceX, sourceY, sourceW, sourceH, 0, 0, width, height);
}

// Splits text into lines that fit maxWidth. A single very long word is cut by characters.
function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const attempt = line ? `${line} ${word}` : word;
    if (ctx.measureText(attempt).width <= maxWidth) {
      line = attempt;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (line.length > 1 && ctx.measureText(line).width > maxWidth) {
      let cut = line.length - 1;
      while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Dark text gets a light outline and light text gets a dark one, so it reads on any photo.
function outlineColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000" : "#fff";
}

// Draws one block of text at the top or bottom. The font shrinks until the block fits.
function drawTextBlock(ctx, text, position, width, height, meme) {
  if (!text) return;
  const maxWidth = width * (1 - 2 * SIDE_MARGIN);
  const margin = width * 0.04;
  let fontPx = (width * meme.size) / 100;
  const minPx = width * 0.02;
  let lines;
  while (true) {
    ctx.font = `bold ${fontPx}px ${FONTS[meme.font]}`;
    lines = wrapLines(ctx, text, maxWidth);
    if (lines.length * fontPx * 1.15 <= height * MAX_BLOCK || fontPx <= minPx) break;
    fontPx *= 0.9;
  }

  const lineHeight = fontPx * 1.15;
  const startY = position === "top" ? margin : height - margin - lines.length * lineHeight;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = fontPx * 0.14;
  ctx.strokeStyle = outlineColor(meme.color);
  ctx.fillStyle = meme.color;
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
  });
}

// Everything is relative to width and height, so the small preview and the full export look the same.
function drawMeme(ctx, width, height, element, meme) {
  drawImageCover(ctx, width, height, element);
  drawTextBlock(ctx, meme.top.trim(), "top", width, height, meme);
  drawTextBlock(ctx, meme.bottom.trim(), "bottom", width, height, meme);
}

function drawPreview(state) {
  const { image, meme } = state;
  if (!image) return;
  const key = JSON.stringify([meme.preset, meme.top, meme.bottom, meme.font, meme.color, meme.size]);
  if (image === drawnImage && key === drawnKey) return; // nothing visible changed
  drawnImage = image;
  drawnKey = key;

  const preset = PRESETS[meme.preset];
  const scale = Math.min(1, PREVIEW_MAX / Math.max(preset.width, preset.height));
  canvas.width = Math.round(preset.width * scale);
  canvas.height = Math.round(preset.height * scale);
  drawMeme(canvas.getContext("2d"), canvas.width, canvas.height, image.element, meme);
}

function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    drawPreview(getState());
  });
}

// ---------- Render from state ----------

export function renderMeme(state) {
  const m = state.meme;
  const hasImage = Boolean(state.image);
  const preset = PRESETS[m.preset];

  $("meme-empty").hidden = hasImage;
  $("meme-result").hidden = !hasImage;
  $("m-choose").disabled = state.loading;

  for (const id of ["meme-top", "meme-bottom", "meme-font", "meme-color", "meme-size"]) $(id).disabled = !hasImage;
  if (document.activeElement !== $("meme-top")) $("meme-top").value = m.top; // do not overwrite while typing
  if (document.activeElement !== $("meme-bottom")) $("meme-bottom").value = m.bottom;
  $("meme-font").value = m.font;
  $("meme-color").value = m.color;
  $("meme-size").value = m.size;
  $("out-meme-size").textContent = `${m.size}%`;
  for (const button of presetButtons) {
    button.disabled = !hasImage;
    button.setAttribute("aria-pressed", String(button.dataset.preset === m.preset));
  }
  for (const button of typeButtons) {
    button.disabled = !hasImage;
    button.setAttribute("aria-pressed", String(button.dataset.exportType === m.exportType));
  }

  $("meme-note").textContent = hasImage
    ? "Text wraps and shrinks to fit. The image fills the canvas, cropped from the centre."
    : "Choose an image to make a meme or post.";
  if (!hasImage) return;

  $("meme-meta").textContent = `${preset.label} · ${preset.width} × ${preset.height} px · ${preset.ratio} · Fit: centre crop to fill`;
  $("meme-message").textContent = m.error;
  $("meme-message").classList.toggle("note--error", Boolean(m.error));
  scheduleDraw();
}

// ---------- Actions ----------

function toBlob(canvasToSave, type, quality) {
  return new Promise((resolve) => canvasToSave.toBlob(resolve, type, quality));
}

// Draws at the full preset size, from the original image (not the small preview).
async function exportMeme() {
  const { image, meme } = getState();
  if (!image) return;
  const preset = PRESETS[meme.preset];
  const type = meme.exportType;
  update({ error: "" });
  try {
    const out = document.createElement("canvas");
    out.width = preset.width;
    out.height = preset.height;
    drawMeme(out.getContext("2d"), out.width, out.height, image.element, meme);
    const blob = await toBlob(out, type, 0.92);
    if (!blob || blob.type !== type) throw new Error(`export gave ${blob ? blob.type : "null"}`);

    const base = image.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "image";
    const filename = `${base}-meme-${preset.width}x${preset.height}.${EXPORT_TYPES[type].extension}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logActivity(`Exported ${filename} (${Math.round(blob.size / 1024)} KB)`);
  } catch (err) {
    logger.error("meme export failed", err);
    update({ error: "Export failed. Try the other format or a smaller preset." });
  }
}

// Logs after the user pauses. Only lengths are logged, never the text itself.
function logLater() {
  clearTimeout(logTimer);
  logTimer = setTimeout(() => {
    const { meme } = getState();
    logger.info("meme changed", { topLength: meme.top.length, bottomLength: meme.bottom.length, font: meme.font, color: meme.color, size: meme.size });
  }, 400);
}

export function initMeme() {
  $("m-choose").addEventListener("click", () => $("file-input").click()); // same picker as the Editor

  // These handlers only change state. The drawing happens later, in requestAnimationFrame.
  for (const [id, key] of [["meme-top", "top"], ["meme-bottom", "bottom"]]) {
    $(id).addEventListener("input", () => {
      const text = $(id).value.slice(0, MAX_TEXT); // the limit is enforced here, not only by maxlength
      if (text !== $(id).value) $(id).value = text;
      update({ [key]: text });
      logLater();
    });
  }
  $("meme-font").addEventListener("change", () => {
    update({ font: $("meme-font").value });
    logger.info("meme font", { font: $("meme-font").value });
  });
  $("meme-color").addEventListener("input", () => {
    update({ color: $("meme-color").value });
    logLater();
  });
  $("meme-size").addEventListener("input", () => {
    update({ size: Number($("meme-size").value) });
    logLater();
  });
  for (const button of presetButtons) {
    button.addEventListener("click", () => {
      update({ preset: button.dataset.preset });
      const preset = PRESETS[button.dataset.preset];
      logActivity(`Meme preset: ${preset.label} (${preset.width}×${preset.height})`);
    });
  }
  for (const button of typeButtons) {
    button.addEventListener("click", () => {
      update({ exportType: button.dataset.exportType });
      logActivity(`Meme export format: ${button.textContent}`);
    });
  }
  $("export").addEventListener("click", () => {
    if (getState().tool === "meme") setTimeout(exportMeme, 0); // keep the heavy work out of the click handler
  });
}
