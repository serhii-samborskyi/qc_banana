const app = document.querySelector("#app");
const tabs = document.querySelectorAll(".tab");

const state = {
  view: location.hash.replace("#", "") || "generate",
  tasks: [],
  history: [],
  settings: null,
  selectedColor: "orange",
  selectedTaskId: "",
  editingTaskId: "",
  latestGeneration: null,
  currentAddress: "",
  busy: false,
  message: "",
  error: ""
};

await bootstrap();

window.addEventListener("hashchange", () => {
  state.view = location.hash.replace("#", "") || "generate";
  state.message = "";
  state.error = "";
  render();
});

async function bootstrap() {
  try {
    const data = await api("/api/bootstrap");
    state.tasks = data.tasks || [];
    state.history = data.history || [];
    state.settings = data.settings || null;
    state.selectedTaskId = state.tasks[0]?.id || "";
    state.latestGeneration = state.history[0] || null;
  } catch (error) {
    state.error = error.message;
  }
  render();
}

function render() {
  tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === state.view));
  if (!["generate", "admin", "settings", "history"].includes(state.view)) {
    state.view = "generate";
  }

  if (state.view === "admin") renderAdmin();
  if (state.view === "settings") renderSettings();
  if (state.view === "history") renderHistory();
  if (state.view === "generate") renderGenerator();

  bindTabs();
}

function bindTabs() {
  tabs.forEach((tab) => {
    tab.onclick = () => {
      location.hash = tab.dataset.view;
    };
  });
}

function renderGenerator() {
  const task = selectedTask();
  const latest = state.latestGeneration;
  const canGenerate = state.settings?.hasGoogleApiKey && state.tasks.length > 0 && !state.busy;
  const colors = task?.allowedColors?.length ? task.allowedColors : ["orange", "black"];
  const taggedCount = task?.examples?.filter((example) => example.tagNumber)?.length || 0;
  if (!colors.includes(state.selectedColor)) {
    state.selectedColor = colors[0] || "orange";
  }

  app.innerHTML = `
    <section class="layout">
      <div class="panel">
        <h2>Generate QC Picture</h2>
        ${state.settings?.hasGoogleApiKey ? "" : `<div class="notice">Add your Google AI key in Settings before generating.</div>`}
        ${taggedCount ? `<div class="notice">Using random tagged example as the edit source. Only the address tag is replaced when possible.</div>` : ""}
        ${state.error ? `<div class="notice error">${escapeHtml(state.error)}</div>` : ""}
        ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ""}
        <form id="generateForm" class="form-grid">
          <label>
            <span>Task</span>
            <select name="taskId" ${state.tasks.length ? "" : "disabled"}>
              ${state.tasks.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === state.selectedTaskId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Address Tag</span>
            <input name="addressNumber" autocomplete="off" placeholder="APT 6" maxlength="32" value="${escapeAttr(state.currentAddress)}" required />
          </label>
          <div>
            <div class="field-label">Cable Color</div>
            <div class="segmented" role="group" aria-label="Cable color">
              ${colors.map((color) => colorButton(color)).join("")}
            </div>
          </div>
          <div class="actions">
            <button class="button primary" type="submit" ${canGenerate ? "" : "disabled"}>
              ${state.busy ? `<span class="button-spinner" aria-hidden="true"></span>Generating...` : "Generate Image"}
            </button>
            <button class="button secondary" id="refreshButton" type="button">Refresh</button>
          </div>
        </form>
      </div>
      <aside class="panel">
        <h2>Latest Result</h2>
        ${
          state.busy
            ? `<div class="result-frame"><div class="progress-card">
                 <div class="spinner-ring" aria-hidden="true"></div>
                 <h3>Generating image</h3>
                 <div class="progress-track"><span></span></div>
               </div></div>`
            : latest
            ? `<div class="result-frame"><img src="${latest.imageUrl}" alt="Generated QC result for address ${escapeAttr(latest.addressNumber)}" /></div>
               <div class="actions" style="margin-top: 12px;">
                 <a class="button secondary" href="${latest.downloadUrl}" download>Download</a>
                 <span class="status ok">${escapeHtml(latest.cableColor)} cable · ${escapeHtml(latest.addressNumber)}</span>
                 ${latest.sourceTagNumber ? `<span class="status ok">from ${escapeHtml(latest.sourceTagNumber)}</span>` : ""}
               </div>`
            : `<div class="empty-state">Generated tap pictures will appear here.</div>`
        }
      </aside>
    </section>
  `;

  document.querySelector("#generateForm")?.addEventListener("submit", onGenerate);
  document.querySelector("select[name='taskId']")?.addEventListener("change", (event) => {
    state.selectedTaskId = event.target.value;
    const nextTask = selectedTask();
    state.selectedColor = nextTask?.allowedColors?.[0] || "orange";
    render();
  });
  document.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedColor = button.dataset.color;
      render();
    });
  });
  document.querySelector("#refreshButton")?.addEventListener("click", bootstrap);
}

