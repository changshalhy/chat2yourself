# Desktop Packaging

V5 added a Tauri desktop shell around the existing Vite app. V5.2 added
versioned JSON backup and restore. V5.3 added full-text library search. V5.4
added the local review center. V5.5 added review date ranges and Markdown
review exports.

V0.6 is the first Windows desktop-ready pass: production desktop builds call the
model through Tauri commands and store model configuration in a local user
config file instead of requiring a separate Express process.

## Current Shape

- `npm run dev` runs the Web development mode: local Express API plus Vite.
- `npm run desktop:dev` starts Tauri and uses the Vite dev URL.
- `npm run desktop:build` asks Tauri to build a Windows desktop bundle from
  `dist`.
- `npm run desktop:preflight` checks whether the local machine has the needed
  desktop toolchain.
- Desktop mode saves model config to `%APPDATA%\Chat2Yourself\config.json` on
  Windows.
- Desktop mode never writes API keys into `localStorage`; only the Tauri backend
  reads and writes the config file.
- Web development mode still reads `DEEPSEEK_API_KEY`,
  `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL` from `.env`.

## Requirements

Install the Windows prerequisites from the official Tauri docs before expecting
a real `.exe` build:

- Microsoft C++ Build Tools
- WebView2
- Rust and Cargo through rustup

## API Key

Do not bake a shared DeepSeek key into the desktop app. Users should enter their
own API key in the desktop configuration screen. The saved config file contains
the key and should not be shared.

## Build Verification

Run these before publishing a release:

```powershell
npm run build
npm run desktop:preflight
npm run desktop:build
```

`npm run build` verifies TypeScript and the Vite production build. The desktop
build additionally verifies the Rust/Tauri runtime and creates the Windows
bundle when the local toolchain is complete.
