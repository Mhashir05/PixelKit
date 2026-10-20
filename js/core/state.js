import { logger } from "./logger.js";
import { defaultEdits } from "./edits.js";

const MAX_ACTIVITY = 20;

// The single source of truth. The UI is drawn from this object.
const state = {
  tool: "editor", // editor | compressor | meme | logo | catalog
  projectName: "Untitled design",
  image: null, // { name, type, width, height, element } once an image is loaded; the original is never changed
  edits: defaultEdits(), // the Editor settings: filters, rotation, flips, crop, resize, text (see edits.js); the original is never changed
  undoSteps: [], // earlier edits, newest last; Undo takes the last one (see history.js)
  compressor: {
    quality: 75, // 1-100, used for JPG and WebP only
    format: "image/jpeg", // the MIME type to export
    formats: [], // export types this browser really supports (filled in at start-up)
    result: null, // { blob, type, size } of the latest compression
    busy: false,
    error: "",
  },
  meme: {
    preset: "square", // square | portrait | status
    top: "",
    bottom: "",
    font: "impact", // impact | arial | georgia | courier
    color: "#ffffff",
    size: 10, // font size as % of the canvas width
    exportType: "image/jpeg",
    error: "",
  },
  catalog: {
    photos: [], // { id, author, width, height } from Picsum, in the order loaded
    page: 0, // last page loaded successfully
    loading: false, // a page request is in flight
    done: false, // no more pages
    error: "", // message when the last page request failed
    usingId: "", // id of the photo being downloaded for "Use this image"
    useError: "",
  },
  logo: {
    elements: [], // { id, type: "text" | "rect" | "circle", x, y, size, color, text, font } in canvas units (1000 x 1000)
    selectedId: "",
    nextNumber: 1, // used to make ids like "logo-3"
    backgroundOn: false, // false = transparent
    backgroundColor: "#ffffff",
    message: "", // shown under the canvas (limit reached, export failed)
  },
  projectId: null, // id of the saved project the current image belongs to
  projects: [], // saved project metadata, newest first: { id, name, updatedAt, edits, thumbnail }
  saveStatus: { text: "", failed: false }, // shown under Recents
  loading: false,
  error: "", // message shown above the editor canvas
  activity: [], // newest first: { time: Date, message: string }
};

const listeners = [];

export const getState = () => state;

export function subscribe(listener) {
  listeners.push(listener);
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

// Writes to the console (via the logger) and to the Activity Log panel.
export function logActivity(message) {
  logger.info(message);
  setState({ activity: [{ time: new Date(), message }, ...state.activity].slice(0, MAX_ACTIVITY) });
}
