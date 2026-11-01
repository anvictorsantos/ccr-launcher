const INSTALL_CMD = 'node "/Users/antonio.pontes/Projects/personal/ccr-launcher/native-host/install.mjs"';
const START_TIMEOUT_MS = 75000;

const els = {
  state: document.getElementById("state"),
  message: document.getElementById("message"),
  error: document.getElementById("error"),
  errorMessage: document.getElementById("errorMessage"),
  installCmd: document.getElementById("installCmd"),
  copyBtn: document.getElementById("copyBtn"),
  retryBtn: document.getElementById("retryBtn"),
  openLink: document.getElementById("openLink"),
};

function setBusy(text) {
  els.state.className = "state";
  els.state.hidden = false;
  els.error.hidden = true;
  els.message.textContent = text;
}

function setDone(text) {
  els.state.className = "state done";
  els.state.hidden = false;
  els.error.hidden = true;
  els.message.textContent = text;
}

function setFailed(result) {
  els.state.className = "state fail";
  els.state.hidden = false;
  els.message.textContent = "Could not start CCR";

  const missing = result.code === "host_missing";
  els.errorMessage.textContent = missing
    ? "Chrome cannot start programs on its own. A small helper does it."
    : result.message || "Something went wrong.";

  document.querySelector(".hint").hidden = !missing;
  document.querySelector(".cmd").hidden = !missing;

  if (result.url) {
    els.openLink.href = result.url;
    els.openLink.hidden = false;
  } else {
    els.openLink.hidden = true;
  }

  els.error.hidden = false;
}

async function requestOpen() {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, code: "timeout", message: "CCR did not answer in time. See ~/.ccr-launcher/host.log." }),
      START_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([chrome.runtime.sendMessage({ type: "open" }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  setBusy("Waking CCR…");
  let result;
  try {
    result = await requestOpen();
  } catch (error) {
    result = { ok: false, code: "no_worker", message: String(error?.message ?? error) };
  }

  if (result?.ok) {
    setDone(result.action === "focused" ? "CCR UI focused" : "CCR UI opened");
    setTimeout(() => window.close(), 700);
    return;
  }

  setFailed(result ?? { ok: false, message: "No reply from background worker." });
}

els.installCmd.textContent = INSTALL_CMD;
els.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(INSTALL_CMD);
    els.copyBtn.textContent = "Copied";
    setTimeout(() => (els.copyBtn.textContent = "Copy"), 1200);
  } catch {
    els.copyBtn.textContent = "Select it";
  }
});
els.retryBtn.addEventListener("click", run);

run();