function colorButton(color) {
  return `<button class="segment ${state.selectedColor === color ? "is-active" : ""}" type="button" data-color="${escapeAttr(color)}">
    <span class="swatch ${escapeAttr(color)}"></span>${capitalize(color)}
  </button>`;
}

async function onGenerate(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.currentAddress = String(form.get("addressNumber") || "");
  state.busy = true;
  state.error = "";
  state.message = "";
  render();

  try {
    const generation = await api("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: form.get("taskId"),
        addressNumber: form.get("addressNumber"),
        cableColor: state.selectedColor
      })
    });
    state.latestGeneration = generation;
    state.history = [generation, ...state.history.filter((item) => item.id !== generation.id)];
    state.message = "Image generated and saved to history.";
  } catch (error) {
    state.error = error.message;
  } finally {
    state.busy = false;
    render();
  }
}

function renderAdmin() {
  const editing = state.tasks.find((task) => task.id === state.editingTaskId);
  const task = editing || blankTask();
  app.innerHTML = `
    <section class="layout">
      <div class="panel">
        <h2>${editing ? "Edit Task" : "New Task"}</h2>
        ${state.error ? `<div class="notice error">${escapeHtml(state.error)}</div>` : ""}
        ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ""}
        <form id="taskForm" class="form-grid">
          <label>
            <span>Name</span>
            <input name="name" value="${escapeAttr(task.name)}" placeholder="Tap in bushes" required />
          </label>
          <label>
            <span>Description</span>
            <input name="description" value="${escapeAttr(task.description)}" placeholder="Underground pedestal tap with grass and bushes" />
          </label>
          <label>
            <span>Prompt Template</span>
            <textarea name="prompt" required>${escapeHtml(task.prompt)}</textarea>
          </label>
          <div class="two">
            <label>
              <span>Model Override</span>
              <input name="model" value="${escapeAttr(task.model)}" placeholder="${escapeAttr(state.settings?.defaultModel || "gemini-3.1-flash-image")}" />
            </label>
            <label>
              <span>Aspect Ratio</span>
              <select name="aspectRatio">
                ${aspectRatioOptions(task.aspectRatio)}
              </select>
            </label>
          </div>
          <div class="two">
            <label>
              <span>Image Size</span>
              <select name="imageSize">
                ${imageSizeOptions(task.imageSize)}
              </select>
            </label>
            <div>
              <div class="field-label">Allowed Colors</div>
              <div class="checkbox-row">
                ${["orange", "black"].map((color) => checkboxColor(color, task.allowedColors)).join("")}
              </div>
            </div>
          </div>
          <label>
            <span>Example Images</span>
            <input name="examples" type="file" accept="image/*" multiple />
          </label>
          ${editing?.examples?.length ? `<div class="example-grid">${editing.examples.map(exampleImage).join("")}</div>` : `<p class="small">Upload examples, then save the current tag number shown in each photo.</p>`}
          <div class="actions">
            <button class="button primary" type="submit">${editing ? "Save Task" : "Create Task"}</button>
            ${editing ? `<button class="button secondary" id="newTaskButton" type="button">New Task</button>` : ""}
          </div>
        </form>
      </div>
      <aside class="panel">
        <h2>Tasks</h2>
        <div class="task-list">
          ${
            state.tasks.length
              ? state.tasks.map(taskCard).join("")
              : `<div class="empty-state">No tasks yet.</div>`
          }
        </div>
      </aside>
    </section>
  `;

  document.querySelector("#taskForm")?.addEventListener("submit", onSaveTask);
  document.querySelector("#newTaskButton")?.addEventListener("click", () => {
    state.editingTaskId = "";
    state.message = "";
    state.error = "";
    render();
  });
  document.querySelectorAll("[data-edit-task]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingTaskId = button.dataset.editTask;
      state.message = "";
      state.error = "";
      render();
    });
  });
  document.querySelectorAll("[data-delete-task]").forEach((button) => {
    button.addEventListener("click", () => deleteTask(button.dataset.deleteTask));
  });
  document.querySelectorAll("[data-delete-example]").forEach((button) => {
    button.addEventListener("click", () => deleteExample(button.dataset.taskId, button.dataset.deleteExample));
  });
  document.querySelectorAll("[data-save-example]").forEach((button) => {
    button.addEventListener("click", () => updateExample(button.dataset.taskId, button.dataset.saveExample));
  });
  document.querySelectorAll("[data-open-image]").forEach((button) => {
    button.addEventListener("click", () => openImageModal(button.dataset.openImage, button.dataset.imageTitle || "Uploaded example"));
  });
  document.querySelectorAll("[data-example-card]").forEach((card) => {
    const sync = () => updateExampleDirtyState(card);
    card.querySelector("[data-example-tag]")?.addEventListener("input", sync);
    card.querySelector("[data-example-color]")?.addEventListener("change", sync);
    updateExampleDirtyState(card);
  });
}

