// Left console: tool buttons, contextual controls and the activity log.
const toolButtons = document.querySelectorAll("[data-tool]");
const controlPanels = document.querySelectorAll("[data-controls]");
const logList = document.querySelector("#activity-log");
const recentsList = document.querySelector("#recents-list");
const MAX_RECENTS_SHOWN = 10;

let drawnProjects = null;
let drawnProjectId = null;

export function initSidebar(onSelectTool, onResume, onDelete) {
  for (const button of toolButtons) {
    button.addEventListener("click", () => onSelectTool(button.dataset.tool, button.textContent.trim()));
  }
  recentsList.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      await onDelete(deleteButton.dataset.delete);
      recentsList.querySelector("button")?.focus(); // the clicked button may be gone; keep keyboard focus in the list
      return;
    }
    const item = event.target.closest("[data-project]");
    if (item) onResume(item.dataset.project);
  });
}

function makeDeleteButton(project) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "recent-delete";
  button.dataset.delete = project.id;
  button.setAttribute("aria-label", `Delete ${project.name}`);
  button.title = "Delete";
  button.textContent = "×";
  return button;
}

function makeRecentItem(project, isCurrent) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "recent";
  button.dataset.project = project.id;
  if (isCurrent) button.setAttribute("aria-current", "true");

  // The thumbnail was checked to be a JPEG data URL when the projects were loaded.
  const thumb = document.createElement(project.thumbnail ? "img" : "span");
  thumb.className = "recent__thumb";
  if (project.thumbnail) {
    thumb.src = project.thumbnail;
    thumb.alt = "";
  }

  const name = document.createElement("span");
  name.className = "recent__name";
  name.textContent = project.name;
  const time = document.createElement("span");
  time.className = "recent__time";
  time.textContent = new Date(project.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const text = document.createElement("span");
  text.className = "recent__text";
  text.append(name, time);

  button.append(thumb, text);
  const item = document.createElement("li");
  item.append(button, makeDeleteButton(project));
  return item;
}

// Rebuilt only when the list or the current project changes, so keyboard focus is not lost on every update.
function renderRecents(state) {
  document.querySelector("#recents-empty").hidden = state.projects.length > 0;
  const status = document.querySelector("#save-status");
  status.textContent = state.saveStatus.text;
  status.classList.toggle("note--error", state.saveStatus.failed);

  if (state.projects === drawnProjects && state.projectId === drawnProjectId) return;
  drawnProjects = state.projects;
  drawnProjectId = state.projectId;
  recentsList.replaceChildren(...state.projects.slice(0, MAX_RECENTS_SHOWN).map((p) => makeRecentItem(p, p.id === state.projectId)));
}

export function renderSidebar(state) {
  for (const button of toolButtons) {
    const active = button.dataset.tool === state.tool;
    if (active) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
  for (const panel of controlPanels) panel.hidden = panel.dataset.controls !== state.tool;
  renderRecents(state);

  logList.replaceChildren(...state.activity.map(({ time, message }) => {
    const item = document.createElement("li");
    const stamp = document.createElement("time");
    stamp.textContent = time.toLocaleTimeString([], { hour12: false });
    item.append(stamp, message); // append(string) inserts text, never HTML
    return item;
  }));
}
