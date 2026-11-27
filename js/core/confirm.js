import { logger } from "./logger.js";

// One shared "Are you sure?" dialog (the <dialog id="confirm-dialog"> in app.html), only for actions that cannot be undone.
const $ = (id) => document.getElementById(id);
let pending = null; // { resolve, trigger, action } while the dialog is open; only one question at a time
const CLICK_GUARD = 400; // ms after opening: the second click of a double click must not answer the dialog
let openedAt = 0;

// Resolves true when the user confirms, false on Cancel, Escape or a click outside the dialog.
export function confirmAction({ title, message, confirmLabel }) {
  if (pending) return Promise.resolve(false); // already asking, so a second click cannot stack another question
  const dialog = $("confirm-dialog");
  $("confirm-title").textContent = title;
  $("confirm-message").textContent = message;
  $("confirm-ok").textContent = confirmLabel;
  logger.info("confirmation shown", { action: confirmLabel });
  return new Promise((resolve) => {
    pending = { resolve, trigger: document.activeElement, action: confirmLabel };
    dialog.showModal();
    openedAt = performance.now();
    $("confirm-cancel").focus(); // the safe choice has focus, so Enter does not destroy anything
  });
}

function finish(confirmed) {
  if (!pending) return;
  const { resolve, trigger, action } = pending;
  pending = null; // before close(), so the close event below does nothing
  $("confirm-dialog").close();
  trigger?.focus();
  logger.info(confirmed ? "confirmation confirmed" : "confirmation cancelled", { action });
  resolve(confirmed);
}

export function initConfirm() {
  const dialog = $("confirm-dialog");
  const tooSoon = () => performance.now() - openedAt < CLICK_GUARD;
  $("confirm-cancel").addEventListener("click", () => { if (!tooSoon()) finish(false); });
  $("confirm-ok").addEventListener("click", () => { if (!tooSoon()) finish(true); });
  dialog.addEventListener("cancel", (event) => { // Escape
    event.preventDefault();
    finish(false);
  });
  dialog.addEventListener("close", () => finish(false)); // any other way the dialog closes counts as Cancel
  dialog.addEventListener("click", (event) => { // a click on the backdrop lands on the dialog itself, outside its box
    if (event.target !== dialog || tooSoon()) return;
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) finish(false);
  });
}
