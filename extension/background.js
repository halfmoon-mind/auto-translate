const NATIVE_HOST = "com.codex_context_translator.host";
const NATIVE_SESSION_IDLE_TIMEOUT_MS = 30000;

const nativeSessions = new Map();
let nextNativeRequestId = 1;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CODEX_LOCAL_HEALTH") {
    handleHealth().then(sendResponse).catch((error) => {
      sendResponse(toErrorResponse(error));
    });
    return true;
  }

  if (message?.type === "CODEX_LOCAL_TRANSLATION_SESSION_START") {
    handleTranslationSessionStart().then(sendResponse).catch((error) => {
      sendResponse(toErrorResponse(error));
    });
    return true;
  }

  if (message?.type === "CODEX_LOCAL_TRANSLATION_SESSION_END") {
    handleTranslationSessionEnd(message.sessionId).then(sendResponse).catch((error) => {
      sendResponse(toErrorResponse(error));
    });
    return true;
  }

  if (message?.type === "CODEX_LOCAL_TRANSLATE") {
    handleTranslate(message.payload, message.sessionId).then(sendResponse).catch((error) => {
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

async function handleTranslationSessionStart() {
  const session = openNativeSession();

  try {
    const data = await sendNativeSessionMessage(session, { type: "health" });

    if (!data?.ok) {
      throw createSetupError(
        data?.error || "로컬 브리지 연결 실패",
        data?.setupCode || "native_host_unreachable",
      );
    }

    return {
      ...data,
      ok: true,
      sessionId: session.id,
      source: "native",
    };
  } catch (error) {
    closeNativeSession(session, getErrorMessage(error));
    throw error;
  }
}

async function handleTranslationSessionEnd(sessionId) {
  const session = getNativeSession(sessionId);

  if (session) {
    closeNativeSession(session);
  }

  return { ok: true };
}

async function handleTranslate(payload, sessionId) {
  if (sessionId) {
    const session = getNativeSession(sessionId);

    if (!session) {
      throw createSetupError("번역 세션이 종료되었습니다. 다시 시도하세요.", "native_host_unreachable");
    }

    const data = await sendNativeSessionMessage(session, { type: "translate", payload });

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

function openNativeSession() {
  const session = {
    id: createSessionId(),
    port: chrome.runtime.connectNative(NATIVE_HOST),
    pending: new Map(),
    idleTimer: null,
    closed: false,
  };

  session.port.onMessage.addListener((message) => {
    handleNativeSessionMessage(session, message);
  });
  session.port.onDisconnect.addListener(() => {
    handleNativeSessionDisconnect(session);
  });

  nativeSessions.set(session.id, session);
  return session;
}

function getNativeSession(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) {
    return null;
  }

  return nativeSessions.get(sessionId) || null;
}

function closeNativeSession(session, reason) {
  if (session.closed) {
    return;
  }

  session.closed = true;
  nativeSessions.delete(session.id);
  clearNativeSessionIdleTimer(session);

  const error = reason
    ? createNativeHostError(reason)
    : createSetupError("번역 세션이 종료되었습니다.", "native_host_unreachable");

  for (const pending of session.pending.values()) {
    pending.reject(error);
  }
  session.pending.clear();

  try {
    session.port.disconnect();
  } catch {
    // The port may already be disconnected.
  }
}

function sendNativeSessionMessage(session, message) {
  return new Promise((resolve, reject) => {
    if (session.closed) {
      reject(createSetupError("번역 세션이 종료되었습니다. 다시 시도하세요.", "native_host_unreachable"));
      return;
    }

    const requestId = String(nextNativeRequestId);
    nextNativeRequestId += 1;

    session.pending.set(requestId, { resolve, reject });
    clearNativeSessionIdleTimer(session);

    try {
      session.port.postMessage({
        ...message,
        requestId,
      });
    } catch (error) {
      session.pending.delete(requestId);
      reject(createNativeHostError(getErrorMessage(error)));
    }
  });
}

function handleNativeSessionMessage(session, message) {
  const requestId = typeof message?.requestId === "string" ? message.requestId : "";
  const pending = session.pending.get(requestId);

  if (!pending) {
    return;
  }

  session.pending.delete(requestId);
  pending.resolve(message);
  scheduleNativeSessionIdleClose(session);
}

function handleNativeSessionDisconnect(session) {
  if (session.closed) {
    return;
  }

  const message = chrome.runtime.lastError?.message || "Native host session disconnected.";
  closeNativeSession(session, message);
}

function createSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function scheduleNativeSessionIdleClose(session) {
  clearNativeSessionIdleTimer(session);

  if (session.closed || session.pending.size > 0) {
    return;
  }

  session.idleTimer = setTimeout(() => {
    if (!session.closed && session.pending.size === 0) {
      closeNativeSession(session);
    }
  }, NATIVE_SESSION_IDLE_TIMEOUT_MS);
}

function clearNativeSessionIdleTimer(session) {
  if (!session.idleTimer) {
    return;
  }

  clearTimeout(session.idleTimer);
  session.idleTimer = null;
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
