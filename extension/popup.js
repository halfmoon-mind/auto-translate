const translateButton = document.getElementById("translateButton");
const restoreButton = document.getElementById("restoreButton");
const statusText = document.getElementById("statusText");
const serverStatus = document.getElementById("serverStatus");
const elapsedText = document.getElementById("elapsedText");

const AVG_WAVE_MS_STORAGE_KEY = "codexTranslatorAvgWaveMs";
const FALLBACK_WAVE_MS_MIN = 30000;
const FALLBACK_WAVE_MS_MAX = 75000;

const elapsedState = {
  intervalId: null,
  startedAt: null,
  finalElapsedMs: null,
  lastStatus: null,
  sampleRecorded: false,
};

init();

function init() {
  translateButton.addEventListener("click", () => {
    runOnActiveTab("CODEX_TRANSLATE_PAGE");
  });

  restoreButton.addEventListener("click", () => {
    runOnActiveTab("CODEX_RESTORE_PAGE");
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "CODEX_TRANSLATION_STATUS") {
      renderStatus(message.status);
    }
  });

  checkServerHealth();
}

async function checkServerHealth() {
  try {
    const response = await sendRuntimeMessage({ type: "CODEX_LOCAL_HEALTH" });

    if (!response?.ok) {
      throw new Error(response?.error || "로컬 브리지 연결 실패");
    }

    serverStatus.textContent = `로컬 브리지 / ${response.model} / ${response.effort}`;
  } catch (error) {
    serverStatus.textContent = "로컬 브리지 연결 실패";
    statusText.textContent = getErrorMessage(error);
  }
}

async function runOnActiveTab(type, options = {}) {
  setBusy(true);

  if (type === "CODEX_TRANSLATE_PAGE") {
    startElapsedTimer(Date.now(), { phase: "starting" });
  }

  try {
    const [tab] = await queryTabs({ active: true, currentWindow: true });

    if (!tab?.id) {
      throw new Error("활성 탭을 찾지 못했습니다.");
    }

    await ensureContentScript(tab.id);
    const response = await sendTabMessage(tab.id, { type, options });

    if (!response?.ok) {
      throw new Error(response?.error || "작업에 실패했습니다.");
    }

    if (type === "CODEX_RESTORE_PAGE") {
      clearElapsedTimer("경과 시간 대기");
      statusText.textContent = `${response.restored || 0}개 단락을 복원했습니다.`;
    } else if (type === "CODEX_TRANSLATE_PAGE") {
      finishElapsedTimer(response.elapsedMs, response.metrics);
    }
  } catch (error) {
    if (type === "CODEX_TRANSLATE_PAGE") {
      finishElapsedTimer(null, null, "중단");
    }
    statusText.textContent = getErrorMessage(error);
  } finally {
    setBusy(false);
  }
}

