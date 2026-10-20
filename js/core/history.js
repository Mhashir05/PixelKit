import { getState, setState, logActivity } from "./state.js";

const MAX_STEPS = 50;

let startEdits = null; // the edits from before the change that is going on right now

// Call before every change. Only the first call of a change remembers the starting point,
// so a slider drag (hundreds of changes) becomes one step.
export function beginChange() {
  if (!startEdits) startEdits = getState().edits;
}

// Call when the change is over (a slider was let go, a button was clicked).
// The remembered edits become one undo step, but only if something really changed.
export function endChange() {
  const { edits, undoSteps } = getState();
  if (startEdits && JSON.stringify(startEdits) !== JSON.stringify(edits)) {
    setState({ undoSteps: [...undoSteps, startEdits].slice(-MAX_STEPS) });
  }
  startEdits = null;
}

export function undo() {
  const { undoSteps } = getState();
  if (!undoSteps.length) return;
  startEdits = null;
  setState({ edits: undoSteps[undoSteps.length - 1], undoSteps: undoSteps.slice(0, -1) });
  logActivity(`Undo (${undoSteps.length - 1} steps left)`);
}

// A new image or another project starts with an empty history.
export function clearHistory() {
  startEdits = null;
  setState({ undoSteps: [] });
}
