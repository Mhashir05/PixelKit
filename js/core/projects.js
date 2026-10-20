import { logger } from "./logger.js";
import { getState, setState, subscribe, logActivity } from "./state.js";
import { defaultEdits, cleanEdits } from "./edits.js";
import { clearHistory } from "./history.js";
import * as db from "./db.js";
import { decodeImage, makeThumbnail } from "./image.js";

const SAVE_DELAY = 1000;
const MAX_PROJECTS = 10; // older projects are removed, with their saved images
const DEFAULT_NAME = "Untitled design";
const THUMBNAIL_PREFIX = "data:image/jpeg;base64,";

let saveTimer;
let saving = false;
let lastSavedKey = ""; // project id + edits of the last successful save
let lastFailedKey = ""; // a failed save is retried only after something changes
let blobSavedFor = ""; // project id whose original image is already in IndexedDB

// ---------- Helpers ----------

const keyFor = (state) => `${state.projectId}|${state.projectName}|${JSON.stringify(state.edits)}`;

// The 40-character limit is enforced here, not only by the input's maxlength.
function cleanName(raw) {
  return String(raw).trim().slice(0, 40).trim() || DEFAULT_NAME;
}

function describeError(err) {
  if (err?.name === "QuotaExceededError") return "Browser storage is full. Your work is not being saved.";
  return "Saving is not available in this browser. Your work is not being saved.";
}

function cleanProjects(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && Number.isFinite(p.updatedAt))
    .map((p) => ({
      id: p.id,
      name: cleanName(p.name),
      updatedAt: p.updatedAt,
      edits: cleanEdits(p.edits ?? p.filters), // projects saved by older versions used the name "filters"
      thumbnail: typeof p.thumbnail === "string" && p.thumbnail.startsWith(THUMBNAIL_PREFIX) ? p.thumbnail : "",
    }));
}

// ---------- Autosave ----------

// Failing to free space must not turn a successful save into a failed one, so errors are only logged.
async function deleteImages(oldProjects) {
  for (const old of oldProjects) {
    try {
      await db.deleteImage(old.id);
      logger.info("old project removed", { id: old.id });
    } catch (err) {
      logger.error("could not remove an old project's image", err);
    }
  }
}

async function saveProject() {
  const state = getState();
  if (saving || !state.image || !state.projectId) return;
  const key = keyFor(state);
  if (key === lastSavedKey) return; // nothing changed

  saving = true;
  const id = state.projectId;
  try {
    if (blobSavedFor !== id) {
      await db.saveImage(id, state.image.file);
      blobSavedFor = id;
    }
    // The project may have been deleted or replaced while the image was being written.
    if (getState().projectId !== id) return;
    const project = {
      id,
      name: state.projectName,
      updatedAt: Date.now(),
      edits: { ...state.edits },
      thumbnail: makeThumbnail(state.image, state.edits),
    };
    const newestFirst = [project, ...state.projects.filter((p) => p.id !== project.id)];
    const projects = newestFirst.slice(0, MAX_PROJECTS);
    db.saveProjects(projects);
    lastSavedKey = key;
    lastFailedKey = "";
    setState({ projects, saveStatus: { text: `Saved at ${new Date().toLocaleTimeString([], { hour12: false })}`, failed: false } });
    const { text, ...otherEdits } = project.edits; // the typed text is never logged, only its length
    logger.info("project saved", { id: project.id, edits: { ...otherEdits, textLength: text.length } });
    await deleteImages(newestFirst.slice(MAX_PROJECTS));
  } catch (err) {
    logger.error("save failed", err);
    lastFailedKey = key;
    setState({ saveStatus: { text: describeError(err), failed: true } });
  } finally {
    saving = false;
    scheduleSave(); // picks up changes made while this save was running
  }
}

function scheduleSave() {
  const state = getState();
  const key = keyFor(state);
  if (!state.image || !state.projectId || key === lastSavedKey || key === lastFailedKey) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, SAVE_DELAY);
}

// ---------- Resume ----------

export async function resumeProject(id) {
  const project = getState().projects.find((p) => p.id === id);
  if (!project) return;
  logger.info("resume requested", { id });
  try {
    const file = await db.loadImage(id);
    if (!file) throw new Error("image missing from IndexedDB");
    const element = await decodeImage(file);
    const image = { name: file.name, type: file.type, width: element.naturalWidth, height: element.naturalHeight, element, file };

    // Mark as already saved first, so resuming does not trigger a save.
    const edits = { ...defaultEdits(), ...project.edits };
    lastSavedKey = keyFor({ projectId: id, projectName: project.name, edits });
    blobSavedFor = id;
    clearHistory();
    setState({ image, edits, projectId: id, projectName: project.name, tool: "editor", error: "" });
    logActivity(`Resumed ${project.name}`);
  } catch (err) {
    logger.error("resume failed", err);
    setState({ saveStatus: { text: "This project could not be opened. Its saved image is missing or unreadable.", failed: true } });
  }
}

// ---------- Rename and delete ----------

// Autosave stores the new name, because the name is part of the save key.
export function renameProject(raw) {
  const name = cleanName(raw);
  if (name === getState().projectName) return;
  setState({ projectName: name });
  logActivity(`Renamed project to "${name}"`);
}

export async function deleteProject(id) {
  const project = getState().projects.find((p) => p.id === id);
  if (!project) return;
  if (!confirm(`Delete "${project.name}"? Its saved image is removed and this cannot be undone.`)) {
    logger.info("delete cancelled", { id });
    return;
  }

  try {
    await db.deleteImage(id);
  } catch (err) {
    logger.error("delete failed: could not remove the saved image", err);
    setState({ saveStatus: { text: "Could not delete this project. The browser blocked access to its saved image.", failed: true } });
    return; // nothing was removed, so the list still matches storage
  }

  const projects = getState().projects.filter((p) => p.id !== id);
  try {
    db.saveProjects(projects);
    setState({ saveStatus: { text: "Project deleted.", failed: false } });
  } catch (err) {
    logger.error("delete: image removed but the project list could not be updated", err);
    setState({ saveStatus: { text: "The image was deleted, but the project list could not be updated. Reloading may show it again.", failed: true } });
  }

  const wasOpen = getState().projectId === id;
  if (blobSavedFor === id) blobSavedFor = "";
  if (wasOpen) {
    clearTimeout(saveTimer);
    lastSavedKey = "";
    lastFailedKey = "";
    clearHistory();
    setState({ image: null, edits: defaultEdits(), projectId: null, projectName: DEFAULT_NAME, error: "" });
  }
  setState({ projects });
  logActivity(`Deleted ${project.name}`);
}

// ---------- Start-up ----------

export function initProjects() {
  try {
    const projects = cleanProjects(db.loadProjects());
    setState({ projects });
    logger.info("recents loaded", { count: projects.length });
  } catch (err) {
    logger.error("could not read saved projects", err);
    setState({ saveStatus: { text: "Saved projects could not be read in this browser.", failed: true } });
  }
  subscribe(scheduleSave);
  // Saving cannot wait for the timer if the tab is being closed or hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveProject();
  });
}