function blankTask() {
  return {
    name: "",
    description: "",
    prompt: `Create a realistic close-up field photo for cable QC.

Task: {{taskName}}
Address tag: {{addressNumber}}
Cable color: {{cableColor}}

Use uploaded example images as the visual reference for hardware, environment, framing, and label/tag style. The address tag must appear clearly on a physical tag near the cable.`,
    allowedColors: ["orange", "black"],
    model: "",
    aspectRatio: state.settings?.defaultAspectRatio || "3:4",
    imageSize: state.settings?.defaultImageSize || "1K",
    examples: []
  };
}

async function onSaveTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const allowedColors = [...form.querySelectorAll("input[name='allowedColors']:checked")].map((item) => item.value);
  data.set("allowedColors", JSON.stringify(allowedColors));

  const isEditing = Boolean(state.editingTaskId);
  state.error = "";
  state.message = "";

  try {
    const saved = await api(isEditing ? `/api/tasks/${state.editingTaskId}` : "/api/tasks", {
      method: isEditing ? "PUT" : "POST",
      body: data
    });
    if (isEditing) {
      state.tasks = state.tasks.map((task) => (task.id === saved.id ? saved : task));
    } else {
      state.tasks = [saved, ...state.tasks];
      state.editingTaskId = saved.id;
    }
    state.selectedTaskId ||= saved.id;
    state.message = "Task saved.";
  } catch (error) {
    state.error = error.message;
  }
  render();
}

async function deleteTask(id) {
  if (!confirm("Delete this task and its reference images?")) return;
  try {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    state.tasks = state.tasks.filter((task) => task.id !== id);
    if (state.selectedTaskId === id) state.selectedTaskId = state.tasks[0]?.id || "";
    if (state.editingTaskId === id) state.editingTaskId = "";
    state.message = "Task deleted.";
  } catch (error) {
    state.error = error.message;
  }
  render();
}

async function deleteExample(taskId, exampleId) {
  try {
    const saved = await api(`/api/tasks/${taskId}/examples/${exampleId}`, { method: "DELETE" });
    state.tasks = state.tasks.map((task) => (task.id === saved.id ? saved : task));
    state.message = "Reference image removed.";
  } catch (error) {
    state.error = error.message;
  }
  render();
}

