# PixelKit

A photo toolkit that runs entirely in your browser: edit, compress, caption and design images without an account or an upload to a server.

Live: https://pixelkit-wheat.vercel.app

## What it does

- **Editor**: brightness, contrast, blur, grayscale and invert, plus rotate, flip, crop, resize and a text overlay, with Undo, reset and export.
- **Compressor**: quality slider, JPG, PNG or WebP (where the browser supports it), before and after file size, download.
- **Meme / Post**: top and bottom text, font, colour and size, with Instagram post, Instagram portrait and WhatsApp Status sizes.
- **Logo Maker**: text, rectangles and circles that you drag, order in layers and export as a 1000 x 1000 PNG, with a transparent or solid background.
- **Catalog**: free photos from Picsum with infinite scroll; "Use this image" opens one in the Editor.

Your work is saved automatically in the browser. Recents lists your newest 10 projects, and you can resume, rename or delete them.

## Run locally

```
python -m http.server 8000
```

Then open http://localhost:8000. Opening the HTML file directly does not work, because browsers block ES modules loaded from `file://`.

## Tech

Vanilla HTML, CSS and JavaScript (ES modules), Canvas, IndexedDB, localStorage and Fetch with the Picsum API. No framework, no build step and no external JavaScript dependencies. Only the fonts come from Google Fonts.

## Engineering decisions

- **State drives the UI.** One state object; handlers change it and render functions draw from it. The DOM is never the source of truth.
- **Dependencies point one way.** Tools use `core/` helpers and never import each other; `core/` never imports a tool.
- **Uploads are checked by content.** JPG, PNG and WebP only, verified by MIME type and file signature (magic bytes), with 10 MB and 40 megapixel limits. SVG is rejected.
- **Strict Content Security Policy.** No inline scripts, no `unsafe-*`. User and network text is set with `textContent`.
- **One shared logger.** All console logs go through `js/core/logger.js`; frequent events are logged once the user pauses. Image data and typed text are never logged.
- **Storage split.** Original images are kept in IndexedDB and small project metadata in localStorage. Stored data is validated when it is loaded.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/PRD.md](docs/PRD.md).

## Known limitations

- Meme settings and logos are not saved with a project.
- Compress and export are slow on very large photos (4000px and above).
- Delete uses the browser's plain confirm dialog.
- Meme uses centre crop only. Impact font may fall back on some Android and Linux devices.
- Recents keeps the newest 10 projects; older ones are deleted automatically.
- A WebP photo is exported from the Editor as JPG.
- The Meme preview shows transparent areas dark, but the JPG export fills them white.
- Undo works only in the Editor and is not saved with the project.
- Compressor and Meme use the original photo, without the Editor's filters, rotation, flips, crop, resize and text.
- Crop uses four sliders (no drag handles). If you rotate after cropping, the same trims apply to the new edges.
- Resize only shrinks, and only the exported file changes size; the preview keeps its size.
- The text overlay is one line in a fixed font (Arial bold). It is placed with sliders, not by dragging, and it is not wrapped.
- Tested in Chromium only. Safari, Firefox and real phones are not verified.
