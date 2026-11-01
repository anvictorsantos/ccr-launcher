"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const CONFIG_PATH = path.join(__dirname, "config.json");
const LOG_PATH = path.join(__dirname, "host.log");
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;
// ccr ui gives the service 30s to report ready, so keep headroom above that.
const START_TIMEOUT_MS = 45_000;
const MAX_LOG_BYTES = 512 * 1024;

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(" ")}\n`;
  try {
    if (fs.statSync(LOG_PATH).size > MAX_LOG_BYTES) fs.truncateSync(LOG_PATH, 0);
  } catch {}
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
}

function redact(url) {
  return url.replace(/([?&][^=&#]+=)[^&#]*/g, "$1…");
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function runCcr(config) {
  return new Promise((resolve) => {
    const nodePath = config.nodePath || process.execPath;
    const ccrPath = config.ccrPath;

    if (!ccrPath || !fs.existsSync(ccrPath)) {
      log("ensure: ccr path missing", ccrPath ?? "(unset)");
      resolve({ ok: false, code: "ccr_missing", message: "ccr binary not found. Re-run install.mjs." });
      return;
    }

    const env = {
      ...process.env,
      HOME: os.homedir(),
      PATH: [
        path.dirname(nodePath),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ].join(":"),
    };

    const startedAt = Date.now();
    log("ensure: running ccr ui");

    execFile(
      nodePath,
      [ccrPath, "ui", "--no-open"],
      { env, timeout: START_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout || ""}\n${stderr || ""}`.trim();
        const matches = output.match(URL_PATTERN);
        const url = matches ? matches[matches.length - 1].replace(/[.,;)]+$/, "") : null;

        log(`ensure: ccr ui exited in ${Date.now() - startedAt}ms`, error ? String(error.code ?? error.message) : "");

        if (url) {
          log("ensure: url", redact(url));
          resolve({ ok: true, url, output });
          return;
        }

        const message = error?.killed
          ? `ccr ui did not answer within ${Math.round(START_TIMEOUT_MS / 1000)}s.`
          : output || String(error?.message || "ccr ui printed no URL");
        log("ensure: failed", message.slice(0, 500));
        resolve({
          ok: false,
          code: error?.killed ? "start_timeout" : error ? "start_failed" : "no_url",
          message: message.slice(0, 2000),
        });
      },
    );
  });
}

async function handle(message) {
  if (message?.type === "ping") {
    return { ok: true, pong: true };
  }
  if (message?.type === "ensure") {
    return runCcr(loadConfig());
  }
  return { ok: false, code: "unknown_message", message: "Unknown message type." };
}

function writeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  log("send", payload.ok ? "ok" : `error ${payload.code ?? "unknown"}`);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}

// Chrome does not close stdin after sendNativeMessage, so dispatch on complete frames as they arrive.
let buffered = Buffer.alloc(0);
let queue = Promise.resolve();

function dispatch(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    log("recv: malformed frame");
    writeMessage({ ok: false, code: "bad_message", message: "Malformed native message." });
    return;
  }
  log("recv", message?.type ?? "(untyped)");
  queue = queue.then(async () => writeMessage(await handle(message)));
}

function onData(chunk) {
  buffered = Buffer.concat([buffered, chunk]);
  while (buffered.length >= 4) {
    const length = buffered.readUInt32LE(0);
    if (buffered.length < length + 4) return;
    const text = buffered.subarray(4, length + 4).toString("utf8");
    buffered = buffered.subarray(length + 4);
    dispatch(text);
  }
}

process.stdin.on("data", onData);
process.stdin.on("error", (error) => log("stdin error", String(error?.message ?? error)));
process.stdin.on("end", () => log("stdin closed", buffered.length ? `${buffered.length} trailing bytes` : "with no pending frame"));
