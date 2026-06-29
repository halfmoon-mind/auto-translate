const statusLabel = document.getElementById("statusLabel");
const statusTitle = document.getElementById("statusTitle");
const statusMessage = document.getElementById("statusMessage");
const retryButton = document.getElementById("retryButton");
const nextSteps = document.getElementById("nextSteps");
const extensionId = document.getElementById("extensionId");

const SETUP_COPY = {
  native_host_missing: {
    label: "설치 필요",
    title: "로컬 브리지가 아직 설치되지 않았습니다.",
    message: "macOS companion installer를 실행한 뒤 이 화면에서 다시 확인하세요.",
    steps: [
      "배포 폴더에서 companion/macos를 엽니다.",
      "Codex Translator Installer.app을 실행합니다.",
      "완료 dialog를 확인한 뒤 다시 확인을 누릅니다.",
    ],
  },
  native_host_unreachable: {
    label: "시작 실패",
    title: "로컬 브리지를 시작하지 못했습니다.",
    message: "Native Messaging 등록은 보이지만 host 실행이 실패했습니다.",
    steps: [
      "Node.js 18 이상이 설치되어 있는지 확인합니다.",
      "Codex Translator Installer.app을 다시 실행해 host 경로를 갱신합니다.",
      "Chrome 확장을 새로고침한 뒤 다시 확인을 누릅니다.",
    ],
  },
  extension_not_allowed: {
    label: "ID 불일치",
    title: "현재 확장 ID가 로컬 브리지 허용 목록에 없습니다.",
    message: "다른 extension ID로 설치된 manifest가 남아 있을 가능성이 큽니다.",
    steps: [
      "아래 현재 확장 ID를 확인합니다.",
      "CODEX_TRANSLATOR_EXTENSION_ID 값을 현재 ID로 지정해 installer를 다시 실행합니다.",
      "Chrome 확장을 새로고침한 뒤 다시 확인을 누릅니다.",
    ],
  },
  node_unsupported: {
    label: "Node.js 확인",
    title: "Node.js 버전이 낮습니다.",
    message: "로컬 브리지는 Node.js 18 이상이 필요합니다.",
    steps: [
      "Node.js 18 이상을 설치합니다.",
      "Codex Translator Installer.app을 다시 실행합니다.",
      "Chrome 확장을 새로고침한 뒤 다시 확인을 누릅니다.",
    ],
  },
  codex_missing: {
    label: "Codex 확인",
    title: "Codex CLI를 찾지 못했습니다.",
    message: "로컬 번역은 사용자의 Codex CLI ChatGPT 로그인을 사용합니다.",
    steps: [
      "Codex CLI를 설치합니다.",
      "터미널에서 codex login을 실행해 ChatGPT로 로그인합니다.",
      "Codex Translator Installer.app을 다시 실행한 뒤 다시 확인을 누릅니다.",
    ],
  },
};

init();

function init() {
  extensionId.textContent = chrome.runtime.id;
  retryButton.addEventListener("click", checkBridgeHealth);
  checkBridgeHealth();
}

async function checkBridgeHealth() {
  setChecking();

  try {
    const response = await sendRuntimeMessage({ type: "CODEX_LOCAL_HEALTH" });

    if (!response?.ok) {
      renderIssue(response);
      return;
    }

    renderReady(response);
  } catch (error) {
    renderIssue({
      setupCode: "native_host_unreachable",
      error: getErrorMessage(error),
    });
  }
}

function setChecking() {
  retryButton.disabled = true;
  statusLabel.textContent = "상태 확인 중";
  statusTitle.textContent = "로컬 브리지 확인 중";
  statusMessage.textContent = "Chrome Native Messaging 연결 상태를 확인하고 있습니다.";
  renderSteps(["잠시만 기다려 주세요."]);
}

function renderReady(response) {
  retryButton.disabled = false;
  statusLabel.textContent = "연결됨";
  statusTitle.textContent = "로컬 브리지가 준비되었습니다.";
  statusMessage.textContent = `모델 ${response.model} / reasoning ${response.effort} / Codex ${response.codex}`;
  renderSteps([
    "확장 팝업으로 돌아갑니다.",
    "번역할 페이지에서 페이지 번역을 누릅니다.",
    "번역 중 로그인 오류가 나오면 터미널에서 codex login을 실행합니다.",
  ]);
}

function renderIssue(response) {
  retryButton.disabled = false;
  const code = response?.setupCode || "native_host_unreachable";
  const copy = SETUP_COPY[code] || SETUP_COPY.native_host_unreachable;

  statusLabel.textContent = copy.label;
  statusTitle.textContent = copy.title;
  statusMessage.textContent = response?.error || copy.message;
  renderSteps(copy.steps);
}

function renderSteps(steps) {
  nextSteps.replaceChildren(
    ...steps.map((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      return item;
    }),
  );
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
