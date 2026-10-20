# Working rules for PixelKit

The developer is a beginner who must be able to read, understand and explain every line of this code.

## Code style
- Write simple, plain, beginner-readable code. Prefer small functions with clear names.
- Avoid clever tricks, deep nesting, and abstractions that are not needed yet.
- Comments: only where the reason behind the code is not obvious. No comment on every line, no comments that repeat what the code says.
- Code, variable names, strings and comments are in professional English.

## Scope
- Do only what was asked. A small change request means a small diff.
- Do not refactor, rename, reformat or reorganise code that was not part of the request.
- If you think something needs refactoring, tell me and wait. Do not do it on your own.
- Keep working code unless it is actually broken.

## Project rules
- PROJECT_BRIEF.md is the source of truth. Follow it phase by phase.
- Console logs go through js/core/logger.js and stay in the code permanently.
- Do not weaken the Content Security Policy.