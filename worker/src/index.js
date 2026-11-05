import { DurableObject } from "cloudflare:workers";

const ALLOWED_ORIGINS = ["https://pixelkit-wheat.vercel.app", "http://localhost:8000"];
const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_PROMPT = 300; // stricter than the model's own 2048
const MAX_BODY = 4096; // bytes; a valid request is far smaller
const STEPS = 4; // the documented default; never taken from the client
const DAILY_LIMIT = 8; // images per IP per UTC day
const LIMIT_ENABLED = false; // the per-IP daily limit is switched off for now; set to true and redeploy to re-enable it
const EDIT_MODEL = "@cf/black-forest-labs/flux-2-klein-4b"; // takes a reference image; flux-1-schnell cannot
const EDIT_SIZE = "1024"; // output width and height, as tested in the spike
const MAX_EDIT_IMAGE = 256 * 1024; // bytes; the browser sends a JPEG of at most 512x512, usually under 150 KB
const EDIT_INSTRUCTION = "Keep the background and everything else in the image exactly the same. Only make these changes: ";
const SHARE_ENABLED = true; // kill switch: false answers exactly as before the share feature (ShareStore and its migration stay)
const SHARE_TTL_DAYS = 7; // a share link and its image live this long
const SHARE_TTL_MS = SHARE_TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_SHARE_IMAGE = 1536 * 1024; // bytes; safely below the 2 MB Durable Object value limit
const MIN_SIDE = 200; // allowed width and height, only used for the og:image tags
const MAX_SIDE = 2000;
const SHARE_DAILY_LIMIT = 20; // uploads per IP per UTC day
const SHARE_LIMIT_ENABLED = true;
const SHARE_ROUTE = /^\/([si])\/([0-9a-f]{32})$/; // "s" is the page, "i" the image
const SITE_URL = "https://pixelkit-wheat.vercel.app";
const PAGE_STYLE = "img{max-width:100%;height:auto}";
const PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'sha256-f2ZvFbDSqbquk/eElmCtkXSy/FNVHA3q/k/tpBYPBx0='"; // the hash of PAGE_STYLE

const IMAGE_SIGNATURES = [
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function fail(status, message, origin) {
  return Response.json({ error: message }, { status, headers: origin ? corsHeaders(origin) : {} });
}

// Reads the real format from the first bytes; the model's output format is not documented.
function detectType(bytes) {
  const match = IMAGE_SIGNATURES.find(({ bytes: sig }) => sig.every((byte, i) => bytes[i] === byte));
  return match ? match.type : "";
}

function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readPrompt(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return "";
  try {
    const { prompt } = JSON.parse(text);
    const clean = typeof prompt === "string" ? prompt.trim() : "";
    return clean.length <= MAX_PROMPT ? clean : "";
  } catch {
    return "";
  }
}

// Returns { prompt, image } from the multipart form, or null if a field is missing, too long or not an image.
async function readEdit(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_EDIT_IMAGE + MAX_BODY) return null; // do not parse a huge body
  try {
    const form = await request.formData();
    const prompt = form.get("prompt");
    const image = form.get("image");
    const clean = typeof prompt === "string" ? prompt.trim() : "";
    if (!clean || clean.length > MAX_PROMPT) return null;
    if (!(image instanceof File) || image.size > MAX_EDIT_IMAGE) return null; // also needed: Content-Length can be missing
    const head = new Uint8Array(await image.slice(0, 4).arrayBuffer());
    return detectType(head) ? { prompt: clean, image } : null;
  } catch {
    return null;
  }
}

// ---------- Daily limit per IP ----------

// Counts images per IP hash per UTC day. One instance serves every IP. Both methods are synchronous
// (no await between the read and the write), so two requests can never both take the last slot.
export class RateLimiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, hash TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, hash))");
  }

  // Takes one slot for this IP and day. Returns false when the limit is reached.
  claim(hash, day) {
    this.sql.exec("DELETE FROM usage WHERE day != ?", day); // rows of earlier days are not needed
    const row = this.sql.exec("SELECT count FROM usage WHERE day = ? AND hash = ?", day, hash).toArray()[0];
    if (row && row.count >= DAILY_LIMIT) return false;
    this.sql.exec("INSERT INTO usage (day, hash, count) VALUES (?, ?, 1) ON CONFLICT (day, hash) DO UPDATE SET count = count + 1", day, hash);
    return true;
  }

  // Gives a slot back after a failed model call.
  release(hash, day) {
    this.sql.exec("UPDATE usage SET count = count - 1 WHERE day = ? AND hash = ? AND count > 0", day, hash);
  }
}

