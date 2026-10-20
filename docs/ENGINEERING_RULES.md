# Engineering Rules

These rules apply to every task. They are written for a small team, or one developer working with an AI assistant, that wants code which is short, simple, correct and easy to review.

## 1. Priority order

When two rules conflict, the higher one wins:

1. Correct and safe (works, validates input, no security holes)
2. Accessible (keyboard, labels, focus, contrast)
3. Simple and readable (a beginner can explain every line)
4. Short (fewer lines, files and dependencies)
5. Fast (only after measuring a real problem)

Short code is a goal, not a rule that beats correctness. Never remove validation, error handling, security checks, accessibility or required logs to save lines.

## 2. Write less code

- Solve the task with the smallest change that fully works. The size of the diff matches the size of the request.
- Before writing new code, check in this order: a built-in platform feature, an existing helper in this project, then new code.
- No speculative code: no options, parameters, abstractions or files "for later". Build it when it is needed.
- Delete dead code instead of commenting it out. Git keeps the history.
- One source of truth: if the same logic appears in two places, move it into one shared helper.
- A new file is allowed only when it removes more complexity than it adds.

## 3. Keep code simple

- One function does one job. Most functions fit on one screen (about 30 lines). Split by responsibility, not by line count.
- Flat control flow: use early returns, and avoid nesting deeper than two levels.
- Clear names instead of comments. Comments explain why, never what.
- Plain code over clever code. Avoid nested ternaries, destructuring tricks, long method chains, lookup tables that replace a simple if/else, and one-letter names outside short loops.
- Prefer plain functions and data over classes and patterns, unless the pattern clearly removes code.

## 4. Dependencies and structure

- No new external dependency (library, framework, build tool) without a written reason and approval.
- Dependencies point one way: features use shared core helpers; core never imports a feature; features never import each other.
- Each file has one clear responsibility that fits in one sentence.

## 5. Efficiency

- Do expensive work once and reuse the result (decode once, cache a scaled copy, compute on change, not on every frame).
- Keep event handlers light. In input, scroll and pointermove handlers, only record what changed and schedule the work (requestAnimationFrame, debounce or throttle).
- Clean up what you create: timers, observers, object URLs, listeners that outlive their element.
- Avoid duplicate work: duplicate network requests, duplicate saves, redraws when nothing changed.
- Measure before optimising. Do not add complexity for a speed problem nobody has seen.

## 6. Errors, security and logging

- Validate at the boundaries only: user input, files, network responses and stored data. Trust internal function calls.
- Show the user a clear message for expected failures. Never fail silently.
- Never insert user-controlled or remote text as HTML. Use textContent.
- No secrets or API keys in client code. No eval.
- Do not weaken the Content Security Policy.
- Important events are logged through the project's shared logger, and those logs stay in the code. Never log personal data, file contents or image data.

## 7. Working as a collaborator

- Do only what was asked. Ask before refactoring, renaming, adding a file, adding a dependency or changing behaviour that was not requested.
- Explain trade-offs in plain words when there is more than one reasonable way.
- Keep commits small and focused, with a message that says what changed and why.
- Report honestly: what changed (files and lines), what was tested, and what was not tested.

## 8. Definition of done

A change is done when all of these are true:

- [ ] It does what was asked, and nothing extra.
- [ ] No duplicated logic, dead code, unused imports or debug leftovers were added.
- [ ] Every new function has one job and a clear name.
- [ ] Validation, error messages, accessibility and logs still work.
- [ ] It was tested in the real environment, and the report says what was and was not tested.
- [ ] The diff is small enough to review in a few minutes.
