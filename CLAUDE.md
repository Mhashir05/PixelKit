# PixelKit — rules for Claude

The developer is a beginner who must be able to read and explain every line. The top priority is minimal, simple, well-engineered and efficient code.

## Read first

- `docs/ENGINEERING_RULES.md`: how to write code (always follow).
- `docs/ARCHITECTURE.md`: where code lives and which way dependencies point.
- `docs/PRD.md`: what the product does and what is out of scope.
- `PROJECT_BRIEF.md`: original brief; use it for the visual identity (section 2). Where it conflicts with the docs above, the docs win.

## Non-negotiable

- Do only what was asked. Small request, small diff.
- Ask before refactoring, renaming, adding a file or adding a dependency.
- Reuse helpers in `js/core/` before writing new code. Tools never import other tools.
- Never remove validation, accessibility, security checks or logs to make code shorter.
- Console logs go through `js/core/logger.js` and stay in the code. Never log image data or typed text (lengths only). File and project names are allowed.
- Do not weaken the Content Security Policy. No new dependencies.
- Do not commit or push unless asked.
- Code, variable names, strings and comments are in professional English.

## Testing

Serve with `python -m http.server` (not Live Server). Test the changed feature in the browser, check 320px, 390px and 1280px when layout is touched, and keep 0 console errors.

## Report format

Files and lines changed, what was tested, what was not tested, and anything you chose not to do.
