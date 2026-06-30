#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT_DIR = path.join(__dirname, "..");
const HOST_PATH = path.join(ROOT_DIR, "native-host", "codex-context-translator-host.js");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const fakeCodex = createFakeCodex();

  try {
    await testHealthAndTranslate(fakeCodex.path);
  } finally {
    fs.rmSync(fakeCodex.dir, { recursive: true, force: true });
  }
}

async function testHealthAndTranslate(fakeCodexPath) {
  const responses = await sendNativeMessages([
    { type: "health", requestId: "one" },
    {
      type: "translate",
      requestId: "two",
      payload: {
        page: {
          title: "Test page",
          url: "https://example.test/",
          language: "en",
          description: "",
        },
        context: ["Title: Test page"],
        batch: {
          index: 1,
          total: 1,
        },
        paragraphs: [
          {
            id: "p1",
            kind: "paragraph",
            text: "Hello world.",
          },
        ],
      },
    },
  ], {
    CODEX_TRANSLATOR_CODEX_BIN: fakeCodexPath,
  });

  assert.equal(responses.length, 2);
  assert.deepEqual(responses.map((response) => response.requestId).sort(), ["one", "two"]);

  const health = responses.find((response) => response.requestId === "one");
  const translate = responses.find((response) => response.requestId === "two");

  assert.equal(health.ok, true);
  assert.equal(health.source, "native");
  assert.equal(health.pricing.model, "gpt-5.4-mini");
  assert.equal(typeof health.pricing.inputUsdPerMillion, "number");
  assert.equal(typeof health.pricing.outputUsdPerMillion, "number");
  assert.equal(translate.ok, true);
  assert.equal(translate.source, "native");
  assert.deepEqual(translate.translations, [{ id: "p1", text: "ko:Hello world." }]);
  assert.equal(typeof translate.usage.inputTokens, "number");
  assert.equal(typeof translate.usage.outputTokens, "number");
  assert.equal(translate.usage.costBasis.source, "https://developers.openai.com/api/docs/pricing");
  assert.equal(translate.timings.mode, "one_shot");
  assert.equal(translate.timings.serverBatchCount, 1);
  assert.equal(typeof translate.timings.threadStartMs, "number");
  assert.equal(typeof translate.timings.turnWaitMs, "number");
}

function sendNativeMessages(messages, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST_PATH], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const responses = [];
    let stdout = Buffer.alloc(0);
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      settle(reject, new Error("Native host session test timed out."));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      readResponses();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      settle(reject, error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      readResponses();

      if (code !== 0) {
        settle(
          reject,
          new Error(`Native host exited with code ${code}.${stderr ? ` stderr: ${stderr}` : ""}`),
        );
        return;
      }

      if (stdout.length > 0) {
        settle(reject, new Error("Native host left an incomplete response frame."));
        return;
      }

      settle(resolve, responses);
    });

    child.stdin.end(Buffer.concat(messages.map(encodeNativeMessage)));

    function readResponses() {
      while (stdout.length >= 4) {
        const messageLength = stdout.readUInt32LE(0);
        const frameLength = 4 + messageLength;

        if (stdout.length < frameLength) {
          return;
        }

        const rawMessage = stdout.subarray(4, frameLength).toString("utf8");
        stdout = stdout.subarray(frameLength);
        responses.push(JSON.parse(rawMessage));
      }
    }

    function settle(callback, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      callback(value);
    }
  });
}

function createFakeCodex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-native-host-test-"));
  const scriptPath = path.join(dir, "fake-codex.js");
  const script = `#!/usr/bin/env node

const readline = require("node:readline");

let nextThreadId = 1;
let nextTurnId = 1;

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  const message = JSON.parse(line);

  if (message.method === "initialize") {
    send({ id: message.id, result: {} });
    return;
  }

  if (message.method === "initialized") {
    return;
  }

  if (message.method === "thread/start") {
    send({
      id: message.id,
      result: {
        thread: {
          id: "thread-" + nextThreadId,
        },
      },
    });
    nextThreadId += 1;
    return;
  }

  if (message.method === "turn/start") {
    const turnId = "turn-" + nextTurnId;
    nextTurnId += 1;
    send({
      id: message.id,
      result: {
        turn: {
          id: turnId,
        },
      },
    });

    const prompt = message.params.input[0].text;
    const marker = "Input JSON:\\n";
    const markerIndex = prompt.lastIndexOf(marker);

    if (markerIndex < 0) {
      send({
        method: "turn/completed",
        params: {
          turn: {
            id: turnId,
            status: "failed",
            error: {
              message: "Missing Input JSON marker.",
            },
          },
        },
      });
      return;
    }

    const parsed = JSON.parse(prompt.slice(markerIndex + marker.length));
    const text = JSON.stringify({
      translations: parsed.targets.map((target) => ({
        id: target.id,
        text: "ko:" + target.text,
      })),
    });
    const item = {
      type: "agentMessage",
      phase: "final",
      text,
    };

    send({
      method: "item/completed",
      params: {
        turnId,
        item,
      },
    });
    send({
      method: "turn/completed",
      params: {
        turn: {
          id: turnId,
          status: "completed",
          items: [item],
        },
      },
    });
    return;
  }

  send({
    id: message.id,
    error: {
      message: "Unsupported fake codex method.",
    },
  });
});

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  return {
    dir,
    path: scriptPath,
  };
}

function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}
