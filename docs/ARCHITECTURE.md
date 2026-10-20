# PixelKit Architecture

PixelKit is a static, guest-only photo toolkit: two HTML pages, vanilla CSS and JavaScript (ES modules), no backend, no build step, no external JS dependencies. It runs from any static host (GitHub Pages).

## Pages

- `index.html` + `js/landing.js`: landing page (hero compare slider, feature reveal).
- `app.html` + `js/app.js`: workspace with a left console (tools, controls, recents, activity log), a top strip (project name, Undo, Export) and the canvas area.

## Folder map

```
js/
  app.js            wires the workspace: init each part, subscribe render functions, rename field, file drop
  landing.js        landing page behaviour
  core/             shared, tool-independent code
    state.js        the single state object: getState, setState, subscribe, logActivity, defaultFilters
    logger.js       info, group, error, logAfterPause (shared console logging)
    image.js        file checks (type, size, magic bytes), decode, load, filter string, thumbnail
    export.js       canvasToBlob, downloadBlob, cleanFileName
    fonts.js        shared system-font stacks
    db.js           IndexedDB (original image Blobs) and localStorage (project list)
    projects.js     autosave, recents, resume, rename, delete (max 10 projects)
  tools/            one file per tool, each owns its own section of state
    editor.js       filters, reset, export; also owns the shared file input, the "Choose image" buttons and the upload error box
    compressor.js   quality, format, before/after size, download
    meme.js         captions, presets, export
    logo.js         elements, selection, dragging, layers, export
    catalog.js      Picsum list, infinite scroll, "Use this image"
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

## Rendering

- Canvas redraws are batched with `requestAnimationFrame` and skipped when nothing changed.
- Previews use a capped size (editor about 1200px, meme about 900px). Exports always use the full original or preset size.
- Heavy work does not run inside input handlers (compression waits for a pause; Meme and Logo export are deferred with `setTimeout`). The Editor export still draws directly in its click handler.

## Storage

- localStorage key `pixelkit.projects`: lightweight metadata (id, name, updatedAt, filters, small JPEG thumbnail). Only the newest 10 projects are kept; older ones are deleted with their saved images on the next save.
- IndexedDB database `pixelkit`: the original image Blob per project.
- Stored data is validated on load. Storage failures show a message and never break editing.

## Security

- Content Security Policy as a meta tag on both pages. Fonts come from `fonts.googleapis.com` (styles) and `fonts.gstatic.com` (files). `app.html` also allows `https://picsum.photos` and `https://fastly.picsum.photos` for images and downloads (Picsum redirects to fastly). `index.html` allows the same image hosts but only `picsum.photos` for `connect-src`. No inline scripts, no `unsafe-*`.
- Uploads: JPG, PNG and WebP only, checked by MIME type and magic bytes, 10 MB and 40 megapixel limits. SVG is rejected.
- Text from users or the network is set with `textContent`. Canvas text is drawn with `fillText`.
- `frame-ancestors` cannot be set from a meta tag; a static host like GitHub Pages cannot add it.

## Logging

All logs go through `core/logger.js` with the `[PixelKit]` prefix; `logActivity` (in `state.js`) logs and also shows the message in the Activity Log. Frequent events (sliders, typing, keyboard moves) use `logAfterPause`; the Compressor quality slider has its own timer because it also delays the state update. Logs stay in the code permanently. Never log image data or base64. Never log what the user types into Meme or Logo text (log its length only). File names and project names may be logged.

## Known structural debt

- The draw-once-per-frame pattern is still copied in editor, meme and logo.
- `#file-input`, `#export` and the error boxes are shared page elements used by several tools.
- Undo (`history.js`) is not built; the Undo button is a disabled placeholder.
- The Editor's Rotate and Crop buttons and their "not built yet" notes are disabled placeholders.
- The Editor export runs its heavy drawing inside the click handler.
- `.agents/skills` and `.claude/skills` hold duplicate copies of the design-engineer skill.
