# 0001 — Local-first, no build step

- Status: accepted
- Date: 2026-10-26

## Context

LocalPress exists because recordings are huge and existing tools (HandBrake) crash on the
target laptop. Videos are private (meetings, screen captures, family clips), and the people using
the tool are not developers: they unzip a folder and double-click something.

## Decision

1. **Local-first.** Videos never leave the PC. The only network traffic is downloading the
   pinned tools (portable Node, ffmpeg), and only when the user triggers it (first launch of
   `start.bat`, or the Install button). No update checks, no telemetry, no CDN, no web fonts from
   the internet.
2. **No build step.** The app is plain JavaScript (ES modules), HTML and CSS served as-is.
   The server uses only Node built-ins. There is no `npm install`, no bundler, no transpiler,
   no `node_modules` in the app.
3. **Everything inside the app folder.** A portable Node lives in `app/runtime/node/` and
   ffmpeg in `app/tools/ffmpeg/`. Copies installed elsewhere on the PC are never used, so the app
   behaves the same on every machine and uninstalling is deleting the folder.
4. **Pinned and verified downloads.** Each tool has a fixed version, URL and SHA-256. A download
   that does not match is discarded.
5. **The server only listens on 127.0.0.1** and rejects requests whose `Host` or `Origin` is not
   its own page, so other websites cannot drive it.

Developer-only tooling (the Playwright suite in `tests/e2e/`) may use npm, but it keeps its
packages and browsers inside its own folder and the app never depends on it.

## Consequences

- First launch needs an internet connection (about 30 MB for Node, 220 MB for ffmpeg).
- No TypeScript, no UI framework; the UI is written with small hand-rolled helpers.
- Windows only for v1: the launcher is a `.bat` + PowerShell, and hardware-encoder detection is
  Windows-specific.
