<p align="center">
  <img src="assets/icon.png" width="140" alt="CCR Launcher icon">
</p>

<h1 align="center">CCR Launcher</h1>

<p align="center">
  A Chrome extension that opens the <strong>claude-code-router</strong> UI — and starts the
  service first if it is not running.
</p>

## Why a native helper

Chrome extensions cannot start local programs. A tiny native messaging host (`com.ccr.launcher`) runs `ccr ui --no-open`, reads the URL it prints, and hands it back to the extension. The extension then focuses an existing CCR tab or opens a new one.

```
click icon → popup → background.js → native host → ccr ui --no-open → URL → tab
```

## Install

```bash
node native-host/install.mjs
```

Then in Chrome:

1. open `chrome://extensions`
2. enable **Developer mode**
3. **Load unpacked** → pick `extension/`
4. click the CCR icon in the toolbar

The extension id is fixed by the `key` in `extension/manifest.json` (`ephcihlmadjpjmfnompdgefkgidhggfj`), so the native host keeps working after reloads.

Repeat step 1–4 in Brave, Edge or Chromium if you want it there too — `install.mjs` registers every Chrome-family profile folder it finds.

## What install writes

| Path | What |
| --- | --- |
| `~/.ccr-launcher/ccr-host.js` | native host, shebang pinned to your current Node |
| `~/.ccr-launcher/config.json` | resolved `ccr` and `node` paths |
| `~/Library/Application Support/<Browser>/NativeMessagingHosts/com.ccr.launcher.json` | registration, allowed origin = this extension only |

Chrome started from Finder has a short `PATH`, so the host calls Node and `ccr` by absolute path. Re-run `install.mjs` after changing Node versions via nvm.

## Uninstall

```bash
node native-host/install.mjs --uninstall
```

Then remove the extension from `chrome://extensions`.

## Files

```
extension/            MV3 extension: manifest, service worker, popup
native-host/ccr-host.js    stdio host: starts ccr, parses its URL
native-host/install.mjs    copies the host, registers it per browser
tools/make-icons.mjs       regenerates the PNG icons
```

## Troubleshooting

- **"Native helper not installed"** — run `install.mjs`, reload the extension.
- **`ccr_missing`** — `ccr` not found. Set `CCR_PATH=/path/to/ccr node native-host/install.mjs`.
- **Started but no tab** — `ccr ui --no-open` printed no URL. Run it in a terminal to see why.
- **Anything else** — Chrome sends native host stderr to `/dev/null`, so the host keeps its own log at `~/.ccr-launcher/host.log` (rotated at 512 KB). Each line is timestamped: `recv`, `ensure`, `send`.