async function ensureContentScript(tabId) {
  try {
    await sendTabMessage(tabId, { type: "CODEX_TRANSLATOR_PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
  }
}

function renderStatus(status) {
  if (!status?.message) {
    return;
  }

  updateElapsedFromStatus(status);

  if (Number.isFinite(status.current) && Number.isFinite(status.total)) {
    statusText.textContent = `${status.message} (${status.current}/${status.total})`;
    return;
  }

  statusText.textContent = status.message;
}

function updateElapsedFromStatus(status) {
  if (status.phase === "collecting" || status.phase === "translating") {
    startElapsedTimer(status.startedAt, status);
    return;
  }

  if (status.phase === "done") {
    finishElapsedTimer(status.elapsedMs, status.metrics);
    return;
  }

  elapsedState.lastStatus = status;
  renderElapsedText();
}

function startElapsedTimer(startedAt, status) {
  if (status?.phase === "starting") {
    elapsedState.sampleRecorded = false;
    elapsedState.lastStatus = null;
  }

  elapsedState.startedAt = Number.isFinite(startedAt)
    ? startedAt
    : elapsedState.startedAt || Date.now();
  elapsedState.finalElapsedMs = null;
  elapsedState.lastStatus = status || elapsedState.lastStatus;

  if (!elapsedState.intervalId) {
    elapsedState.intervalId = setInterval(renderElapsedText, 1000);
  }

  renderElapsedText();
}

function finishElapsedTimer(elapsedMs, metrics, label = "소요") {
  if (elapsedState.intervalId) {
    clearInterval(elapsedState.intervalId);
    elapsedState.intervalId = null;
  }

  const resolvedElapsedMs = Number.isFinite(elapsedMs)
    ? elapsedMs
    : elapsedState.startedAt
      ? Date.now() - elapsedState.startedAt
      : null;

  elapsedState.finalElapsedMs = resolvedElapsedMs;
  elapsedState.lastStatus = {
    ...(elapsedState.lastStatus || {}),
    phase: label === "소요" ? "done" : "stopped",
    metrics: metrics || elapsedState.lastStatus?.metrics,
    finalLabel: label,
  };

  if (label === "소요" && resolvedElapsedMs !== null) {
    recordElapsedSample(elapsedState.lastStatus.metrics, resolvedElapsedMs);
  }

  renderElapsedText();
}

function clearElapsedTimer(message) {
  if (elapsedState.intervalId) {
    clearInterval(elapsedState.intervalId);
  }

  elapsedState.intervalId = null;
  elapsedState.startedAt = null;
  elapsedState.finalElapsedMs = null;
  elapsedState.lastStatus = null;
  elapsedState.sampleRecorded = false;
  elapsedText.textContent = message;
}

function renderElapsedText() {
  const elapsedMs = Number.isFinite(elapsedState.finalElapsedMs)
    ? elapsedState.finalElapsedMs
    : elapsedState.startedAt
      ? Date.now() - elapsedState.startedAt
      : null;

  if (elapsedMs === null) {
    elapsedText.textContent = "경과 시간 대기";
    return;
  }

  const status = elapsedState.lastStatus || {};
  const label = status.finalLabel || (status.phase === "done" ? "소요" : "경과");
  const parts = [`${label} ${formatDuration(elapsedMs)}`];

  if (status.phase !== "done" && status.phase !== "stopped") {
    const estimate = formatEstimate(status.metrics);
    if (estimate) {
      parts.push(estimate);
    }
  }

  const work = formatWork(status.metrics);
  if (work) {
    parts.push(work);
  }

  elapsedText.textContent = parts.join(" · ");
}

function formatEstimate(metrics) {
  if (!metrics || !Number.isFinite(metrics.waveCount) || metrics.waveCount < 1) {
    return "";
  }

  const averageWaveMs = readAverageWaveMs();
  if (averageWaveMs) {
    return `예상 약 ${formatDuration(metrics.waveCount * averageWaveMs)}`;
  }

  const minMs = metrics.waveCount * FALLBACK_WAVE_MS_MIN;
  const maxMs = metrics.waveCount * FALLBACK_WAVE_MS_MAX;
  return `예상 약 ${formatDuration(minMs)}~${formatDuration(maxMs)}`;
}

function formatWork(metrics) {
  if (!metrics || !Number.isFinite(metrics.batchCount) || metrics.batchCount < 1) {
    return "";
  }

  const parallelRuns = Number.isFinite(metrics.parallelRuns) ? metrics.parallelRuns : 1;
  return `배치 ${metrics.batchCount}개 / 동시 ${parallelRuns}개`;
}

function recordElapsedSample(metrics, elapsedMs) {
  if (
    elapsedState.sampleRecorded ||
    !metrics ||
    !Number.isFinite(metrics.waveCount) ||
    metrics.waveCount < 1
  ) {
    return;
  }

  const observedWaveMs = clamp(elapsedMs / metrics.waveCount, 30000, 180000);
  const previousWaveMs = readAverageWaveMs();
  const nextWaveMs = previousWaveMs
    ? previousWaveMs * 0.7 + observedWaveMs * 0.3
    : observedWaveMs;

  try {
    localStorage.setItem(AVG_WAVE_MS_STORAGE_KEY, String(Math.round(nextWaveMs)));
    elapsedState.sampleRecorded = true;
  } catch {
    // Estimate history is optional.
  }
}

function readAverageWaveMs() {
  try {
    const value = Number.parseInt(localStorage.getItem(AVG_WAVE_MS_STORAGE_KEY) || "", 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  if (minutes > 0) {
    return `${minutes}분 ${seconds}초`;
  }

  return `${seconds}초`;
}

function setBusy(isBusy) {
  translateButton.disabled = isBusy;
  restoreButton.disabled = isBusy;
}

function queryTabs(query) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(query, (tabs) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tabs);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response);
    });
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
