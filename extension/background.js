const NATIVE_HOST = "com.ccr.launcher";
const HOST_TIMEOUT_MS = 60000;
const READY_TIMEOUT_MS = 8000;
const READY_POLL_MS = 500;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, code: "host_timeout", message }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function ensureService() {
  try {
    const res = await withTimeout(
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "ensure" }),
      HOST_TIMEOUT_MS,
      "The native helper did not answer in time.",
    );
    if (!res || typeof res !== "object") {
      return { ok: false, code: "bad_host_reply", message: "Native host returned nothing." };
    }
    return res;
  } catch (error) {
    return {
      ok: false,
      code: "host_missing",
      message: String(error?.message ?? error),
    };
  }
}

async function waitForServer(url, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: "GET", cache: "no-store", redirect: "follow" });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
  }
  return false;
}

async function openOrFocus(url) {
  const origin = new URL(url).origin;
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url && tab.url.startsWith(origin + "/"));

  if (existing) {
    await chrome.tabs.update(existing.id, { url, active: true });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return "focused";
  }

  await chrome.tabs.create({ url });
  return "opened";
}

async function bringUpCcr() {
  const state = await ensureService();
  if (!state.ok || !state.url) {
    return state;
  }

  const ready = await waitForServer(state.url);
  if (!ready) {
    return {
      ok: false,
      code: "not_ready",
      message: "CCR started but the UI did not answer yet.",
      url: state.url,
    };
  }

  const action = await openOrFocus(state.url);
  return { ok: true, url: state.url, action };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "open") {
    bringUpCcr().then(sendResponse, (error) =>
      sendResponse({ ok: false, code: "unexpected", message: String(error?.message ?? error) }),
    );
    return true;
  }
  return false;
});
