# PixelKit — Award-Level UI/UX & Frontend Implementation Brief

Act as a senior award-winning digital product designer, creative director, design engineer, and vanilla JavaScript frontend architect.

Your task is to design and build **PixelKit**, a polished, distinctive, portfolio-worthy browser-based photo toolkit. The result should demonstrate exceptional visual taste, thoughtful UX, clean frontend architecture, and real JavaScript fundamentals.

Do not create a generic AI-looking SaaS dashboard. Do not blindly follow common landing-page templates. Approach this as a carefully art-directed digital product that could stand out in a competitive design portfolio and be a strong candidate for recognition on platforms such as Awwwards or similar showcases. Never sacrifice usability or functional correctness for visual effects.

## 1. Understand the product before coding

PixelKit is a static, guest-only photo toolkit built with vanilla HTML, CSS, and JavaScript. There is no backend, authentication, framework, or dependency-heavy UI library.

Its purpose is to demonstrate strong fundamentals:
- DOM manipulation and event handling
- Explicit application state
- Fetch API and async/await
- HTML Canvas image manipulation
- localStorage and IndexedDB
- Browser file APIs, export, and download
- Error handling, accessibility, and responsive design

Read the existing project brief and inspect the repository before making changes. The project may initially be empty or partially scaffolded. Do not assume files exist without checking.

Use the installed Taste Skill and Design Engineer skill when relevant and available. Inspect their instructions rather than assuming how they work. Use Playwright CLI for browser verification when available.

## 2. Locked visual identity — do not change

Brand: PixelKit

Direction: Minimal Dark, precise, modern, editorial, tool-focused.

Color tokens:
- Background: #0a0a0a
- Surface: #141414
- Border: #262626
- Primary text: #fafafa
- Muted text: #8a8a8a
- Single accent: Electric lime #c6ff00

Typography:
- Space Grotesk 700 for expressive display headings
- Inter for interface and body text
- Landing page: large, bold, confident typography
- Workspace: compact, quiet interface, generally 13–14px
- Display heading letter spacing: -0.03em

Use the lime accent with restraint: primary actions, selected states, essential indicators, and a few intentional highlights. Do not turn every icon, border, or card into a lime element.

Do not introduce additional competing accent colors, gradients everywhere, glassmorphism, excessive rounded cards, or decorative effects without a clear design rationale.

Preserve the existing logo assets. Inspect the provided logo before deciding its placement, contrast treatment, and favicon crop. Do not invent a replacement brand identity.

## 3. Creative direction: make it distinctive

The visual language should feel like a professional image-making instrument rather than a generic SaaS template.

Aim for:
- Strong typographic hierarchy and confident composition
- Intentional negative space on the landing page
- A precise grid and disciplined alignment
- Subtle hairline borders and layered near-black surfaces
- Carefully designed tool icons and restrained visual indicators
- A strong contrast between the expressive landing page and utilitarian workspace
- Realistic image previews and purposeful media-led composition
- Consistent spacing, control heights, focus states, and alignment
- Micro-interactions that communicate cause and effect

Create one memorable visual idea that belongs to PixelKit: for example, an editorial image-processing composition, a custom pixel-grid motif, or a purposeful before/after image treatment. Choose a direction that supports the actual product rather than adding decoration for its own sake.

Avoid:
- Generic centered hero plus four identical cards with no personality
- Random floating blobs, gratuitous glow, and neon overload
- Emoji used as primary interface icons
- Excessive pill-shaped controls
- Empty charts or fake analytics
- Fake testimonials, fabricated usage statistics, or misleading claims
- Placeholder buttons that look functional but do nothing
- Overdesigned interfaces that hide the actual image-editing workflow

Use inline SVG or CSS for small interface icons where appropriate. Do not add an icon library just for decoration.

## 4. Landing page — index.html

Create an exceptional but fast-loading landing page.

Hero:
- PixelKit logo and a minimal, purposeful top navigation area if needed; the actual app remains only two pages and the workspace must not have a conventional navbar.
- A distinctive display headline that communicates the product's value immediately.
- One concise supporting sentence.
- A clear primary CTA: "Start as Guest".
- A visual preview that demonstrates the toolkit rather than relying on abstract decoration.

