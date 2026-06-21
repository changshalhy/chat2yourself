# Desktop Packaging

V5 adds a Tauri desktop shell around the existing Vite app. V5.2 adds a
versioned JSON backup and restore flow for all browser-local sessions. V5.3
adds full-text session search, progress filters, and library sorting. V5.4 adds
a local review center for clarity trends, recurring themes, and tiny actions.
V5.5 adds review date ranges, a cross-session action queue, and Markdown review
exports.

## Current Shape

- `npm run dev` runs the existing local Express API and Vite web app.
- `npm run desktop:dev` starts Tauri and points the desktop window at the Vite dev URL.
- `npm run desktop:build` asks Tauri to build a Windows desktop bundle from `dist`.
- `npm run desktop:preflight` checks whether the local machine has the needed desktop toolchain.
- The sidebar can back up every local session and restore either a V5.2 backup
  or a JSON file exported from a single session.
- The local library can search titles, conversations, reports, and tiny actions,
  then filter by report, favorite, or pending-action state.
- The review center aggregates local sessions without sending summary data to a
  remote service.
- Review exports contain aggregate statistics, themes, actions, and session
  metadata, but omit full conversation transcripts.

## Requirements

Install the Windows prerequisites from the official Tauri docs before expecting a real `.exe` build:

- Microsoft C++ Build Tools
- WebView2
- Rust and Cargo through rustup

## API Key

Do not bake a shared DeepSeek key into the desktop app. During this prep stage, the app still reads `DEEPSEEK_API_KEY` from local environment configuration.

## Known V5 Limitation

The Tauri shell is wired, but this version still relies on the existing local Express API for model calls. A later hardening pass should move the DeepSeek call behind a Tauri command or a packaged local sidecar before distributing the app to non-developers.
