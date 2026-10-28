# Desktop shell (Electron)

This folder wraps the existing Vite web app as a desktop application.
**No product features are changed** — the same `dist/` (or Vite dev server) is loaded inside Electron.

## Requirements

- Node.js 18+
- On first setup: `npm install` (pulls `electron` and `electron-builder`)

## Development

```bash
npm run dev:desktop
```

Starts Vite on port 5180, then launches Electron pointed at that server.
Hot reload works through Vite. Quit Electron (or Ctrl+C) to stop both.

## Production installer (Windows NSIS)

```bash
npm run build:desktop
```

1. Runs `vite build` → `dist/`
2. Packages with electron-builder → Windows NSIS installer under `release/`

Artifact name: `Yumerise-Setup-0.1.0.exe` (version from package.json).

### Other platforms

```bash
# macOS (on a Mac)
npx electron-builder --mac dmg

# Linux
npx electron-builder --linux AppImage deb

# Directory unpack (no installer) for smoke-testing
npm run build:desktop:dir
```

## Security

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- External links open in the system browser
- Single-instance lock

## Optional bridge

`window.yumeriseDesktop` is exposed via preload when running in Electron.
The web code does not require it; the native bridge (`src/native/bridge.js`) uses it for system notifications when present. All other features (IndexedDB, downloads, file input, theme) work through Chromium APIs identically to the browser.
