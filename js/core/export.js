import { logger } from "./logger.js";
import { decodeImage } from "./image.js";
import { getState, setState } from "./state.js";

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
const PREPARE_FAILED = "Could not prepare the image to share. Try again.";
const INSTAGRAM_URL = "https://www.instagram.com"; // the home page only: Instagram has no web share address
const INSTAGRAM_SAVED = "Your image was saved. In Instagram, click Create, then Post, and choose it from your downloads.";
const INSTAGRAM_BLOCKED = "Your image was saved. Pop-ups are blocked, so open instagram.com yourself, click Create, then Post, and choose it from your downloads.";
const APPS_SAVED = "Your image was saved. Open TikTok or any other app and upload it from your downloads.";
let sharing = false; // one upload at a time

export const isSharing = () => sharing;
export const isShareNotice = (message) => [INSTAGRAM_SAVED, INSTAGRAM_BLOCKED, APPS_SAVED].includes(message) || [FACEBOOK, SNAPCHAT].some((site) => message === site.uploading || message === site.opened); // shown in a neutral style, not as an error
// Only devices that can share image files can use the share sheet (see isPhone).
const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "image.png", { type: "image/png" })] });
logger.info("share with an app supported", { canShareFiles });
// Phones and tablets skip the menu and open the share sheet, so the chosen app opens directly. userAgentData.mobile is the
// browser's own answer (Chromium); Safari and Firefox lack it, so a touch-only pointer stands in. Desktops always keep the menu.
const isPhone = canShareFiles && (navigator.userAgentData?.mobile ?? window.matchMedia("(pointer: coarse)").matches);
logger.info("share button mode", { mode: isPhone ? "device share sheet" : "menu" });

// The one place that decides how Facebook is opened: the official Share Dialog when FB_APP_ID is set,
// otherwise sharer.php, which Facebook does not document and may change.
export function facebookShareUrl(url) {
  const link = encodeURIComponent(url);
  if (!FB_APP_ID) return `https://www.facebook.com/sharer/sharer.php?u=${link}`;
  // redirect_uri is our share page, so after Post or Cancel the tab shows the shared image
  return `https://www.facebook.com/dialog/share?app_id=${encodeURIComponent(FB_APP_ID)}&display=popup&href=${link}&redirect_uri=${link}`;
}

// The one place that builds the Snapchat address: its official link share page, no app id needed.
export function snapchatShareUrl(url) {
  return `https://www.snapchat.com/share?link=${encodeURIComponent(url)}`;
}

// What differs between the sites that share our public link; everything else is shareByLink.
const FACEBOOK = {
  name: "facebook",
  buildUrl: facebookShareUrl,
  uploading: "Uploading a copy of this image so Facebook can show it. The link works for up to a year.",
  opened: "Facebook opened in a new tab. Nothing is posted until you click Post there.",
};
const SNAPCHAT = {
  name: "snapchat",
  buildUrl: snapchatShareUrl,
  uploading: "Uploading a copy of this image so Snapchat can show it. The link works for up to a year.",
  opened: "Snapchat opened in a new tab. Nothing is sent until you send it there.",
};
logger.info("facebook share mode", { mode: FB_APP_ID ? "share dialog with app id" : "sharer.php fallback" });

// A JPEG copy for the public link: at most SHARE_MAX_SIDE, white behind transparent parts, at most SHARE_MAX_BYTES.
async function shareCopy(file) {
  const started = performance.now();
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
    if (blob && blob.size <= SHARE_MAX_BYTES) {
      logger.info("share copy made", { source: `${element.naturalWidth}x${element.naturalHeight}`, copy: `${canvas.width}x${canvas.height}`, quality, bytes: blob.size, ms: Math.round(performance.now() - started) });
      return { blob, width: canvas.width, height: canvas.height };
    }
  }
  throw new Error(TOO_LARGE);
}

// Uploads the copy and returns the address of its public share page.
async function uploadCopy(copy) {
  const body = new FormData();
  body.append("image", copy.blob, "share.jpg");
  body.append("width", String(copy.width));
  body.append("height", String(copy.height));
  logger.info("share upload started", { host: new URL(SHARE_URL).hostname });
  const started = performance.now();
  const response = await fetch(SHARE_URL, { method: "POST", body, signal: AbortSignal.timeout(SHARE_TIMEOUT) });
  logger.info("share upload finished", { status: response.status, ms: Math.round(performance.now() - started) });
  if (response.status === 429) throw new Error(LIMIT_REACHED);
  if (!response.ok) throw new Error(`share upload failed with ${response.status}`);
  const { url } = await response.json();
  if (typeof url !== "string" || new URL(url).origin !== new URL(SHARE_URL).origin) throw new Error("share upload returned a bad url");
  logger.info("share copy uploaded", { bytes: copy.blob.size, width: copy.width, height: copy.height }); // never the link itself
  return url;
}

// makeFile returns the file the tool would export; show puts a message in the tool's own message area.
export const shareToFacebook = (makeFile, show) => shareByLink(FACEBOOK, makeFile, show);
export const shareToSnapchat = (makeFile, show) => shareByLink(SNAPCHAT, makeFile, show);

