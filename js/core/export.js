import { logger } from "./logger.js";
import { decodeImage } from "./image.js";
import { setState } from "./state.js";

// Small helpers shared by every tool that exports, downloads or shares a file.

const SHARE_URL = "https://pixelkit-ai.hashir-dev.workers.dev/share"; // our Cloudflare Worker (see worker/)
const SHARE_MAX_SIDE = 1600; // longest side of the uploaded copy
const SHARE_MIN_SIDE = 200; // the Worker needs at least 200 x 200; smaller images are padded, not enlarged
const SHARE_MAX_BYTES = 1.4 * 1024 * 1024; // the Worker accepts up to 1.5 MB
const SHARE_QUALITIES = [0.85, 0.7, 0.55]; // JPEG qualities tried in order until the copy is small enough
const SHARE_TIMEOUT = 30000;
const FB_APP_ID = "1460147916314602"; // our Meta app id: a public value, not a secret. Empty keeps the older sharer.php link.
const TOO_LARGE = "This image is too large to share.";
const LIMIT_REACHED = "Daily share limit reached. Try again tomorrow.";
const UPLOADING = "Uploading a copy of this image so Facebook can show it. The link works for 7 days.";
const OPENED = "Facebook opened in a new tab. Nothing is posted until you click Post there.";
const PREPARE_FAILED = "Could not prepare the image to share. Try again.";
let sharing = false; // one upload at a time

export const isSharing = () => sharing;
export const isShareNotice = (message) => message === UPLOADING || message === OPENED; // shown in a neutral style, not as an error
// "Share with an app" is only shown where the browser can share image files.
export const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "image.png", { type: "image/png" })] });

// The one place that decides how Facebook is opened: the official Share Dialog when FB_APP_ID is set,
// otherwise sharer.php, which Facebook does not document and may change.
export function facebookShareUrl(url) {
  const link = encodeURIComponent(url);
  if (!FB_APP_ID) return `https://www.facebook.com/sharer/sharer.php?u=${link}`;
  // redirect_uri is our share page, so after Post or Cancel the tab shows the shared image
  return `https://www.facebook.com/dialog/share?app_id=${encodeURIComponent(FB_APP_ID)}&display=popup&href=${link}&redirect_uri=${link}`;
}

// A JPEG copy for the public link: at most SHARE_MAX_SIDE, white behind transparent parts, at most SHARE_MAX_BYTES.
async function shareCopy(file) {
  const element = await decodeImage(file);
  const scale = Math.min(1, SHARE_MAX_SIDE / Math.max(element.naturalWidth, element.naturalHeight));
  const width = Math.round(element.naturalWidth * scale);
  const height = Math.round(element.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(width, SHARE_MIN_SIDE);
  canvas.height = Math.max(height, SHARE_MIN_SIDE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // JPG has no transparency; without this, transparent areas (and the padding) turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(element, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  for (const quality of SHARE_QUALITIES) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob && blob.size <= SHARE_MAX_BYTES) return { blob, width: canvas.width, height: canvas.height };
  }
  throw new Error(TOO_LARGE);
}

// Uploads the copy and returns the address of its public share page.
async function uploadCopy(copy) {
  const body = new FormData();
  body.append("image", copy.blob, "share.jpg");
  body.append("width", String(copy.width));
  body.append("height", String(copy.height));
  const response = await fetch(SHARE_URL, { method: "POST", body, signal: AbortSignal.timeout(SHARE_TIMEOUT) });
  if (response.status === 429) throw new Error(LIMIT_REACHED);
  if (!response.ok) throw new Error(`share upload failed with ${response.status}`);
  const { url } = await response.json();
  if (typeof url !== "string" || new URL(url).origin !== new URL(SHARE_URL).origin) throw new Error("share upload returned a bad url");
  logger.info("share copy uploaded", { bytes: copy.blob.size, width: copy.width, height: copy.height }); // never the link itself
  return url;
}

// makeFile returns the file the tool would export; show puts a message in the tool's own message area.
export async function shareToFacebook(makeFile, show) {
  if (sharing) return; // a double click starts only one upload
  const popup = window.open("", "_blank"); // opened inside the click, so pop-up blockers allow it
  if (!popup) return show("Allow pop-ups for this site and try again.");
  sharing = true;
  show(UPLOADING);
  let message = OPENED;
  let file;
  try {
    file = await makeFile();
  } catch (err) { // the image could not be made, so nothing is uploaded
    popup.close();
    logger.error("share image could not be prepared", err);
    sharing = false; // before show(), so the render that follows enables the buttons again
    return show(PREPARE_FAILED);
  }
  try {
    if (!file) { // the tool could not make the file and already showed its own message
      popup.close();
      sharing = false;
      setState({}); // draw again, so the Share buttons are enabled
      return;
    }
    const url = await uploadCopy(await shareCopy(file));
    popup.opener = null; // Facebook's page must not reach back into PixelKit
    popup.location.href = facebookShareUrl(url);
  } catch (err) {
    popup.close();
    logger.error("share to facebook failed", err);
    message = [TOO_LARGE, LIMIT_REACHED].includes(err.message) ? err.message : "Could not upload the image. Try again later.";
  }
  sharing = false; // before show(), so the render that follows enables the buttons again
  show(message);
}

// Shares the exact exported file through the device's share sheet. Nothing is uploaded to PixelKit.
export async function shareWithApp(makeFile, show) {
  let file;
  try {
    file = await makeFile();
  } catch (err) { // the image could not be made, so the share sheet is not opened
    logger.error("share image could not be prepared", err);
    return show(PREPARE_FAILED);
  }
  if (!file) return; // the tool already showed its own message
  try {
    await navigator.share({ files: [file] });
    logger.info("shared with an app", { type: file.type, bytes: file.size });
  } catch (err) {
    if (err.name === "AbortError") return; // the user closed the share sheet
    logger.error("share with an app failed", err);
    show("Sharing is not available on this device.");
  }
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let lastDownloadAt = 0;
const DOWNLOAD_COOLDOWN = 1000; // a double click must not save the same file twice

// Starts a download in the browser. The temporary URL is released one second later.
export function downloadBlob(blob, filename) {
  if (Date.now() - lastDownloadAt < DOWNLOAD_COOLDOWN) return logger.info("duplicate download ignored", { filename });
  lastDownloadAt = Date.now();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "My photo (1).PNG" becomes "My_photo_1_": no extension, only letters, digits, "_" and "-", at most 40 characters.
export function cleanFileName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "image";
}