async function updateExample(taskId, exampleId) {
  const card = document.querySelector(`[data-example-card="${CSS.escape(exampleId)}"]`);
  if (!card) return;

  try {
    const saved = await api(`/api/tasks/${taskId}/examples/${exampleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tagNumber: card.querySelector("[data-example-tag]")?.value || "",
        cableColor: card.querySelector("[data-example-color]")?.value || ""
      })
    });
    state.tasks = state.tasks.map((task) => (task.id === saved.id ? saved : task));
    state.message = "Example saved.";
    state.error = "";
  } catch (error) {
    state.error = error.message;
  }
  render();
}

function taskCard(task) {
  const taggedCount = task.examples?.filter((example) => example.tagNumber)?.length || 0;
  return `
    <article class="task-card ${task.id === state.editingTaskId ? "is-active" : ""}">
      <h3>${escapeHtml(task.name)}</h3>
      <p class="support">${escapeHtml(task.description || "No description")}</p>
      <p class="small">${taggedCount}/${task.examples?.length || 0} tagged · ${escapeHtml(task.aspectRatio || "3:4")} · ${escapeHtml(task.imageSize || "1K")}</p>
      <div class="actions">
        <button class="button secondary" type="button" data-edit-task="${escapeAttr(task.id)}">Edit</button>
        <button class="button danger" type="button" data-delete-task="${escapeAttr(task.id)}">Delete</button>
      </div>
    </article>
  `;
}

function exampleImage(example) {
  const statusClass = example.tagNumber ? "is-saved" : "is-missing";
  const statusText = example.tagNumber ? "Saved" : "Missing tag";
  return `
    <article class="example-card" data-example-card="${escapeAttr(example.id)}" data-saved-tag="${escapeAttr(example.tagNumber || "")}" data-saved-color="${escapeAttr(example.cableColor || "")}">
      <div class="example-image-wrap">
        <span class="example-save-badge ${statusClass}" data-example-status>${statusText}</span>
        <button class="image-preview-button" type="button" data-open-image="${escapeAttr(example.url)}" data-image-title="${escapeAttr(example.originalName || "Uploaded example")}" aria-label="Open ${escapeAttr(example.originalName || "uploaded example")} full size">
          <img src="${example.url}" alt="${escapeAttr(example.originalName || "Reference image")}" />
        </button>
        <button class="delete-example" type="button" title="Remove image" data-task-id="${escapeAttr(state.editingTaskId)}" data-delete-example="${escapeAttr(example.id)}">×</button>
      </div>
      <label>
        <span>Current Tag</span>
        <input data-example-tag value="${escapeAttr(example.tagNumber || "")}" placeholder="F15" maxlength="32" />
      </label>
      <label>
        <span>Cable In Photo</span>
        <select data-example-color>
          ${exampleColorOptions(example.cableColor || "")}
        </select>
      </label>
      <button class="button secondary" type="button" data-task-id="${escapeAttr(state.editingTaskId)}" data-save-example="${escapeAttr(example.id)}">Save Example</button>
    </article>
  `;
}

function updateExampleDirtyState(card) {
  const tagInput = card.querySelector("[data-example-tag]");
  const colorSelect = card.querySelector("[data-example-color]");
  const status = card.querySelector("[data-example-status]");
  const saveButton = card.querySelector("[data-save-example]");
  const savedTag = card.dataset.savedTag || "";
  const savedColor = card.dataset.savedColor || "";
  const currentTag = normalizeClientTag(tagInput?.value || "");
  const currentColor = colorSelect?.value || "";
  const dirty = currentTag !== savedTag || currentColor !== savedColor;

  card.classList.toggle("is-dirty", dirty);
  if (saveButton) {
    saveButton.disabled = !dirty;
  }
  if (!status) return;

  status.classList.remove("is-saved", "is-dirty", "is-missing");
  if (dirty) {
    status.textContent = "Unsaved";
    status.classList.add("is-dirty");
  } else if (currentTag) {
    status.textContent = "Saved";
    status.classList.add("is-saved");
  } else {
    status.textContent = "Missing tag";
    status.classList.add("is-missing");
  }
}

function normalizeClientTag(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function openImageModal(src, title) {
  closeImageModal();

  const modal = document.createElement("div");
  modal.className = "image-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="image-modal-bar">
      <h2>${escapeHtml(title)}</h2>
      <button class="button secondary" type="button" data-close-modal>Close</button>
    </div>
    <div class="image-modal-body">
      <img src="${escapeAttr(src)}" alt="${escapeAttr(title)}" />
    </div>
  `;

  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close-modal]")) {
      closeImageModal();
    }
  });

  document.body.classList.add("modal-open");
  document.body.append(modal);
  document.addEventListener("keydown", closeModalOnEscape);
  modal.querySelector("[data-close-modal]")?.focus();
}

function closeImageModal() {
  document.querySelector(".image-modal")?.remove();
  document.body.classList.remove("modal-open");
  document.removeEventListener("keydown", closeModalOnEscape);
}

function closeModalOnEscape(event) {
  if (event.key === "Escape") {
    closeImageModal();
  }
}

