# PixelKit Architecture

PixelKit is a static, guest-only photo toolkit: two HTML pages, vanilla CSS and JavaScript (ES modules), no backend, no build step, no external JS dependencies. It runs from any static host (Vercel).

## Pages

- `index.html` + `js/landing.js`: landing page (hero compare slider, feature reveal).
- `app.html` + `js/app.js`: workspace with a left console (tools, controls, recents, activity log), a top strip (project name, Undo, Export) and the canvas area.

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
    export.js       canvasToBlob, downloadBlob, cleanFileName
    fonts.js        shared system-font stacks and the outline colour for text
    db.js           IndexedDB (original image Blobs) and localStorage (project list)
    projects.js     autosave, recents, resume, rename, delete (max 10 projects)
  tools/            one file per tool, each owns its own section of state
    editor.js       the Editor: filters, rotate, flip, crop, resize, text overlay, reset, export; also owns the shared file input, the "Choose image" buttons and the upload error box
    compressor.js   quality, format, before/after size, download
    meme.js         captions, presets, export
    logo.js         elements, selection, dragging, layers, export
    catalog.js      Picsum list, infinite scroll, "Use this image"
    ai.js           AI Studio: prompt to image via our Cloudflare Worker (no key in the browser), download, "Open in" Editor, Compressor or Meme
  ui/
    sidebar.js      tools list, recents list, activity log
    animations.js   landing reveal on scroll
css/
  tokens.css        colour, font and spacing tokens (locked visual identity)
  base.css          reset and shared elements
  landing.css       landing page
  workspace.css     workspace
assets/             logo, icon and the landing sample image
docs/               PRD, architecture and engineering rules
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

`worker/` is a separate Cloudflare Worker (own `wrangler.jsonc`, no build step, nothing installed at the repo root). `POST /generate` takes `{ prompt }` (1 to 300 characters) and nothing else; the server sets the model (`@cf/black-forest-labs/flux-1-schnell`) and `steps` (4). It calls Workers AI through the `AI` binding, so no key exists anywhere, then sniffs the real image type from the first bytes (JPEG or PNG) and returns the image. Errors are JSON: 400 bad input, 403 origin not allowed, 502 upstream failure. CORS allows only `https://pixelkit-wheat.vercel.app` and `http://localhost:8000`. The free allowance is 10,000 neurons per day (resets 00:00 UTC). Deploy from `worker/` with `npx wrangler deploy`; watch real errors with `npx wrangler tail`.

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

All logs go through `core/logger.js` with the `[PixelKit]` prefix; `logActivity` (in `state.js`) logs and also shows the message in the Activity Log. Frequent events (sliders, typing, keyboard moves) use `logAfterPause`; the Compressor quality slider has its own timer because it also delays the state update. Logs stay in the code permanently. Never log image data or base64. Never log what the user types into Meme or Logo text (log its length only). File names and project names may be logged.

## Known structural debt

- The draw-once-per-frame pattern is still copied in editor, meme and logo.
- `#file-input`, `#export` and the error boxes are shared page elements used by several tools.
- The Editor export runs its heavy drawing inside the click handler.
- `.agents/skills` and `.claude/skills` hold duplicate copies of the design-engineer skill. They are local only (ignored by git, together with `skills-lock.json` and `.playwright-cli/`).
