const LOCAL_SERVER = "http://127.0.0.1:17387";

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
  const response = await fetch(`${LOCAL_SERVER}/health`);
  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(data?.error || `Local server responded with ${response.status}.`);
  }

  return {
    ...data,
    source: "local",
  };
}

async function handleTranslate(payload) {
  const response = await fetch(`${LOCAL_SERVER}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Local server responded with ${response.status}.`);
  }

  return {
    ...data,
    source: "local",
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