function renderSettings() {
  app.innerHTML = `
    <section class="layout">
      <div class="panel">
        <h2>Settings</h2>
        ${state.error ? `<div class="notice error">${escapeHtml(state.error)}</div>` : ""}
        ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ""}
        <form id="settingsForm" class="form-grid">
          <label>
            <span>Google AI API Key</span>
            <input name="googleApiKey" type="password" autocomplete="off" placeholder="${state.settings?.hasGoogleApiKey ? "Saved. Leave blank to keep current key." : "Paste Google AI key"}" />
          </label>
          <div class="checkbox-row">
            <label><input type="checkbox" name="clearGoogleApiKey" value="true" /> Clear saved key</label>
          </div>
          <div class="two">
            <label>
              <span>Default Model</span>
              <input name="defaultModel" value="${escapeAttr(state.settings?.defaultModel || "gemini-3.1-flash-image")}" />
            </label>
            <label>
              <span>Default Aspect Ratio</span>
              <select name="defaultAspectRatio">${aspectRatioOptions(state.settings?.defaultAspectRatio || "3:4")}</select>
            </label>
          </div>
          <label>
            <span>Default Image Size</span>
            <select name="defaultImageSize">${imageSizeOptions(state.settings?.defaultImageSize || "1K")}</select>
          </label>
          <div class="actions">
            <button class="button primary" type="submit">Save Settings</button>
            <span class="status ${state.settings?.hasGoogleApiKey ? "ok" : "warn"}">${state.settings?.hasGoogleApiKey ? "API key saved" : "No API key"}</span>
          </div>
        </form>
      </div>
      <aside class="panel">
        <h2>Coolify Storage</h2>
        <p class="support">Mount a persistent volume to the app data directory so settings, task images, and generation history survive deploys.</p>
        <p class="small"><strong>Current data dir:</strong> ${escapeHtml(state.settings?.dataDir || "data")}</p>
        <p class="small"><strong>Recommended env:</strong> DATA_DIR=/data</p>
      </aside>
    </section>
  `;

  document.querySelector("#settingsForm")?.addEventListener("submit", onSaveSettings);
}

async function onSaveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.error = "";
  state.message = "";
  try {
    state.settings = await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        googleApiKey: form.get("googleApiKey"),
        clearGoogleApiKey: form.get("clearGoogleApiKey") === "true",
        defaultModel: form.get("defaultModel"),
        defaultAspectRatio: form.get("defaultAspectRatio"),
        defaultImageSize: form.get("defaultImageSize")
      })
    });
    state.message = "Settings saved.";
  } catch (error) {
    state.error = error.message;
  }
  render();
}

function renderHistory() {
  app.innerHTML = `
    <section class="panel">
      <h2>Generation History</h2>
      ${state.history.length ? `<div class="gallery">${state.history.map(historyCard).join("")}</div>` : `<div class="empty-state">No generated images yet.</div>`}
    </section>
  `;

  document.querySelectorAll("[data-delete-history]").forEach((button) => {
    button.addEventListener("click", () => deleteHistory(button.dataset.deleteHistory));
  });
}

function historyCard(item) {
  return `
    <article class="thumb-card">
      <img src="${item.imageUrl}" alt="Generated ${escapeAttr(item.taskName)} for ${escapeAttr(item.addressNumber)}" />
      <div class="meta">
        <h3>${escapeHtml(item.addressNumber)} · ${escapeHtml(capitalize(item.cableColor))}</h3>
        <p>${escapeHtml(item.taskName)}</p>
        <p>${formatDate(item.createdAt)}</p>
        <div class="actions">
          <a class="button secondary" href="${item.downloadUrl}" download>Download</a>
          <button class="button danger" type="button" data-delete-history="${escapeAttr(item.id)}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

async function deleteHistory(id) {
  if (!confirm("Delete this generated image?")) return;
  try {
    await api(`/api/history/${id}`, { method: "DELETE" });
    state.history = state.history.filter((item) => item.id !== id);
    if (state.latestGeneration?.id === id) state.latestGeneration = state.history[0] || null;
  } catch (error) {
    state.error = error.message;
  }
  render();
}

function selectedTask() {
  return state.tasks.find((task) => task.id === state.selectedTaskId) || state.tasks[0] || null;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(data?.error || data || `Request failed with ${response.status}`);
  }
  return data;
}

function aspectRatioOptions(current) {
  return ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
    .map((ratio) => `<option value="${ratio}" ${ratio === current ? "selected" : ""}>${ratio}</option>`)
    .join("");
}

function imageSizeOptions(current) {
  return ["512", "1K", "2K", "4K"]
    .map((size) => `<option value="${size}" ${size === current ? "selected" : ""}>${size}</option>`)
    .join("");
}

function exampleColorOptions(current) {
  return [
    ["", "Unknown"],
    ["orange", "Orange"],
    ["black", "Black"]
  ]
    .map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`)
    .join("");
}

function checkboxColor(color, selected = []) {
  return `<label><input type="checkbox" name="allowedColors" value="${color}" ${selected.includes(color) ? "checked" : ""} /> <span class="swatch ${color}"></span>${capitalize(color)}</label>`;
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
