const translateButton = document.getElementById("translateButton");
const restoreButton = document.getElementById("restoreButton");
const statusText = document.getElementById("statusText");
const serverStatus = document.getElementById("serverStatus");
const elapsedText = document.getElementById("elapsedText");

const AVG_WAVE_MS_STORAGE_KEY = "codexTranslatorAvgWaveMs.v2";
const FALLBACK_WAVE_MS_MIN = 20000;
const FALLBACK_WAVE_MS_MAX = 60000;
const OBSERVED_WAVE_MS_MIN = 10000;
const OBSERVED_WAVE_MS_MAX = 120000;

let hasRenderedStatus = false;
let activeTabId = null;

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

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "CODEX_TRANSLATION_STATUS") {
      if (!shouldRenderStatusFromSender(sender)) {
        return;
      }

      renderStatus(message.status);
    }
  });

  restoreLastStatus();
  checkServerHealth();
}

async function restoreLastStatus() {
  try {
    const [tab] = await queryTabs({ active: true, currentWindow: true });

    if (!tab?.id) {
      return;
    }

    activeTabId = tab.id;
    await ensureContentScript(tab.id);
    const response = await sendTabMessage(tab.id, { type: "CODEX_GET_TRANSLATION_STATUS" });

    if (response?.ok && response.status) {
      renderStatus(response.status);
    }
  } catch {
    // Some pages cannot run content scripts; the popup can still show bridge health.
  }
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
    if (!hasRenderedStatus) {
      statusText.textContent = getErrorMessage(error);
    }
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

    activeTabId = tab.id;
    await ensureContentScript(tab.id);
    const response = await sendTabMessage(tab.id, { type, options });

    if (!response?.ok) {
      throw new Error(response?.error || "작업에 실패했습니다.");
    }

    if (type === "CODEX_RESTORE_PAGE") {
      clearElapsedTimer("경과 시간 대기");
      statusText.textContent = `${response.restored || 0}개 단락을 복원했습니다.`;
    } else if (type === "CODEX_TRANSLATE_PAGE") {
      finishElapsedTimer(response.elapsedMs, response.metrics, "소요", response.usage);
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

function shouldRenderStatusFromSender(sender) {
  const senderTabId = sender?.tab?.id;
  return !Number.isFinite(senderTabId) || activeTabId === null || senderTabId === activeTabId;
}

function renderStatus(status) {
  if (!status?.message) {
    return;
  }

  hasRenderedStatus = true;
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
    finishElapsedTimer(status.elapsedMs, status.metrics, "소요", status.usage);
    return;
  }

  if (status.phase === "failed") {
    finishElapsedTimer(status.elapsedMs, status.metrics, "실패", status.usage);
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

function finishElapsedTimer(elapsedMs, metrics, label = "소요", usage = null) {
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
    usage: usage || elapsedState.lastStatus?.usage,
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

  const usage = formatUsage(status.usage);
  if (usage) {
    parts.push(usage);
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
  const priorityBatchCount = Number.isFinite(metrics.priorityBatchCount)
    ? metrics.priorityBatchCount
    : 0;

  return priorityBatchCount > 0
    ? `배치 ${metrics.batchCount}개 / 우선 ${priorityBatchCount}개 / 동시 ${parallelRuns}개`
    : `배치 ${metrics.batchCount}개 / 동시 ${parallelRuns}개`;
}

function formatUsage(usage) {
  const normalizedUsage = normalizeUsage(usage);
  if (!normalizedUsage) {
    return "";
  }

  const label = normalizedUsage.estimated ? "추정" : "사용";
  const cost = formatCost(normalizedUsage.costUsd);
  return cost
    ? `${label} ${formatTokenCount(normalizedUsage.totalTokens)}토큰 / API 환산 약 ${cost}`
    : `${label} ${formatTokenCount(normalizedUsage.totalTokens)}토큰`;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens = readTokenCount(usage.inputTokens);
  const outputTokens = readTokenCount(usage.outputTokens);
  const totalTokens = readTokenCount(usage.totalTokens) || inputTokens + outputTokens;

  if (!totalTokens) {
    return null;
  }

  return {
    totalTokens,
    costUsd: readOptionalNumber(usage.costUsd),
    estimated: usage.estimated !== false,
  };
}

function readTokenCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function readOptionalNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatCost(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(2)}`;
}

function formatTokenCount(value) {
  const rounded = Math.max(1, Math.round(value));

  if (rounded >= 1000000) {
    return `${trimTrailingZero((rounded / 1000000).toFixed(1))}M`;
  }

  if (rounded >= 1000) {
    return `${trimTrailingZero((rounded / 1000).toFixed(1))}k`;
  }

  return rounded.toLocaleString("ko-KR");
}

function trimTrailingZero(value) {
  return value.replace(/\.0$/, "");
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

  const observedWaveMs = clamp(
    elapsedMs / metrics.waveCount,
    OBSERVED_WAVE_MS_MIN,
    OBSERVED_WAVE_MS_MAX,
  );
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
