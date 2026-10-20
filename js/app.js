import { logger } from "./core/logger.js";
import { getState, setState, subscribe, logActivity } from "./core/state.js";
import { initSidebar, renderSidebar } from "./ui/sidebar.js";
import { initEditor, renderEditor, loadImage } from "./tools/editor.js";
import { initCompressor, renderCompressor } from "./tools/compressor.js";
import { initMeme, renderMeme } from "./tools/meme.js";
import { initCatalog, renderCatalog } from "./tools/catalog.js";
import { initLogo, renderLogo } from "./tools/logo.js";
import { initProjects, resumeProject, renameProject, deleteProject } from "./core/projects.js";

const stages = document.querySelectorAll("[data-stage]");
const projectName = document.querySelector("#project-name");

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
  if (document.activeElement !== projectName) projectName.value = state.projectName; // do not overwrite while typing
  document.title = `${document.querySelector(`[data-tool="${state.tool}"]`).textContent.trim()} — PixelKit`;
}

subscribe(render);

initSidebar((tool, name) => {
  if (tool === getState().tool) return;
  setState({ tool });
  logActivity(`Switched to ${name}`);
}, resumeProject, deleteProject);

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
document.addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("is-dragging");
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  if (acceptsImages()) loadImage(file);
  else logActivity("File drop ignored: only the Editor, Compressor and Meme tools accept images");
});

initEditor();
initCompressor();
initMeme();
initCatalog();
initLogo();
initProjects();
logger.info("workspace loaded");
logActivity("Workspace opened");
