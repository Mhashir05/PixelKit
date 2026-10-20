import { logger } from "./core/logger.js";
import { getState, setState, subscribe, logActivity } from "./core/state.js";
import { initSidebar, renderSidebar } from "./ui/sidebar.js";
import { initEditor, renderEditor } from "./tools/editor.js";
import { loadImage } from "./core/image.js";
import { undo } from "./core/history.js";
import { initCompressor, renderCompressor } from "./tools/compressor.js";
import { initMeme, renderMeme } from "./tools/meme.js";
import { initCatalog, renderCatalog } from "./tools/catalog.js";
import { initLogo, renderLogo } from "./tools/logo.js";
import { initProjects, resumeProject, renameProject, deleteProject } from "./core/projects.js";

const stages = document.querySelectorAll("[data-stage]");
const projectName = document.querySelector("#project-name");
const undoButton = document.querySelector("#undo");

// Undo only works for the Editor, and only when there is a step to go back to.
const canUndo = (state) => state.tool === "editor" && state.undoSteps.length > 0;

// Draw everything from state.
function render(state) {
  renderSidebar(state);
  renderEditor(state);
  renderCompressor(state);
  renderMeme(state);
  renderCatalog(state);
  renderLogo(state); // after renderEditor, because both decide whether the shared Export button is enabled
  for (const stage of stages) stage.hidden = stage.dataset.stage !== state.tool;
  projectName.disabled = !state.image;
  undoButton.disabled = !canUndo(state);
  if (document.activeElement !== projectName) projectName.value = state.projectName; // do not overwrite while typing
  document.title = `${document.querySelector(`[data-tool="${state.tool}"]`).textContent.trim()} — PixelKit`;
}

subscribe(render);

initSidebar((tool, name) => {
  if (tool === getState().tool) return;
  setState({ tool });
  logActivity(`Switched to ${name}`);
}, resumeProject, deleteProject);

undoButton.addEventListener("click", () => {
  undo();
  if (undoButton.disabled) document.querySelector("#export").focus(); // a disabled button cannot keep keyboard focus
});
// Ctrl+Z (Cmd+Z on a Mac). Not while typing in a text box, where the browser has its own undo.
document.addEventListener("keydown", (event) => {
  const isUndoKey = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
  if (!isUndoKey || event.target.matches("input[type=text]") || !canUndo(getState())) return;
  event.preventDefault();
  undo();
});

// Rename: Enter saves, Escape cancels, leaving the field saves.
projectName.addEventListener("change", () => {
  renameProject(projectName.value);
  projectName.value = getState().projectName; // show the cleaned name (trimmed, 40 characters, fallback)
});
projectName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") projectName.blur();
  if (event.key === "Escape") {
    projectName.value = getState().projectName;
    projectName.blur();
  }
});

// Dropping a file anywhere: the image tools load it. The browser must never open it itself.
const acceptsImages = () => ["editor", "compressor", "meme"].includes(getState().tool);
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  const accepts = acceptsImages();
  event.dataTransfer.dropEffect = accepts ? "copy" : "none";
  document.body.classList.toggle("is-dragging", accepts);
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) document.body.classList.remove("is-dragging");
});
document.addEventListener("drop", async (event) => {
  event.preventDefault();
  document.body.classList.remove("is-dragging");
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  if (!acceptsImages()) return logActivity("File drop ignored: only the Editor, Compressor and Meme tools accept images");
  await loadImage(files[0]);
  if (files.length > 1 && !getState().error) { // a rejected first file already shows its own message
    setState({ error: "Only the first file was used." });
    logActivity(`${files.length} files dropped: only the first file was used`);
  }
});

initEditor();
initCompressor();
initMeme();
initCatalog();
initLogo();
initProjects();
logger.info("workspace loaded");
logActivity("Workspace opened");
