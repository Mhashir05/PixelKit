const ALLOWED_ORIGINS = ["https://pixelkit-wheat.vercel.app", "http://localhost:8000"];
const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_PROMPT = 300; // stricter than the model's own 2048
const MAX_BODY = 4096; // bytes; a valid request is far smaller
const STEPS = 4; // the documented default; never taken from the client

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

async function generate(request, env, origin) {
  const prompt = await readPrompt(request);
  if (!prompt) return fail(400, `Send JSON like { "prompt": "..." } with 1 to ${MAX_PROMPT} characters.`, origin);

  let result;
  try {
    result = await env.AI.run(MODEL, { prompt, steps: STEPS });
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!ALLOWED_ORIGINS.includes(origin)) return fail(403, "Origin not allowed.");
    if (new URL(request.url).pathname !== "/generate") return fail(404, "Not found.", origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return fail(405, "Use POST.", origin);
    return generate(request, env, origin);
  },
};
