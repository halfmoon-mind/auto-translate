const NATIVE_HOST = "com.codex_context_translator.host";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CODEX_LOCAL_HEALTH") {
    handleHealth().then(sendResponse).catch((error) => {
      sendResponse(toErrorResponse(error));
    });
    return true;
  }

  if (message?.type === "CODEX_LOCAL_TRANSLATE") {
    handleTranslate(message.payload).then(sendResponse).catch((error) => {
      sendResponse(toErrorResponse(error));
    });
    return true;
  }

  return false;
});

async function handleHealth() {
  const data = await sendNativeHostMessage({ type: "health" });

  if (!data?.ok) {
    return {
      ...data,
      ok: false,
      error: data?.error || "로컬 브리지 연결 실패",
      setupCode: data?.setupCode || "native_host_unreachable",
      source: "native",
    };
  }

  return {
    ...data,
    source: "native",
  };
}

async function handleTranslate(payload) {
  const data = await sendNativeHostMessage({ type: "translate", payload });

  if (!data?.ok) {
    throw createSetupError(
      data?.error || "Native host translation failed.",
      data?.setupCode || "native_host_unreachable",
    );
  }

  return {
    ...data,
    source: "native",
  };
}

function sendNativeHostMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(createNativeHostError(error.message));
        return;
      }

      if (!response) {
        reject(new Error("Native host returned no response."));
        return;
      }

      resolve(response);
    });
  });
}

function createNativeHostError(message) {
  if (!message) {
    return createSetupError("로컬 브리지 연결에 실패했습니다.", "native_host_unreachable");
  }

  if (message.includes("Specified native messaging host not found")) {
    return createSetupError(
      "로컬 브리지가 설치되어 있지 않습니다. 설정 화면을 열어 companion installer를 실행하세요.",
      "native_host_missing",
    );
  }

  if (message.includes("Access to the specified native messaging host is forbidden")) {
    return createSetupError(
      "현재 Chrome 확장 ID가 로컬 브리지 허용 목록에 없습니다. companion installer를 다시 실행하세요.",
      "extension_not_allowed",
    );
  }

  if (
    message.includes("Native host has exited") ||
    message.includes("Error when communicating with the native messaging host")
  ) {
    return createSetupError(
      "로컬 브리지를 시작하지 못했습니다. Node.js 설치 상태를 확인한 뒤 companion installer를 다시 실행하세요.",
      "native_host_unreachable",
    );
  }

  return createSetupError(message, "native_host_unreachable");
}

function createSetupError(message, setupCode) {
  const error = new Error(message);
  error.setupCode = setupCode;
  return error;
}

function toErrorResponse(error) {
  return {
    ok: false,
    error: getErrorMessage(error),
    setupCode: error?.setupCode || "native_host_unreachable",
  };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
