#!/usr/bin/env node

const { getBridgeInfo, shutdownTranslator, translatePayload } = require("../server/translator");

let buffer = Buffer.alloc(0);
let activeMessages = 0;
let pendingWrites = 0;
let stdinEnded = false;
let exiting = false;

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  readMessages();
});

process.stdin.on("end", () => {
  stdinEnded = true;
  exitWhenIdle();
});

process.stdin.on("error", (error) => {
  writeError(error);
  stdinEnded = true;
  exitWhenIdle();
});

function readMessages() {
  while (buffer.length >= 4) {
    const messageLength = buffer.readUInt32LE(0);
    const frameLength = 4 + messageLength;

    if (buffer.length < frameLength) {
      return;
    }

    const rawMessage = buffer.subarray(4, frameLength).toString("utf8");
    buffer = buffer.subarray(frameLength);
    let message;

    try {
      message = JSON.parse(rawMessage);
    } catch {
      writeError(new Error("Native host message must be valid JSON."));
      continue;
    }

    activeMessages += 1;
    handleMessage(message)
      .then((response) => {
        writeMessage(withRequestId(response, message));
      })
      .catch((error) => {
        writeError(error, message);
      })
      .finally(() => {
        activeMessages -= 1;
        exitWhenIdle();
      });
  }
}

async function handleMessage(message) {
  if (message?.type === "health") {
    return {
      ...getBridgeInfo(),
      source: "native",
    };
  }

  if (message?.type === "translate") {
    const result = await translatePayload(message.payload);
    return {
      ok: true,
      translations: result.translations,
      runs: result.runs,
      usage: result.usage,
      timings: result.timings,
      source: "native",
    };
  }

  return {
    ok: false,
    error: "Unknown native host message type.",
  };
}

function writeError(error, requestMessage) {
  writeMessage(withRequestId({
    ok: false,
    error: getErrorMessage(error),
  }, requestMessage));
}

function writeMessage(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  pendingWrites += 1;
  process.stdout.write(Buffer.concat([header, payload]), () => {
    pendingWrites -= 1;
    exitWhenIdle();
  });
}

function withRequestId(response, requestMessage) {
  if (!requestMessage || requestMessage.requestId == null) {
    return response;
  }

  return {
    ...response,
    requestId: requestMessage.requestId,
  };
}

async function exitWhenIdle() {
  if (stdinEnded && activeMessages === 0 && pendingWrites === 0 && !exiting) {
    exiting = true;
    try {
      await shutdownTranslator();
    } finally {
      process.exit(0);
    }
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