// The raw IP is never stored: only its SHA-256 hash and the UTC date.
async function hashIp(ip) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function claimSlot(env, ip) {
  if (!ip) throw new Error("CF-Connecting-IP is missing");
  const slot = { hash: await hashIp(ip), day: new Date().toISOString().slice(0, 10) };
  slot.allowed = await env.LIMITER.getByName("limiter").claim(slot.hash, slot.day);
  return slot;
}

async function releaseSlot(env, slot) {
  try {
    await env.LIMITER.getByName("limiter").release(slot.hash, slot.day);
  } catch (err) {
    console.error("could not release a limiter slot:", String(err));
  }
}

async function generate(request, env, origin) {
  const prompt = await readPrompt(request);
  if (!prompt) return fail(400, `Send JSON like { "prompt": "..." } with 1 to ${MAX_PROMPT} characters.`, origin);
  return runLimited(request, env, origin, MODEL, { prompt, steps: STEPS });
}

// The image bytes are passed through to the model unchanged; the fixed instruction is added here, not in the browser.
async function edit(request, env, origin) {
  const input = await readEdit(request);
  if (!input) return fail(400, `Send a form with prompt (1 to ${MAX_PROMPT} characters) and image (JPEG or PNG, up to ${MAX_EDIT_IMAGE / 1024} KB).`, origin);
  const form = new FormData();
  form.append("prompt", EDIT_INSTRUCTION + input.prompt);
  form.append("input_image_0", input.image);
  form.append("width", EDIT_SIZE);
  form.append("height", EDIT_SIZE);
  const multipart = new Response(form); // serializes the form and creates the boundary header, as the Cloudflare docs show
  return runLimited(request, env, origin, EDIT_MODEL, { multipart: { body: multipart.body, contentType: multipart.headers.get("content-type") } });
}

// Shared by every route: takes one daily slot, runs the model, and gives the slot back if it failed.
async function runLimited(request, env, origin, model, inputs) {
  if (!LIMIT_ENABLED) return createImage(env, model, inputs, origin); // no claim, no release: the limiter is not called
  let slot = null;
  try {
    slot = await claimSlot(env, request.headers.get("CF-Connecting-IP"));
  } catch (err) {
    // Deliberate: if the limiter is down, let the request through (availability over protection).
    console.error("limiter unavailable, failing open:", String(err));
  }
  if (slot && !slot.allowed) return fail(429, "Daily limit reached. Try again tomorrow.", origin);

  const response = await createImage(env, model, inputs, origin);
  if (slot && !response.ok) await releaseSlot(env, slot); // a failed request does not cost a credit
  return response;
}

async function createImage(env, model, inputs, origin) {
  let result;
  try {
    result = await env.AI.run(model, inputs);
  } catch (err) {
    // The raw text is kept so real quota errors can be read with `npx wrangler tail`.
    console.error("workers ai error:", err && err.message ? err.message : String(err), err && err.status);
    return fail(502, "The image service had a problem.", origin);
  }

  let bytes;
  try {
    bytes = decodeBase64(result.image);
  } catch (err) {
    console.error("bad base64 from model:", String(err));
    return fail(502, "The image service returned unreadable data.", origin);
  }
  const type = detectType(bytes);
  if (!type) {
    console.error("unknown image format, first bytes:", Array.from(bytes.slice(0, 4)));
    return fail(502, "The image service returned an unknown format.", origin);
  }
  return new Response(bytes, { headers: { ...corsHeaders(origin), "Content-Type": type, "Cache-Control": "no-store" } });
}

// ---------- Shared images ----------

// Stores shared images and counts uploads per IP hash per UTC day. One instance serves everything.
// Each method is synchronous, so the limit check and the writes can never interleave.
export class ShareStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, image BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS uploads (day TEXT NOT NULL, hash TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, hash))");
  }

  // Counts the upload and saves the image together: if the save fails, the count is rolled back.
  // Returns false when the limit is reached. An empty hash means the limit is switched off.
  save(share, hash, day) {
    return this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM shares WHERE created <= ?", share.created - SHARE_TTL_MS);
      this.sql.exec("DELETE FROM uploads WHERE day != ?", day); // rows of earlier days are not needed
      if (hash) {
        const row = this.sql.exec("SELECT count FROM uploads WHERE day = ? AND hash = ?", day, hash).toArray()[0];
        if (row && row.count >= SHARE_DAILY_LIMIT) return false;
        this.sql.exec("INSERT INTO uploads (day, hash, count) VALUES (?, ?, 1) ON CONFLICT (day, hash) DO UPDATE SET count = count + 1", day, hash);
      }
      this.sql.exec("INSERT INTO shares (id, image, width, height, created) VALUES (?, ?, ?, ?, ?)", share.id, share.image, share.width, share.height, share.created);
      return true;
    });
  }

  // Returns the row, or null when it is missing or expired. Expired rows are deleted first.
  read(id, now, withImage) {
    this.sql.exec("DELETE FROM shares WHERE created <= ?", now - SHARE_TTL_MS);
    const query = withImage ? "SELECT image, width, height, created FROM shares WHERE id = ?" : "SELECT width, height, created FROM shares WHERE id = ?";
    return this.sql.exec(query, id).toArray()[0] || null;
  }
}

