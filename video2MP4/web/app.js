const form = document.querySelector("#jobForm");
const statusPill = document.querySelector("#statusPill");
const logs = document.querySelector("#logs");
const refreshFiles = document.querySelector("#refreshFiles");
const urlInput = form.querySelector('input[name="url"]');
const backendSelect = document.querySelector("#backendSelect");
const mimoPanel = document.querySelector("#mimoPanel");
const generateArticles = document.querySelector("#generateArticles");
const articlePanel = document.querySelector("#articlePanel");
const llmPresetSelect = document.querySelector("#llmPresetSelect");
const llmPresetNote = document.querySelector("#llmPresetNote");
const llmBaseUrlInput = form.querySelector('input[name="llm_base_url"]');
const llmModelInput = form.querySelector('input[name="llm_model"]');

const lists = {
  videos: document.querySelector("#videoFiles"),
  audio: document.querySelector("#audioFiles"),
  transcripts: document.querySelector("#transcriptFiles"),
  articles: document.querySelector("#articleFiles"),
};

let activeJobId = null;
let pollTimer = null;
let healthTimer = null;
let llmModels = [];

function extractUrl(value) {
  const match = value.match(/https?:\/\/[^\s<>"']+/);
  return match ? match[0].replace(/[，。,.；;！!？?、）)\]}】》]+$/u, "") : value.trim();
}

function normalizeUrlInput() {
  const raw = urlInput.value;
  const extracted = extractUrl(raw);
  if (extracted && extracted !== raw) {
    urlInput.value = extracted;
  }
}

function setStatus(status) {
  statusPill.textContent = {
    queued: "排队中",
    running: "处理中",
    completed: "已完成",
    failed: "失败",
    disconnected: "后台断开",
  }[status] || "待开始";
  statusPill.className = status || "";
}

function appendLog(message) {
  const current = logs.textContent && logs.textContent !== "等待任务..." ? `${logs.textContent}\n` : "";
  logs.textContent = `${current}${message}`;
}

function markDisconnected() {
  setStatus("disconnected");
  appendLog("后台服务已断开。当前任务不会继续更新，请重新启动服务后再提交任务。");
  if (pollTimer) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function renderList(node, files) {
  node.innerHTML = "";
  if (!files.length) {
    const empty = document.createElement("li");
    empty.textContent = "暂无文件";
    node.append(empty);
    return;
  }

  for (const file of files) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = file.url;
    link.textContent = file.name;
    link.title = file.path;
    link.target = "_blank";
    item.append(link);
    node.append(item);
  }
}

function updateLlmPresetFields() {
  const preset = llmModels.find((item) => item.id === llmPresetSelect.value);
  if (!preset) {
    llmPresetNote.textContent = "模型预设来自 config/llm_models.json。";
    return;
  }

  if (!llmBaseUrlInput.value) {
    llmBaseUrlInput.placeholder = preset.base_url || "留空则使用环境变量";
  }
  if (!llmModelInput.value) {
    llmModelInput.placeholder = preset.model || "留空则使用所选预设";
  }

  const apiKeyHint = preset.api_key_env ? `Key 环境变量：${preset.api_key_env}` : "Key 使用页面输入或环境变量";
  const note = preset.note ? `。${preset.note}` : "";
  llmPresetNote.textContent = `${apiKeyHint}${note}`;
}

async function loadLlmModels() {
  try {
    const response = await fetch("/api/config/llm-models", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`写作模型配置加载失败：${response.status}`);
    }
    const data = await response.json();
    llmModels = data.models || [];
    llmPresetSelect.innerHTML = "";

    for (const model of llmModels) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label || model.id;
      option.dataset.model = model.model || "";
      option.dataset.baseUrl = model.base_url || "";
      llmPresetSelect.append(option);
    }

    if (data.default && llmModels.some((model) => model.id === data.default)) {
      llmPresetSelect.value = data.default;
    }
    updateLlmPresetFields();
  } catch (error) {
    llmPresetSelect.innerHTML = '<option value="">配置加载失败</option>';
    llmPresetNote.textContent = error.message || "写作模型配置加载失败。";
  }
}

async function loadFiles() {
  try {
    const response = await fetch("/api/files");
    if (!response.ok) {
      throw new Error(`文件列表加载失败：${response.status}`);
    }
    const data = await response.json();
    renderList(lists.videos, data.videos || []);
    renderList(lists.audio, data.audio || []);
    renderList(lists.transcripts, data.transcripts || []);
    renderList(lists.articles, data.articles || []);
  } catch (error) {
    renderList(lists.videos, []);
    renderList(lists.audio, []);
    renderList(lists.transcripts, []);
    renderList(lists.articles, []);
    appendLog(error.message || "文件列表加载失败。");
  }
}

async function pollJob(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`任务状态请求失败：${response.status}`);
    }
    const job = await response.json();
    setStatus(job.status);
    logs.textContent = job.logs?.length ? job.logs.join("\n") : "任务已创建...";

    if (job.status === "completed" || job.status === "failed") {
      activeJobId = null;
      await loadFiles();
      return;
    }

    pollTimer = window.setTimeout(() => pollJob(jobId), 1500);
  } catch (error) {
    markDisconnected();
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("health check failed");
    }
  } catch {
    if (activeJobId) {
      markDisconnected();
    }
  } finally {
    healthTimer = window.setTimeout(checkHealth, 5000);
  }
}

function updateSourcePanel() {
  const value = new FormData(form).get("source_type");
  document.querySelectorAll(".source-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== value);
  });
}

function updateBackendPanel() {
  const isMimo = backendSelect.value === "mimo";
  mimoPanel.classList.toggle("hidden", !isMimo);
  document.querySelectorAll(".local-asr").forEach((panel) => {
    panel.classList.toggle("hidden", isMimo);
  });
}

function updateArticlePanel() {
  const enabled = generateArticles.checked;
  articlePanel.classList.toggle("hidden", !enabled);
  if (enabled) {
    form.querySelector('input[name="save_transcripts"]').checked = true;
  }
}

form.addEventListener("change", updateSourcePanel);
generateArticles.addEventListener("change", updateArticlePanel);
backendSelect.addEventListener("change", updateBackendPanel);
llmPresetSelect.addEventListener("change", updateLlmPresetFields);
urlInput.addEventListener("paste", () => {
  window.setTimeout(normalizeUrlInput, 0);
});
urlInput.addEventListener("input", () => {
  const raw = urlInput.value;
  if (/https?:\/\/[^\s<>"']+/.test(raw) && raw.trim() !== extractUrl(raw)) {
    window.setTimeout(normalizeUrlInput, 0);
  }
});
urlInput.addEventListener("blur", normalizeUrlInput);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("queued");
  logs.textContent = "任务提交中...";
  normalizeUrlInput();

  const data = new FormData(form);
  if (data.get("source_type") === "url") {
    data.delete("upload");
  }

  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      body: data,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      setStatus("failed");
      logs.textContent = error.detail || "提交失败";
      return;
    }

    const payload = await response.json();
    activeJobId = payload.job_id;
    pollJob(payload.job_id);
  } catch {
    markDisconnected();
  }
});

refreshFiles.addEventListener("click", loadFiles);
updateSourcePanel();
updateBackendPanel();
updateArticlePanel();
loadLlmModels();
loadFiles();
checkHealth();
