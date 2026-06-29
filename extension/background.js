const NATIVE_HOST = "com.codex_context_translator.host";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CODEX_LOCAL_HEALTH") {
    handleHealth().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: getErrorMessage(error) });
    });
    return true;
  }

  if (message?.type === "CODEX_LOCAL_TRANSLATE") {
    handleTranslate(message.payload).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: getErrorMessage(error) });
    });
    return true;
  }

  return false;
});

async function handleHealth() {
  const data = await sendNativeHostMessage({ type: "health" });

  if (!data?.ok) {
    throw new Error(data?.error || "Native host health check failed.");
  }

  return {
    ...data,
    source: "native",
  };
}

async function handleTranslate(payload) {
  const data = await sendNativeHostMessage({ type: "translate", payload });

  if (!data?.ok) {
    throw new Error(data?.error || "Native host translation failed.");
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
        reject(new Error(formatNativeHostError(error.message)));
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

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatNativeHostError(message) {
  if (!message) {
    return "Native host connection failed.";
  }

  if (message.includes("Specified native messaging host not found")) {
    return "Native Messaging host가 설치되어 있지 않습니다. companion/macos/Codex Translator Installer.app을 실행하세요.";
  }

  return message;
}
