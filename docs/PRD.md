# PixelKit — Product Requirements

## Problem

People often need a quick image edit (filter, compress, caption, simple logo) without installing software, creating an account or uploading photos to a server.

## Product

A static, guest-only browser toolkit. Everything runs locally in the browser. Images never leave the device, except Catalog photos downloaded from Picsum.

## Goals

- Five practical tools in one fast workspace.
- After a page has loaded, the tools work without a network (Catalog and web fonts excepted). There is no service worker, so the pages themselves are not available offline. Works on desktop and phones down to 320px wide.
- Demonstrates clean vanilla JavaScript fundamentals: DOM, explicit state, async/await and fetch, Canvas, localStorage and IndexedDB, file APIs.

## Non-goals

- No accounts, backend, sync or sharing.
- No frameworks, build tools or external JS libraries.
- Not a full image editor (no layers in the Editor, no RAW files, no batch processing).

## Features and status

| Area | Requirement | Status |
|---|---|---|
| Editor | Upload JPG/PNG/WebP by button or drag and drop, with validation | Built |
| Editor | Brightness, contrast, blur, grayscale, invert, reset, export | Built |
| Editor | Rotate, flip, crop, resize, text overlay | Not built |
| Compressor | Quality slider, JPG/PNG/WebP (only browser-supported), before/after size, download | Built |
| Meme / Post | Top and bottom text, font, colour, size, Instagram post, portrait and WhatsApp Status presets, export | Built |
| Logo Maker | Text, rectangle, circle, colour, size, select, drag, layer order, transparent or solid background, PNG export | Built |
| Catalog | Picsum photos, lazy thumbnails, infinite scroll, error and retry, "Use this image" | Built |
| Projects | Autosave, recents (newest 10), resume, rename (max 40 characters), delete with confirmation | Built |
| Workspace | Undo | Not built |
| Workspace | Landing page lists four tools (Logo Maker not shown) | Known gap |

## Constraints

- Static hosting only. Content Security Policy must stay strict.
- Upload limits: 10 MB, 40 megapixels, JPG/PNG/WebP. SVG rejected.
- Visual identity is locked (see `PROJECT_BRIEF.md`, section 2).

## Quality bar

- Keyboard usable, visible focus, labelled controls, text contrast at least 4.5:1, reduced motion respected.
- No sideways scroll at 320px. On phones, the buttons, text fields and list items in the console and top strip are at least 40px tall. Known exceptions: sliders, colour pickers, the Download button, the Catalog buttons and the logo link.
- 0 console errors in normal use.
- Code follows `docs/ENGINEERING_RULES.md`.

## Known limitations

- Meme settings and logos are not saved with a project.
- Compress and export are slow on very large photos (4000px and above).
- Delete uses the browser's plain confirm dialog.
- Meme uses centre crop only. Impact font may fall back on some Android and Linux devices.
- Recents keeps the newest 10 projects; older ones are deleted automatically.
- A WebP photo is exported from the Editor as JPG.
- The Meme preview shows transparent areas dark, but the JPG export fills them white.
- Undo and the Editor's Rotate, flip, crop, resize and text overlay are in the brief but not built.
- Tested in Chromium only. Safari, Firefox and real phones are not verified.