// A whole number from MIN_SIDE to MAX_SIDE, or 0.
function readSide(value) {
  const side = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 0;
  return side >= MIN_SIDE && side <= MAX_SIDE ? side : 0;
}

// Returns { image, width, height } from the multipart form, or null if a field is missing, too large or not a JPEG.
async function readShare(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_SHARE_IMAGE + MAX_BODY) return null; // do not parse a huge body
  try {
    const form = await request.formData();
    const image = form.get("image");
    const width = readSide(form.get("width"));
    const height = readSide(form.get("height"));
    if (!(image instanceof File) || image.size > MAX_SHARE_IMAGE || !width || !height) return null;
    const bytes = await image.arrayBuffer();
    return detectType(new Uint8Array(bytes)) === "image/jpeg" ? { image: bytes, width, height } : null;
  } catch {
    return null;
  }
}

// 128 random bits as 32 hex characters: the link is unlisted and cannot be guessed.
function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The hashed IP for the daily limit, or "" when the limit is off. Throws without an IP, so the upload fails closed.
async function uploaderHash(request) {
  if (!SHARE_LIMIT_ENABLED) return "";
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) throw new Error("CF-Connecting-IP is missing");
  return hashIp(ip);
}

async function share(request, env, origin) {
  const input = await readShare(request);
  if (!input) return fail(400, `Send a form with image (JPEG, up to ${MAX_SHARE_IMAGE / 1024} KB), width and height (whole numbers from ${MIN_SIDE} to ${MAX_SIDE}).`, origin);
  const id = randomId();
  const now = Date.now();
  let saved;
  try {
    const hash = await uploaderHash(request);
    saved = await env.SHARES.getByName("shares").save({ id, ...input, created: now }, hash, new Date(now).toISOString().slice(0, 10));
  } catch (err) {
    // Deliberate: unlike the AI limiter, uploads fail closed.
    console.error("share store failed:", String(err));
    return fail(502, "Could not save the image. Try again later.", origin);
  }
  if (!saved) return fail(429, "Daily share limit reached. Try again tomorrow.", origin);
  return Response.json({ id, url: `${new URL(request.url).origin}/s/${id}` }, { headers: corsHeaders(origin) });
}

// Only the hex id and validated integers go into the page, never text from a user.
function sharePage(base, id, width, height) {
  const image = `${base}/i/${id}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Made with PixelKit</title>
<meta property="og:title" content="Made with PixelKit">
<meta property="og:description" content="An image made with PixelKit, a free photo toolkit that runs in your browser.">
<meta property="og:type" content="website">
<meta property="og:url" content="${base}/s/${id}">
<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="${width}">
<meta property="og:image:height" content="${height}">
<style>${PAGE_STYLE}</style>
</head>
<body>
<img src="${image}" width="${width}" height="${height}" alt="Image made with PixelKit">
<p><a href="${SITE_URL}">Made with PixelKit</a></p>
</body>
</html>
`;
}

// Public GET routes: the share page ("s") and its image ("i"). No Origin check, because crawlers send none.
async function showShare(request, env, kind, id) {
  const now = Date.now();
  let row;
  try {
    row = await env.SHARES.getByName("shares").read(id, now, kind === "i");
  } catch (err) {
    console.error("share store failed:", String(err));
    return fail(502, "Could not load the image. Try again later.");
  }
  if (!row) return fail(404, "Not found.");
  const cache = `public, max-age=${Math.floor((row.created + SHARE_TTL_MS - now) / 1000)}`; // never past the expiry
  if (kind === "i") return new Response(row.image, { headers: { "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff", "Cache-Control": cache } });
  const page = sharePage(new URL(request.url).origin, id, row.width, row.height);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PAGE_CSP, "Cache-Control": cache } });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const shared = SHARE_ENABLED && request.method === "GET" && path.match(SHARE_ROUTE);
    if (shared) return showShare(request, env, shared[1], shared[2]);
    const origin = request.headers.get("Origin");
    if (!ALLOWED_ORIGINS.includes(origin)) return fail(403, "Origin not allowed.");
    if (path !== "/generate" && path !== "/edit" && !(SHARE_ENABLED && path === "/share")) return fail(404, "Not found.", origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return fail(405, "Use POST.", origin);
    if (path === "/edit") return edit(request, env, origin);
    if (path === "/share") return share(request, env, origin);
    return generate(request, env, origin);
  },
};
