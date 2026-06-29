#!/usr/bin/env node

const { getBridgeInfo, translatePayload } = require("../server/translator");

let buffer = Buffer.alloc(0);
let handled = false;

process.stdin.on("data", (chunk) => {
  if (handled) {
    return;
  }

  buffer = Buffer.concat([buffer, chunk]);
  readMessage();
});

process.stdin.on("error", (error) => {
  writeError(error);
});

function readMessage() {
  if (buffer.length < 4) {
    return;
  }

  const messageLength = buffer.readUInt32LE(0);
  const frameLength = 4 + messageLength;

  if (buffer.length < frameLength) {
    return;
  }

  handled = true;

  const rawMessage = buffer.subarray(4, frameLength).toString("utf8");
  let message;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    writeError(new Error("Native host message must be valid JSON."));
    return;
  }

  handleMessage(message)
    .then(writeMessage)
    .catch(writeError);
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
      source: "native",
    };
  }

  return {
    ok: false,
    error: "Unknown native host message type.",
  };
}

function writeError(error) {
  writeMessage({
    ok: false,
    error: getErrorMessage(error),
  });
}

function writeMessage(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]), () => {
    process.exit(0);
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