Feature presentation:
- Four thoughtfully composed feature cards or modules.
- Cover editing, compression, meme/post creation, and image discovery.
- Give each feature a clear purpose and a distinct but consistent visual treatment.
- Keep the page concise and visually coherent.

Footer:
- Minimal, useful, and consistent with the brand.

Motion:
- Subtle hero fade and upward movement.
- Feature reveal through IntersectionObserver.
- Slight CTA hover lift.
- Use approximately 150–300ms transitions where appropriate.
- Respect prefers-reduced-motion.
- Ensure the content remains visible if JavaScript or animations fail.

The page should look complete on both desktop and mobile, not merely shrink a desktop layout.

## 5. Workspace — app.html

The workspace is the heart of PixelKit. Prioritize usability, precision, and image visibility over visual theatrics.

Layout:
- Compact left-side console.
- Main canvas/work area with enough room to inspect and manipulate images.
- A restrained top strip containing the project name, Undo, and Export.
- No conventional top navbar.
- The console contains Tools, Recents, contextual Controls, and Activity Log.

Tools:
1. Editor
2. Compressor
3. Meme / Post
4. Logo Maker
5. Catalog

Tool switching must happen without a full page reload.

Workspace behavior:
- Default to a useful empty state with a clear image-upload action.
- Make drag-and-drop discoverable.
- Distinguish active, hover, focus, disabled, and error states.
- Show loading and empty states when needed.
- Keep contextual controls relevant to the selected tool.
- Keep the canvas visually dominant.
- Make destructive actions understandable and confirm deletion when appropriate.
- Ensure the sidebar and controls remain usable on narrow screens.

Avoid placing every control inside a separate card. Use compact groups, dividers, labels, and consistent control spacing. Do not let decorative UI compete with the image itself.

## 6. Functional product requirements

Design the interface around the actual capabilities in the project brief.

Editor:
- Upload JPG, PNG, or WebP images.
- Enforce a 10 MB limit and validate file type.
- Support drag/drop.
- Brightness, contrast, grayscale, invert, and blur.
- Rotation, flip, crop, resize, text overlays, and reset.
- Provide a clear path to export the edited image.

Compressor:
- Quality slider.
- JPG, PNG, and WebP export where supported by the browser.
- Before/after file sizes and a clear indication of the output format.
- Handle unsupported formats or failed exports gracefully.

Meme / Post:
- Top and bottom text.
- Font, color, and size controls.
- Instagram and WhatsApp Status presets.
- Show the target aspect ratio or canvas dimensions.

Logo Maker:
- Text and shape elements.
- Color controls, dragging, and a layers list.
- Include it only to the degree supported by the implementation phase and available time.

Catalog:
- Fetch images from Picsum using async/await.
- Loading, error, empty, and retry states.
- "Use this image" action.
- Implement infinite scrolling responsibly, with a loading guard and sensible request handling.

Common project functionality:
- Auto-save after approximately one second of inactivity.
- Recent projects with thumbnail, name, and last-updated time.
- Resume a project.
- Rename projects, with a maximum of 40 characters and "Untitled design" as the empty-name fallback.
- Delete projects.
- Export and download supported image formats.
- Store lightweight metadata and thumbnails in localStorage; store original image Blobs in IndexedDB.

Do not fake a feature's functionality to make a screenshot look impressive. If a feature is scheduled for a later phase, present an honest, well-designed disabled or forthcoming state, or omit it until it is implemented.

## 7. State and architecture rules

The UI must be rendered from application state, not treated as the source of truth.

Use a clear state object and separate concerns between:
- Core state and event handling
- IndexedDB persistence
- History and undo
- Export utilities
- Individual tools
- Workspace UI
- Landing page behavior
- Logging

Respect the planned folder structure:

```
pixelkit/
  index.html
  app.html
  css/
    tokens.css
    base.css
    landing.css
    workspace.css
  js/
    core/
      logger.js
      state.js
      db.js
      history.js
      export.js
    tools/
      editor.js
      compressor.js
      meme.js
      logo.js
      catalog.js
    ui/
      sidebar.js
      animations.js
    landing.js
    app.js
  assets/
```

Keep the code understandable to a developer demonstrating JavaScript fundamentals. Prefer native browser APIs and small, explicit functions. Avoid unnecessary abstractions, frameworks, build tools, and dependencies.

