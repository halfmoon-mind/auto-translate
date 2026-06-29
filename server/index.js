const http = require("node:http");
const { getBridgeInfo, translatePayload } = require("./translator");

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.CODEX_TRANSLATOR_PORT || "17387", 10);
const MAX_BODY_BYTES = Number.parseInt(
  process.env.CODEX_TRANSLATOR_MAX_BODY_BYTES || String(8 * 1024 * 1024),
  10,
);

const server = http.createServer(async (req, res) => {
  try {
    if (!isAllowedRequestOrigin(req)) {
      sendJson(req, res, 403, { error: "Forbidden origin." });
      return;
    }

    if (req.method === "OPTIONS") {
      sendOptions(req, res);
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(req, res, 200, getBridgeInfo());
      return;
    }

    if (req.method === "POST" && req.url === "/translate") {
      const payload = await readJsonBody(req);
      const result = await translatePayload(payload);

      sendJson(req, res, 200, {
        ok: true,
        translations: result.translations,
        runs: result.runs,
      });
      return;
    }

    sendJson(req, res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(req, res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.on("error", (error) => {
  console.error(`Failed to start Codex translator bridge: ${error.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Codex translator bridge listening on http://${HOST}:${PORT}`);
});

function isAllowedRequestOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }
  return origin.startsWith("chrome-extension://");
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && origin.startsWith("chrome-extension://")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendOptions(req, res) {
  setCorsHeaders(req, res);
  res.writeHead(204);
  res.end();
}

function sendJson(req, res, status, data) {
  setCorsHeaders(req, res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request body is too large. Limit is ${MAX_BODY_BYTES} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}