// Uploads a copy, then sends the already open pop-up to the site's share page for our public link.
async function shareByLink(site, makeFile, show) {
  if (sharing) return; // a double click starts only one upload
  const started = performance.now();
  logger.info(`share to ${site.name} started`, { tool: getState().tool });
  const popup = window.open("", "_blank"); // opened inside the click, so pop-up blockers allow it
  logger.info("share popup opened", { opened: Boolean(popup) });
  if (!popup) return show("Allow pop-ups for this site and try again.");
  sharing = true;
  show(site.uploading);
  let message = site.opened;
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
    logger.info("share file made", { type: file.type, bytes: file.size });
    const url = await uploadCopy(await shareCopy(file));
    popup.opener = null; // the site's page must not reach back into PixelKit
    popup.location.href = site.buildUrl(url);
    logger.info("share popup navigated", { site: site.name, ms: Math.round(performance.now() - started) }); // never the address
  } catch (err) {
    popup.close();
    logger.error(`share to ${site.name} failed`, err);
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
  logger.info("share with an app started", { type: file.type, bytes: file.size });
  try {
    await navigator.share({ files: [file] });
    logger.info("shared with an app", { type: file.type, bytes: file.size });
  } catch (err) {
    if (err.name === "AbortError") return logger.info("share with an app cancelled"); // the user closed the share sheet
    logger.error("share with an app failed", err);
    show("Sharing is not available on this device.");
  }
}

// Instagram, TikTok and most apps have no web share address: save the file so the user can upload it there by hand.
async function saveForUpload(makeFile, show, notice) {
  let file;
  try {
    file = await makeFile();
  } catch (err) { // the image could not be made, so nothing is saved
    logger.error("share image could not be prepared", err);
    return show(PREPARE_FAILED);
  }
  if (!file) return; // the tool already showed its own message
  downloadBlob(file, file.name); // the same file and name as the tool's own download
  logger.info("share image saved for upload", { type: file.type, bytes: file.size });
  show(notice);
}

// Opens instagram.com inside the click (before any await, so pop-up blockers allow it), then saves the image.
function shareToInstagram(makeFile, show) {
  const popup = window.open("", "_blank");
  logger.info("share popup opened", { opened: Boolean(popup) });
  if (popup) {
    popup.opener = null; // Instagram's page must not reach back into PixelKit
    popup.location.href = INSTAGRAM_URL;
  }
  return saveForUpload(makeFile, show, popup ? INSTAGRAM_SAVED : INSTAGRAM_BLOCKED);
}

// Desktop "More apps": the share sheet of desktop systems lists no social apps, so the image is saved instead.
const saveForApps = (makeFile, show) => saveForUpload(makeFile, show, APPS_SAVED);

// ---------- Share menu: one Share button that lists Facebook, Snapchat, Instagram and More apps ----------

const SHARE_ACTIONS = { facebook: shareToFacebook, snapchat: shareToSnapchat, instagram: shareToInstagram, app: saveForApps };
const menuTargets = {}; // menu id prefix -> { tool: { makeFile, show } }; the strip's one menu serves Editor, Meme and Logo
const menuParts = (prefix) => ({ button: document.getElementById(`${prefix}-menu-btn`), menu: document.getElementById(`${prefix}-menu`) });

function setMenuOpen(prefix, open) {
  const { button, menu } = menuParts(prefix);
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

// Connects a tool's file to the menu with the ids `${prefix}-menu-btn` and `${prefix}-menu`.
export function initShareMenu(prefix, tool, makeFile, show) {
  const known = prefix in menuTargets;
  menuTargets[prefix] = { ...menuTargets[prefix], [tool]: { makeFile, show } };
  if (known) return; // the menu's own listeners are added only once
  const { button, menu } = menuParts(prefix);
  const choose = (item, action = SHARE_ACTIONS[item]) => {
    const target = menuTargets[prefix][getState().tool];
    if (!target) return;
    logger.info("share chosen", { path: isPhone ? "device share sheet" : "menu", item, tool: getState().tool });
    action(target.makeFile, target.show);
  };
  if (isPhone) { // no menu on phones: the button opens the share sheet straight away
    for (const name of ["aria-haspopup", "aria-expanded", "aria-controls"]) button.removeAttribute(name);
    button.addEventListener("click", () => choose("app", shareWithApp));
    return;
  }
  const items = [...menu.querySelectorAll("[role=menuitem]")];
  button.addEventListener("click", () => {
    setMenuOpen(prefix, menu.hidden);
    if (!menu.hidden) items[0].focus();
  });
  document.addEventListener("click", (event) => {
    if (!menu.hidden && !button.parentElement.contains(event.target)) setMenuOpen(prefix, false);
  });
  button.parentElement.addEventListener("keydown", (event) => {
    if (menu.hidden) return;
    if (event.key === "Escape") {
      setMenuOpen(prefix, false);
      button.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") { // moves between the visible items, wrapping around
      event.preventDefault();
      const visible = items.filter((item) => !item.hidden);
      const index = visible.indexOf(document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index === -1 ? (step === 1 ? 0 : visible.length - 1) : (index + step + visible.length) % visible.length;
      visible[next].focus();
    }
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-share]");
    if (!item) return;
    setMenuOpen(prefix, false); // only hides the menu, so the pop-up below still opens inside this click
    choose(item.dataset.share);
  });
}

// Draws the Share button. While an upload runs, the button and every item are disabled.
export function renderShareMenu(prefix, disabled, hidden = false) {
  const { button, menu } = menuParts(prefix);
  button.disabled = disabled;
  button.parentElement.hidden = hidden;
  for (const item of menu.querySelectorAll("[role=menuitem]")) item.disabled = sharing;
  if (!isPhone && (disabled || hidden)) setMenuOpen(prefix, false); // phones never open the menu and have no aria-expanded
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
