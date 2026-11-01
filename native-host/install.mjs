import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.ccr.launcher";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EXTENSION_DIR = path.join(ROOT, "extension");
const INSTALL_DIR = path.join(os.homedir(), ".ccr-launcher");

const BROWSER_HOST_DIRS = [
  "Library/Application Support/Google/Chrome/NativeMessagingHosts",
  "Library/Application Support/Google/Chrome Beta/NativeMessagingHosts",
  "Library/Application Support/Google/Chrome Canary/NativeMessagingHosts",
  "Library/Application Support/Chromium/NativeMessagingHosts",
  "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
  "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
  "Library/Application Support/Vivaldi/NativeMessagingHosts",
  "Library/Application Support/Arc/User Data/NativeMessagingHosts",
];

const uninstall = process.argv.includes("--uninstall");

function extensionId() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
  if (!manifest.key) {
    throw new Error("extension/manifest.json has no key, so the extension id would not be stable.");
  }
  const der = Buffer.from(manifest.key, "base64");
  const hex = crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
  const alphabet = "abcdefghijklmnop";
  return [...hex].map((ch) => alphabet[parseInt(ch, 16)]).join("");
}

function isExecutableFile(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findCcr() {
  const home = os.homedir();
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const candidates = [];

  if (process.env.CCR_PATH) candidates.push(process.env.CCR_PATH);
  for (const dir of pathDirs) candidates.push(path.join(dir, "ccr"));
  candidates.push("/opt/homebrew/bin/ccr", "/usr/local/bin/ccr", path.join(home, ".local/bin/ccr"));

  const nvmRoot = path.join(home, ".nvm/versions/node");
  if (fs.existsSync(nvmRoot)) {
    const versions = fs
      .readdirSync(nvmRoot)
      .sort()
      .reverse();
    for (const version of versions) candidates.push(path.join(nvmRoot, version, "bin/ccr"));
  }

  for (const candidate of candidates) {
    if (candidate && isExecutableFile(candidate)) return fs.realpathSync(candidate);
  }
  return null;
}

function removeIfExists(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function removeHostManifests() {
  let removed = 0;
  for (const relative of BROWSER_HOST_DIRS) {
    const file = path.join(os.homedir(), relative, `${HOST_NAME}.json`);
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      removed += 1;
    }
  }
  return removed;
}

function installHost(id, ccrPath) {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  const source = fs.readFileSync(path.join(HERE, "ccr-host.js"), "utf8");
  const body = source.replace(/^#!.*\n/, "");
  const hostPath = path.join(INSTALL_DIR, "ccr-host.js");
  fs.writeFileSync(hostPath, `#!${process.execPath}\n${body}`, "utf8");
  fs.chmodSync(hostPath, 0o755);

  fs.writeFileSync(
    path.join(INSTALL_DIR, "config.json"),
    JSON.stringify(
      {
        ccrPath,
        nodePath: process.execPath,
        extensionId: id,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const manifest = {
    name: HOST_NAME,
    description: "Starts the claude-code-router service for the CCR Launcher extension.",
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`],
  };

  const written = [];
  for (const relative of BROWSER_HOST_DIRS) {
    const dir = path.join(os.homedir(), relative);
    if (!fs.existsSync(dir)) continue;
    const target = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
    written.push(target);
  }

  return { hostPath, written };
}

function main() {
  const id = extensionId();

  if (uninstall) {
    removeHostManifests();
    removeIfExists(INSTALL_DIR);
    console.log(`Removed native host ${HOST_NAME}.`);
    console.log(`Extension files left in place: ${EXTENSION_DIR}`);
    return;
  }

  const ccrPath = findCcr();
  if (!ccrPath) {
    console.error("Could not find the ccr binary. Set CCR_PATH=/path/to/ccr and run again.");
    process.exitCode = 1;
    return;
  }

  const { hostPath, written } = installHost(id, ccrPath);

  console.log("CCR Launcher installed.");
  console.log("");
  console.log(`  extension id  ${id}`);
  console.log(`  ccr           ${ccrPath}`);
  console.log(`  node          ${process.execPath}`);
  console.log(`  native host   ${hostPath}`);

  if (written.length === 0) {
    console.warn("");
    console.warn("No Chrome-family profile folder found. Open the browser once, then run this again.");
  } else {
    console.log("");
    for (const target of written) console.log(`  registered    ${target}`);
  }

  console.log("");
  console.log("Next:");
  console.log("  1. chrome://extensions -> enable Developer mode -> Load unpacked");
  console.log(`  2. pick ${EXTENSION_DIR}`);
  console.log("  3. click the CCR icon in the toolbar");
}

main();