Use a shared logger with info, group, and error methods. Record important events such as image load, filter application, API fetch, save, export, and errors. Never log base64 data or full image contents.

Every phase must log its important events through the shared logger, and these logs stay in the code.

## 8. Accessibility, security, and resilience

- Use semantic HTML and accessible labels.
- Provide keyboard-visible focus states.
- Ensure sufficient contrast.
- Use textContent instead of unsafe HTML injection for user-controlled text.
- Validate files by MIME type and file signature where practical; do not trust filenames alone.
- Reject SVG uploads for this project's supported-upload policy.
- Do not use eval or inject untrusted HTML.
- Avoid embedding secrets or API keys.
- Handle storage failures, quota limits, invalid files, and failed fetch requests gracefully.
- Set img.crossOrigin before assigning a remote image URL when required; configure remote canvas usage correctly.
- Add a reasonable Content Security Policy where compatible with the deployment and external font/image sources.
- Do not claim that canvas export universally removes every form of metadata unless verified for the actual browser and format.
- Respect reduced motion and avoid unnecessary layout shifts.
- Ensure local file and browser APIs are used safely.

## 9. Performance and responsive quality

- No heavy animation libraries.
- No unnecessary runtime dependencies.
- Use responsive CSS layouts and appropriate breakpoints.
- Avoid expensive full-resolution canvas redraws on every tiny interaction where a more efficient approach is feasible.
- Clean up event listeners and object URLs where appropriate.
- Avoid duplicate network requests and repeated autosaves.
- Ensure large images do not break the layout or exhaust memory unnecessarily.
- Keep the interface usable with touch input.

## 10. Implementation workflow

Work in small, verifiable phases. Do not attempt to implement every feature in a single unreviewed pass.

Phase 0:
- Inspect the repository and assets.
- Create the folder structure.
- Establish CSS tokens and base styles.
- Create the shared logger.
- Create the two-page skeleton.
- Verify that local navigation between landing and workspace works.

Phase 1:
- Complete and polish the landing page.
- Verify responsive behavior and motion preferences.

Phase 2:
- Build the workspace shell, sidebar, tool switching, empty states, and contextual controls.

Phase 3:
- Implement the editor MVP: upload, filters, reset, and download.
- Make the state model explicit from the start.

Phase 4:
- Implement persistence, IndexedDB, autosave, recents, resume, rename, and delete.

Phase 5:
- Implement compressor and Meme / Post.

Phase 6:
- Implement the image catalog with loading, error handling, and infinite scrolling.

Phase 7:
- Implement Logo Maker if time allows.

Phase 8:
- Run a full visual, functional, responsive, accessibility, and security review.
- Deploy to GitHub Pages or Netlify.

At the end of each phase:
1. Summarize what was implemented.
2. Identify anything incomplete or deliberately deferred.
3. Run the relevant checks.
4. Open the actual page in Playwright when available.
5. Inspect desktop and mobile layouts.
6. Fix visible defects before moving on.

## 11. Design quality review

Before declaring any phase complete, critically review:
- Is the hierarchy immediately clear?
- Does the composition feel intentional rather than templated?
- Are typography and spacing consistent?
- Is lime used with restraint?
- Are image previews large enough to be useful?
- Are controls aligned and appropriately sized?
- Are hover, active, focus, disabled, loading, empty, and error states coherent?
- Does the responsive layout feel designed rather than merely compressed?
- Does the actual browser rendering match the intended design?
- Is the interface still usable with reduced motion and keyboard navigation?

Use Playwright screenshots and interaction tests to inspect the real implementation. Do not claim to have visually tested anything unless you actually opened and inspected it.

## 12. Your first task — Phase 0 only

Start by inspecting the current repository and logo assets. Read relevant skill instructions if accessible.

Then implement Phase 0 only.

Do not start building every tool. Do not install dependencies without a demonstrated need. Do not overwrite existing user work without inspecting it first.

Finish Phase 0 with a concise report of:
- Files created
- Design and architecture decisions
- Commands or checks run
- Any issues found
- Exact next step for Phase 1

The priority is exceptional design taste, functional honesty, clean vanilla JavaScript, and iterative quality—not the maximum amount of code in one response.