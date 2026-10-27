# 0003 — Library workspace with copied sources and versioned outputs

- Status: accepted
- Date: 2026-10-26

## Context

A browser cannot tell a local server where a dropped file lives on disk, so ffmpeg cannot read it
in place. The user also wants to watch the original next to its compressed versions and keep many
versions in one place.

## Decision

- Dropped (or chosen) files are **copied** into `videos/<clean-name>/source.<ext>` after checking
  there is free space for the copy plus an output. The original on the PC is never touched.
- Folder names are made Windows-safe: forbidden characters `<>:"/\|?*` and control characters are
  removed, trailing dots/spaces trimmed, reserved device names (`CON`, `NUL`, `COM1`…) get a `_`
  suffix, and a repeated name becomes `name (2)`.
- Every encode adds a new file in `outputs/` named
  `<profile>-<codec>[-max]_vmaf<target>_<YYYY-MM-DD-HHMMSS>.mp4`. Nothing is overwritten.
- `meta.json` in each folder holds the source info and every output's settings, size, VMAF and
  timings. There is no database: the app rebuilds the library by scanning `videos/` at startup.
- The queue lives in `videos/queue.json`. After a crash or close, a running job becomes
  "interrupted" (its partial files are deleted) and waiting jobs stay paused until the user
  presses Resume.
- "Remove source copy" frees disk space while keeping outputs (compare and re-encode are then
  unavailable).

## Consequences

- Importing a large file temporarily doubles disk use; the library header shows the total.
- The library is plain files: it can be backed up, moved or cleaned in Explorer.
