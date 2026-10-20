import { logger } from "../core/logger.js";
import { getState, setState, logActivity } from "../core/state.js";
import { loadImage } from "../core/image.js";

const API = "https://picsum.photos";
const PAGE_SIZE = 20;
const MAX_FULL_SIDE = 3000; // the picked photo is downloaded at most this many pixels on its longest side
const MAX_BYTES = 10 * 1024 * 1024; // same limit as uploads
const REQUEST_TIMEOUT = 15000;

const $ = (id) => document.getElementById(id);
const grid = $("catalog-grid");
const scroller = $("catalog-scroll");
const sentinel = $("catalog-sentinel");

let loading = false; // guard: never two page requests at once
let observer = null; // exists only while the Catalog tool is open
let renderedCount = 0; // how many photos already have a grid item
let shownUsingId = null;

function update(patch) {
  setState({ catalog: { ...getState().catalog, ...patch } });
}

// ---------- Fetching the list ----------

// Remote data is checked before use: ids must be digits and sizes must be positive numbers.
function cleanPhotos(data) {
  if (!Array.isArray(data)) throw new Error("unexpected response from Picsum");
  return data
    .filter((p) => p && /^\d+$/.test(String(p.id)) && Number(p.width) > 0 && Number(p.height) > 0)
    .map((p) => ({ id: String(p.id), author: String(p.author || "Unknown").slice(0, 60), width: Number(p.width), height: Number(p.height) }));
}

async function fetchPage(page) {
  const response = await fetch(`${API}/v2/list?page=${page}&limit=${PAGE_SIZE}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!response.ok) throw new Error(`Picsum answered HTTP ${response.status}`);
  return cleanPhotos(await response.json());
}

async function loadNextPage() {
  const { page, done, error } = getState().catalog;
  if (loading || done || error) return; // a failed page waits for the Retry button, so there is no loop
  loading = true;
  const next = page + 1;
  update({ loading: true });
  logger.info("catalog page requested", { page: next });
  try {
    const photos = await fetchPage(next);
    const known = new Set(getState().catalog.photos.map((p) => p.id));
    const fresh = photos.filter((p) => !known.has(p.id));
    const reachedEnd = photos.length < PAGE_SIZE;
    update({ photos: [...getState().catalog.photos, ...fresh], page: next, loading: false, done: reachedEnd });
    logger.info("catalog page loaded", { page: next, received: photos.length, total: getState().catalog.photos.length });
    if (reachedEnd) logger.info("catalog end reached");
  } catch (err) {
    logger.error("catalog page failed", err);
    update({ loading: false, error: "Could not load photos. Check your connection and try again." });
  } finally {
    loading = false;
  }
  watchEnd(); // if the end of the grid is still on screen, the next page is loaded
}

function retry() {
  logActivity(`Catalog: retrying page ${getState().catalog.page + 1}`);
  update({ error: "", done: false });
  loadNextPage();
}

// ---------- Infinite scrolling ----------

function startObserving() {
  if (observer) return;
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadNextPage();
  }, { root: scroller, rootMargin: "0px 0px 100px 0px" }); // start loading 100px before the end
  observer.observe(sentinel);
}

function stopObserving() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
}

// Observing again makes the browser report the current state, so a short grid keeps filling.
function watchEnd() {
  if (!observer) return;
  observer.unobserve(sentinel);
  observer.observe(sentinel);
}

// ---------- Use this image ----------

function fitWithin(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Downloads with fetch (CORS), so the bytes are ours and the canvas is never tainted.
async function downloadPhoto(photo) {
  const size = fitWithin(photo.width, photo.height, MAX_FULL_SIDE);
  const response = await fetch(`${API}/id/${photo.id}/${size.width}/${size.height}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT * 2) });
  if (!response.ok) throw new Error(`Picsum answered HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("the photo is larger than 10 MB");
  const blob = await response.blob();
  logger.info("catalog photo downloaded", { id: photo.id, type: blob.type, bytes: blob.size });
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[blob.type] || "img";
  return new File([blob], `picsum-${photo.id}.${extension}`, { type: blob.type });
}

function describeUseError(err) {
  if (err.name === "TimeoutError") return "The download took too long. Try again.";
  if (err instanceof TypeError) return "Could not download the photo. The network, a browser security rule (CORS or the Content Security Policy) or Picsum is blocking it.";
  return `Could not use this photo: ${err.message}.`;
}

async function useImage(photo) {
  if (getState().catalog.usingId) return; // one download at a time
  update({ usingId: photo.id, useError: "" });
  logActivity(`Catalog: using photo ${photo.id} by ${photo.author}`);
  try {
    const file = await downloadPhoto(photo);
    await loadImage(file); // the same checks as an upload: size, type, file signature, no SVG
    const state = getState();
    if (state.image && state.image.file === file) {
      setState({ tool: "editor" });
      logActivity(`Opened ${file.name} in the Editor`);
    } else {
      update({ useError: state.error || "The photo was rejected." });
      setState({ error: "" }); // the Catalog shows this message itself
    }
  } catch (err) {
    logger.error("catalog use image failed", err);
    update({ useError: describeUseError(err) });
  }
  update({ usingId: "" });
}

// ---------- Render from state ----------

function makeItem(photo) {
  const item = document.createElement("li");
  item.className = "catalog-item";

  const img = document.createElement("img");
  img.src = `${API}/id/${photo.id}/300/200`;
  img.alt = `Photo by ${photo.author}`;
  img.width = 300;
  img.height = 200;
  img.loading = "lazy";
  img.addEventListener("error", () => img.classList.add("is-broken"));

  const author = document.createElement("span");
  author.className = "catalog-item__author";
  author.textContent = photo.author;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.dataset.use = photo.id;
  button.textContent = "Use this image";
  button.setAttribute("aria-label", `Use this image: photo by ${photo.author}`);

  item.append(img, author, button);
  return item;
}

export function renderCatalog(state) {
  const c = state.catalog;

  if (state.tool === "catalog") startObserving();
  else stopObserving();

  for (const photo of c.photos.slice(renderedCount)) grid.append(makeItem(photo)); // only new photos are added
  renderedCount = c.photos.length;

  if (c.usingId !== shownUsingId) {
    shownUsingId = c.usingId;
    for (const button of grid.querySelectorAll("[data-use]")) {
      button.disabled = Boolean(c.usingId);
      button.textContent = button.dataset.use === c.usingId ? "Loading…" : "Use this image";
    }
  }

  const empty = c.done && c.photos.length === 0;
  let status = "";
  if (c.loading) status = c.photos.length ? "Loading more photos…" : "Loading photos…";
  else if (c.error) status = c.error;
  else if (empty) status = "Picsum returned no photos.";
  else if (c.done) status = "That is every photo Picsum offers.";
  $("catalog-status-text").textContent = status;
  $("catalog-status-text").classList.toggle("note--error", Boolean(c.error));
  $("catalog-retry").hidden = !(c.error || empty);

  $("catalog-use-error").hidden = !c.useError;
  $("catalog-use-error").textContent = c.useError;
  $("catalog-note").textContent = c.photos.length
    ? `${c.photos.length} photos loaded from Picsum. Scroll for more.`
    : "Photos come from Picsum. Nothing is uploaded.";
}

export function initCatalog() {
  $("catalog-retry").addEventListener("click", retry);
  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-use]");
    if (!button) return;
    const photo = getState().catalog.photos.find((p) => p.id === button.dataset.use);
    if (photo) useImage(photo);
  });
}
