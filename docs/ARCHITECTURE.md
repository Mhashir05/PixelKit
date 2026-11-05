# PixelKit Architecture

PixelKit is a static, guest-only photo toolkit: two HTML pages, vanilla CSS and JavaScript (ES modules), no build step, no external JS dependencies. The pages run from any static host (Vercel). The only server-side part is one small Cloudflare Worker for AI Studio and Share on Facebook (see "AI Worker").

## Pages

- `index.html` + `js/landing.js`: landing page (hero compare slider, feature reveal).
- `app.html` + `js/app.js`: workspace with a left console (tools, controls, recents), a top strip (project name, Undo, Export) and the canvas area.

## Folder map

```
js/
  app.js            wires the workspace: init each part, subscribe render functions, rename field, file drop, Undo button and Ctrl/Cmd+Z
  landing.js        landing page behaviour
  core/             shared, tool-independent code
    state.js        the single state object (including undoSteps): getState, setState, subscribe, logActivity
    logger.js       info, group, error, logAfterPause (shared console logging)
    image.js        file checks (type, size, magic bytes), decode, load, thumbnail
    history.js      Undo for the Editor: beginChange and endChange group one drag or click into one step, undo, clearHistory (50 steps, not saved)
    edits.js        the edit settings (filters, rotation, flips, crop, resize, text overlay): defaults, check of stored settings, editedSize, exportSize, drawEdited (draws the photo for the preview, the export and the thumbnail)
    export.js       canvasToBlob, downloadBlob, cleanFileName, and sharing: shareToFacebook (JPEG copy, upload to the Worker's /share, facebookShareUrl), shareWithApp (Web Share API), isSharing, canShareFiles
    fonts.js        shared system-font stacks and the outline colour for text
    db.js           IndexedDB (original image Blobs) and localStorage (project list)
    projects.js     autosave, recents, resume, rename, delete (max 10 projects)
  tools/            one file per tool, each owns its own section of state
    editor.js       the Editor: filters, rotate, flip, crop, resize, text overlay, reset, export; also owns the shared file input, the "Choose image" buttons and the upload error box
    compressor.js   quality, format, before/after size, download
    meme.js         captions, presets, export
    logo.js         elements, selection, dragging, layers, export
    catalog.js      Picsum list, infinite scroll, "Use this image"
    ai.js           AI Studio: prompt to image via our Cloudflare Worker (no key in the browser), one prompt box that generates or edits depending on whether an image exists (edits always start from the generated original), Reset to original, New image, download, "Open in" Editor, Compressor or Meme
  ui/
    sidebar.js      tools list, recents list
    animations.js   landing reveal on scroll
css/
  tokens.css        colour, font and spacing tokens (locked visual identity)
  base.css          reset and shared elements
  landing.css       landing page
  workspace.css     workspace
assets/             logo, icon and the landing sample image
docs/               PRD, architecture and engineering rules
worker/             separate Cloudflare Worker for AI Studio (see "AI Worker")
  src/index.js      /generate (FLUX.1 schnell) and /edit (FLUX.2 klein 4B) endpoints, origin check, one per-IP daily limit of 8 shared by both (Durable Object; currently switched off by `LIMIT_ENABLED = false`), Workers AI calls
  wrangler.jsonc    Worker name, AI and Durable Object bindings, migration
```

## Dependency rules

```
app.js, landing.js  ->  tools/, ui/, core/
tools/*             ->  core/, ui/          (never another tool)
ui/*                ->  core/
core/*              ->  core/ only          (never tools/ or ui/)
```

A change that breaks these arrows needs a reason and approval.

## Data flow

1. A user action calls a small handler.
2. The handler validates input if it comes from outside (file, network, storage) and calls `setState`.
3. Subscribed render functions read the state and update the DOM and canvas.

The DOM is never the source of truth. Each tool reads and writes only its own section of state, plus shared fields such as the loaded image.

## Edits and Undo

- The Editor never changes the original photo. Its settings live in `state.edits` and are applied each time the picture is drawn, in this order: crop, rotate and flip, resize, colour filters, then the text overlay. `core/edits.js` draws all of it, for the preview, the export and the thumbnail.
- Crop trims are measured on the picture as it looks; `sourceRect` turns them into the part of the original photo to draw.
- `edits` is replaced, never changed in place, so an Undo step is just the previous `edits` object (`core/history.js`, up to 50 steps).

## Rendering

