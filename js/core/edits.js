import { FONTS, outlineColor } from "./fonts.js";

// The edit settings of a photo: their defaults, a check for stored data, and how they are drawn.
// The settings never change the original image; they are applied every time the picture is drawn.

export const MAX_TRIM = 90; // percent of one edge that can be cropped away
export const MAX_TEXT = 60; // characters in the text overlay

// The text is cut to 60 whole characters, so an emoji is never split in half.
export const cutText = (text) => Array.from(text).slice(0, MAX_TEXT).join("");

export const defaultEdits = () => ({ brightness: 100, contrast: 100, blur: 0, grayscale: false, invert: false, rotation: 0, flipH: false, flipV: false, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0, resize: 100, text: "", textColor: "#ffffff", textSize: 8, textX: 50, textY: 50 });

// Stored data can be edited by anyone with DevTools, so check it before use.
export function cleanEdits(edits = {}) {
  const num = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
  // Left and right (and top and bottom) together may crop at most 90%, so at least 10% of the picture stays.
  const cropLeft = num(edits.cropLeft, 0, MAX_TRIM, 0);
  const cropTop = num(edits.cropTop, 0, MAX_TRIM, 0);
  return {
    brightness: num(edits.brightness, 0, 200, 100),
    contrast: num(edits.contrast, 0, 200, 100),
    blur: num(edits.blur, 0, 20, 0),
    grayscale: edits.grayscale === true,
    invert: edits.invert === true,
    rotation: [0, 90, 180, 270].includes(edits.rotation) ? edits.rotation : 0,
    flipH: edits.flipH === true,
    flipV: edits.flipV === true,
    cropLeft,
    cropTop,
    cropRight: num(edits.cropRight, 0, MAX_TRIM - cropLeft, 0),
    cropBottom: num(edits.cropBottom, 0, MAX_TRIM - cropTop, 0),
    resize: num(edits.resize, 10, 100, 100),
    text: typeof edits.text === "string" ? cutText(edits.text) : "",
    textColor: /^#[0-9a-f]{6}$/i.test(edits.textColor) ? edits.textColor : "#ffffff",
    textSize: num(edits.textSize, 2, 30, 8), // percent of the width of the picture
    textX: num(edits.textX, 0, 100, 50), // the middle of the text, in percent of the picture
    textY: num(edits.textY, 0, 100, 50),
  };
}

// scale is 1 for export; a smaller picture (the preview or the thumbnail) passes its own scale, so the blur radius shrinks with it.
function filterString(edits, scale) {
  return `brightness(${edits.brightness}%) contrast(${edits.contrast}%) grayscale(${edits.grayscale ? 100 : 0}%) invert(${edits.invert ? 100 : 0}%) blur(${edits.blur * scale}px)`;
}

const isSideways = (edits) => edits.rotation === 90 || edits.rotation === 270;

// The part of the ORIGINAL photo that stays visible, in pixels. The user crops the picture as it looks (after rotating
// and flipping), but the original is not turned, so the four trims must be moved to the right edges of the original.
// Example: the photo is rotated 90 degrees clockwise and the user crops 10% from the LEFT. Turning the photo clockwise
// moved the original's BOTTOM edge to the left, so 10% is cut from the original's bottom.
function sourceRect(image, edits) {
  let seen = [edits.cropTop, edits.cropRight, edits.cropBottom, edits.cropLeft]; // the trims, clockwise from the top
  if (edits.flipH) seen = [seen[0], seen[3], seen[2], seen[1]]; // a mirror swaps left and right
  if (edits.flipV) seen = [seen[2], seen[1], seen[0], seen[3]]; // and top and bottom
  const turns = edits.rotation / 90; // every clockwise turn moved each edge of the original one place clockwise
  const trim = (side) => seen[(side + turns) % 4]; // side 0 = top, 1 = right, 2 = bottom, 3 = left (of the original)
  const x = (image.width * trim(3)) / 100;
  const y = (image.height * trim(0)) / 100;
  return { x, y, width: image.width * (1 - (trim(3) + trim(1)) / 100), height: image.height * (1 - (trim(0) + trim(2)) / 100) };
}

// The size of the finished picture in pixels. Width and height swap when the photo is turned by 90 or 270 degrees.
export function editedSize(image, edits) {
  const part = sourceRect(image, edits);
  const width = Math.max(1, Math.round(part.width));
  const height = Math.max(1, Math.round(part.height));
  return isSideways(edits) ? { width: height, height: width } : { width, height };
}

// The size of the exported file: the cropped size, shrunk by the resize percentage. It is never smaller than 1 pixel.
export function exportSize(image, edits) {
  const size = editedSize(image, edits);
  return { width: Math.max(1, Math.round((size.width * edits.resize) / 100)), height: Math.max(1, Math.round((size.height * edits.resize) / 100)) };
}

// The text overlay is drawn last, on the finished picture, so the colour filters do not change it.
// Its size and position are percentages of the picture, so the preview and the export look the same.
function drawText(ctx, edits) {
  if (!edits.text) return;
  const { width, height } = ctx.canvas;
  const size = (width * edits.textSize) / 100;
  const x = (width * edits.textX) / 100;
  const y = (height * edits.textY) / 100;
  ctx.filter = "none";
  ctx.font = `bold ${size}px ${FONTS.arial}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = outlineColor(edits.textColor);
  ctx.fillStyle = edits.textColor;
  ctx.strokeText(edits.text, x, y);
  ctx.fillText(edits.text, x, y);
}

// Draws the photo with its edits so that it fills the canvas of ctx. The preview, the export and the thumbnail all use this.
export function drawEdited(ctx, image, edits, scale) {
  const { width, height } = ctx.canvas;
  ctx.filter = filterString(edits, scale);
  ctx.save();
  ctx.translate(width / 2, height / 2); // work from the middle of the canvas
  ctx.scale(edits.flipH ? -1 : 1, edits.flipV ? -1 : 1); // mirror what the user sees
  ctx.rotate((edits.rotation * Math.PI) / 180);
  // The photo is drawn upright and centred. When it is turned by 90 or 270 degrees, the canvas is the other way round.
  const w = isSideways(edits) ? height : width;
  const h = isSideways(edits) ? width : height;
  const part = sourceRect(image, edits);
  ctx.drawImage(image.element, part.x, part.y, part.width, part.height, -w / 2, -h / 2, w, h);
  ctx.restore();
  drawText(ctx, edits);
}
