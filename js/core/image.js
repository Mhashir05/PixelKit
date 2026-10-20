import { logger } from "./logger.js";
import { setState, logActivity, defaultFilters } from "./state.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000; // keeps a small file with huge dimensions from exhausting memory
const THUMBNAIL_SIZE = 96; // longest side of the Recents thumbnail
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
  logger.info("upload rejected", { name: file.name, reason });
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

// ---------- Filters and thumbnail ----------

// scale is 1 for export; a smaller picture (the preview or the thumbnail) passes its own scale, so the blur radius shrinks with it.
export function filterString(filters, scale) {
  return `brightness(${filters.brightness}%) contrast(${filters.contrast}%) grayscale(${filters.grayscale ? 100 : 0}%) invert(${filters.invert ? 100 : 0}%) blur(${filters.blur * scale}px)`;
}

// Small JPEG data URL of the image with its filters applied, for the Recents list.
export function makeThumbnail(image, filters) {
  const scale = THUMBNAIL_SIZE / Math.max(image.width, image.height);
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(image.width * scale));
  thumb.height = Math.max(1, Math.round(image.height * scale));
  const ctx = thumb.getContext("2d");
  ctx.fillStyle = "#141414"; // JPEG has no transparency
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  ctx.imageSmoothingQuality = "high"; // the photo is much bigger than the thumbnail
  ctx.filter = filterString(filters, scale);
  ctx.drawImage(image.element, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.6);
}