- Canvas redraws are batched with `requestAnimationFrame` and skipped when nothing changed.
- Previews use a capped size (editor about 1200px, meme about 900px). Exports use the full original size, after crop and resize (Meme and Logo use their preset size).
- Heavy work does not run inside input handlers (compression waits for a pause; Meme and Logo export are deferred with `setTimeout`). The Editor export still draws directly in its click handler.

## AI Worker

`worker/` is a separate Cloudflare Worker (own `wrangler.jsonc`, no build step, nothing installed at the repo root). `POST /generate` takes `{ prompt }` (1 to 300 characters) and nothing else; the server sets the model (`@cf/black-forest-labs/flux-1-schnell`) and `steps` (4). It calls Workers AI through the `AI` binding, so no key exists anywhere, then sniffs the real image type from the first bytes (JPEG or PNG) and returns the image. `POST /edit` takes a multipart form with `prompt` (1 to 300 characters: the user's edit instructions, joined by the browser) and `image` (the original generated image, scaled by the browser to at most 512x512 JPEG; JPEG or PNG by signature, at most `MAX_EDIT_IMAGE` = 256 KB). The image bytes are passed through unchanged. The server adds a fixed "keep everything else the same" instruction and sets the model (`@cf/black-forest-labs/flux-2-klein-4b`) and the output size (1024x1024). Every edit starts from the original image, not the previous edit, so repeated edits do not drift. Both routes share `runLimited()` (daily slot, model call, slot release) and `createImage()` (decode and type check). Errors are JSON: 400 bad input, 403 origin not allowed, 429 daily limit reached, 502 upstream failure. CORS allows only `https://pixelkit-wheat.vercel.app` and `http://localhost:8000`. The free allowance is 10,000 neurons per day (resets 00:00 UTC). Deploy from `worker/` with `npx wrangler deploy`; watch real errors with `npx wrangler tail`.

Daily limit: implemented but currently switched off. `LIMIT_ENABLED = false` in `worker/src/index.js` makes `runLimited()` skip the claim and the release, so the Durable Object is not called and no 429 is returned; set it to `true` and redeploy to re-enable the behaviour below unchanged. When it is on, each IP may make `DAILY_LIMIT` images (8) per UTC day; generations and edits share it, one slot each. A SQLite-backed Durable Object (`RateLimiter`, binding `LIMITER`) checks and counts in one synchronous step, before the model is called, so two simultaneous requests cannot both take the last slot. If the model call fails (502), the slot is given back. The IP from `CF-Connecting-IP` is never stored: only its SHA-256 hash and the UTC date are, and rows of earlier days are deleted on each check. The hash is not salted, so it protects against casual reading of the data, not against a determined guess of an IPv4 address. If the Durable Object fails (or the header is missing), the request goes through and the error is logged with `console.error`. This is a deliberate choice of availability over protection. The 429 answer reuses the frontend's existing "limit reached" message.

Sharing (see `docs/SHARE_DESIGN.md`): three more routes on the same Worker, used by "Share on Facebook".
- Frontend: Editor, Compressor, Meme, Logo Maker and AI Studio each pass the file their Export or Download makes to `shareToFacebook` or `shareWithApp` in `core/export.js`, with a function that shows a message in the tool's own area (`state.error`, `ai.error` or `logo.message`). Share on Facebook opens a blank window inside the click (so pop-up blockers allow it), makes a JPEG copy (longest side at most 1600px, white background, quality 0.85, then 0.7 and 0.55 until it is at most 1.4 MB), uploads it to `/share` with a 30-second timeout, then sends the window to `facebookShareUrl(url)` (`sharer.php`, the one place to change how Facebook is opened). One upload runs at a time. Share with an app sends the exact exported file to `navigator.share` and is shown only where `navigator.canShare` accepts files; nothing is uploaded to PixelKit. The strip's two Share buttons follow the shared Export button (set in `app.js`).
- Privacy: the uploaded copy is public to anyone with its link for 7 days; Facebook keeps its own copy of the preview when the user posts.
- Kill switch: `SHARE_ENABLED = false` makes the Worker answer exactly as before the feature (the GET routes fall through to the 403 origin check, `/share` gets the usual 404); `ShareStore`, its binding and migration `v2` stay, because Cloudflare refuses a rollback to a version older than a Durable Object migration.
- `POST /share` takes a multipart form with `image` (JPEG only, checked by its first bytes, at most `MAX_SHARE_IMAGE` = 1.5 MB, safely below the 2 MB Durable Object value limit) and `width` and `height` (whole numbers from 200 to 2000, used only for the `og:image:width` and `og:image:height` tags). Same origin allow-list and CORS as the other POST routes. It answers `{ id, url }`, where `id` is 128 random bits as 32 hex characters and `url` is the absolute address of the share page. Errors: 400 bad form, 403 origin not allowed, 429 daily limit reached, 502 store failure.
- `GET /s/<id>` is a small public HTML page (no JavaScript) with Open Graph tags (fixed title "Made with PixelKit", a fixed `og:description`, `og:url`, `og:image` with type, width and height), the image and a link to PixelKit. Only the hex id and the validated integers are written into it.
- `GET /i/<id>` returns the stored JPEG with `X-Content-Type-Options: nosniff`.
- Both GET routes are matched before the origin check, because Facebook's crawler and people opening a link send no allowed `Origin`. Only these two paths with a 32-character lowercase hex id are public; everything else keeps the 403. They answer 404 when the id is unknown or expired, and their `Cache-Control` never lasts past the expiry.
- Storage: a second SQLite-backed Durable Object (`ShareStore`, binding `SHARES`, migration `v2`), one instance, table `shares` (id, image, width, height, created). A link lives `SHARE_TTL_DAYS` (7) days. Expired rows are deleted lazily, on every read and every upload; there is no alarm or cron.
- Upload limit: `SHARE_DAILY_LIMIT` (20) uploads per IP per UTC day, switched on by `SHARE_LIMIT_ENABLED = true`, kept in the store's own `uploads` table (SHA-256 hash of the IP and the UTC day, never the raw IP; rows of earlier days are deleted on each upload). It is separate from the AI limit. The count and the image are saved in one `transactionSync`, so a failed save does not use a slot and simultaneous uploads cannot pass the limit. Unlike the AI limiter, it fails closed: if the store fails or `CF-Connecting-IP` is missing, the upload returns 502.

## Storage

- localStorage key `pixelkit.projects`: lightweight metadata (id, name, updatedAt, edits (the Editor settings: filters, rotation, flips, crop, resize, text overlay), small JPEG thumbnail; projects saved by older versions used the name `filters` and are still read). Only the newest 10 projects are kept; older ones are deleted with their saved images on the next save.
- IndexedDB database `pixelkit`: the original image Blob per project.
- Stored data is validated on load. Storage failures show a message and never break editing.

## Security

- Content Security Policy as a meta tag on both pages. Fonts come from `fonts.googleapis.com` (styles) and `fonts.gstatic.com` (files). `app.html` also allows `https://picsum.photos` and `https://fastly.picsum.photos` for images and downloads (Picsum redirects to fastly). `app.html` also allows the Worker host `https://pixelkit-ai.hashir-dev.workers.dev` in `connect-src` only (AI Studio fetches the image as a Blob and shows it from a `blob:` URL). `index.html` allows no Picsum host, because the landing page loads nothing from Picsum. No inline scripts, no `unsafe-*`.
- Uploads: JPG, PNG and WebP only, checked by MIME type and magic bytes, 10 MB and 40 megapixel limits. SVG is rejected.
- Text from users or the network is set with `textContent`. Canvas text is drawn with `fillText`.
- `frame-ancestors` cannot be set from a meta tag, so `vercel.json` sends `Content-Security-Policy: frame-ancestors 'none'` as a response header. The same file adds `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a minimal `Permissions-Policy`. The full CSP stays in the meta tags.

## Logging

All logs go through `core/logger.js` with the `[PixelKit]` prefix; `logActivity` (in `state.js`) logs user actions to the browser console only; there is no in-app log panel. Frequent events (sliders, typing, keyboard moves) use `logAfterPause`; the Compressor quality slider has its own timer because it also delays the state update. Logs stay in the code permanently. Never log image data or base64. Never log what the user types into Meme or Logo text (log its length only). File names and project names may be logged.

## Known limitations

- Autosave waits 1 second after the last change (`SAVE_DELAY` in `core/projects.js`). If a new image loads less than 1 second after an edit, that last edit is lost. The project and its image survive; only the final edit is missing. Closing or hiding the tab is not affected, because `visibilitychange` saves at once.
- Proposed fix (not built, because it changes how `saveProject` works): remember the previous project's state when `projectId` changes, pass that state to `saveProject` instead of reading `getState()`, and relax the `projectId` check that skips a save when the project was replaced.

## Known structural debt

- The draw-once-per-frame pattern is still copied in editor, meme and logo.
- `#file-input`, `#export` and the error boxes are shared page elements used by several tools.
- The Editor export runs its heavy drawing inside the click handler.
- `.agents/skills` and `.claude/skills` hold duplicate copies of the design-engineer skill. They are local only (ignored by git, together with `skills-lock.json` and `.playwright-cli/`).
