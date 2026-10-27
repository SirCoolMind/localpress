# LocalPress v1 — Design

LocalPress makes screen recordings and camera clips much smaller while they look the same
(VMAF ≥ 95 by default). It runs entirely on the user's PC and is tuned for laptops with an
NVIDIA GPU. Decisions behind this design are in [`docs/adr/`](adr/).

## Constraints

- **Local-first** — videos never leave the PC; the only network traffic is the user-triggered
  tool downloads ([ADR 0001](adr/0001-local-first-no-build-step.md)).
- **No build step** — plain JS/HTML/CSS, Node built-ins only, no `node_modules` in the app.
- **Everything inside the app folder** — portable Node and ffmpeg live under `app/`; copies
  elsewhere on the PC are never used.
- **Windows 10/11 only** for v1.

## Folder layout

```
localpress/
  start.bat                 launcher (double-click)
  app/
    bootstrap.ps1           first-run Node download + single-instance check
    server.js               HTTP server entry
    lib/                    server modules (see below)
    ui/                     static UI (index.html, css, js, fonts)
    runtime/node/           portable Node            (git-ignored)
    tools/ffmpeg/           ffmpeg + ffprobe         (git-ignored)
    .state/                 server.json (port, pid)  (git-ignored)
  videos/                   the library              (git-ignored)
    queue.json
    <clean-name>/
      source.<ext>          copied original
      meta.json
      thumb.jpg
      outputs/              versioned outputs
      .preview/             browser-playable preview, only if needed
      .work/                temp files of the running job
  docs/                     this file + ADRs
  tests/unit/               node:test unit tests
  tests/e2e/                Playwright (developer-only)
```

## Launch and lifecycle

1. `start.bat` sets the console title to **LocalPress** and runs `app/bootstrap.ps1`.
2. Bootstrap downloads the pinned portable Node into `app/runtime/node/` if it is missing
   (SHA-256 verified), then checks `app/.state/server.json`: if a LocalPress server answers
   `/api/ping` it just opens the browser tab and exits.
3. Otherwise it runs `node app/server.js` in the console window. The server listens on
   `127.0.0.1:7878` (next free port up to 7899), writes `server.json`, and opens the browser.
4. Closing the console window or pressing **Quit** in the UI stops the server.

## Server security

- Binds to `127.0.0.1` only.
- Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding).
- Every non-GET request must carry an `Origin` equal to the app's own origin.
- No CORS headers are ever sent, so other sites cannot read responses.
- File paths from requests are resolved inside the library and rejected if they escape it.

## Tools panel

| Item | Check | Action |
| --- | --- | --- |
| ffmpeg + ffprobe | present in `app/tools/ffmpeg/bin`, version, has `libvmaf`, `libsvtav1`, `av1_nvenc` | **Install** (pinned gyan.dev 8.0 full build, SHA-256 verified, extracted with Windows' built-in `tar`) |
| Node | version of the running runtime | installed by `start.bat` |
| GPU encoders | a 0.2 s test encode per encoder: NVENC → QSV → AMF → CPU | detect only; link to driver update when NVENC fails on an NVIDIA GPU |

Also **Re-check** and **Uninstall tools** (deletes `app/tools/`).

## Compression engine

### Profiles

| Profile | Codec | Default target | Hardware chain | Max squeeze (CPU) |
| --- | --- | --- | --- | --- |
| Archive | AV1 10-bit in MP4 | VMAF 95 | `av1_nvenc` → `av1_qsv` → `av1_amf` → `libsvtav1` | `libsvtav1` preset 4 |
| Share | H.264 8-bit in MP4 | VMAF 93 | `h264_nvenc` → `h264_qsv` → `h264_amf` → `libx264` | `libx264` preset slow |

Selectable targets: 90, 93, 95, 97. Resolution is never changed (odd sizes are cropped by one
pixel to satisfy 4:2:0). Rotated phone videos come out upright. Interlaced sources (TV captures,
camcorders) are deinterlaced with `bwdif`, one frame per frame, so players never show combing.
Outputs use `+faststart`. Each encoder searches its full quantiser range (e.g. `av1_nvenc` cq
20–63): screen recordings often still meet the target at the top of it.

### Pipeline per job

1. **Analyze** — probe; screen/camera detection already stored at import (override wins).
2. **Search** — pick samples: the whole video if under 40 s, else 8 × 4 s spread across it
   (more, shorter windows: with 4 × 8 s a film's end credits carried the average and the search
   passed at 96 where the whole film scored 90). Find the highest quantizer whose mean VMAF over
   the samples meets the target, at most 6 tries: start from a per-encoder guess, then
   interpolate between the closest passing and failing tries.
3. **Encode** the whole video at the chosen quantizer.
4. **Verify** — videos under 2 minutes: VMAF of every frame of the output. Longer videos: a
   spot-check of 10 evenly spaced 6 s windows at full frame rate (whole-file VMAF runs at about
   140 fps on the target laptop, which would blow the time budget). If below target, re-aim:
   step down by the measured gap divided by the VMAF-per-step slope the search saw, and encode
   again — up to 4 full encodes. If even that misses (the encoder's best quality is not enough),
   the version is kept but marked `metTarget: false` and the UI shows "below 95".
5. **Finish** — if the output is not smaller than the source it is deleted and the job reports
   "already efficient"; otherwise it is moved into `outputs/` and recorded in `meta.json`.

Screen recordings get `mpdecimate` (conservative thresholds, keeps at least one frame per second)
and variable frame rate output.

VMAF always puts both files on the source frame grid (`fps=`), so duplicate-dropped outputs and
variable-frame-rate sources (Game Bar, OBS, phones) pair frame for frame. Sources larger than
1080p are scored after scaling both sides to 1080p — the viewing condition the default model is
trained for, and 2–4× faster at 1440p/4K.

### Audio

Every audio track is kept (OBS and Game Bar often record the microphone on track 2). Each track is
copied if AAC/Opus/MP3 at ≤ 192 kbps; otherwise re-encoded to AAC (128 kbps stereo, 256 kbps
for surround).

### Screen vs camera detection

At import, a 20 s sample from the middle is run through a strict `mpdecimate`
(`hi=32:lo=16:frac=0.02`, near-exact repeats only). If 30 % or more of the frames repeat, the
video is "screen", else "camera". The stricter detector matters: with the looser dropping
thresholds, 120 fps film looked like a screen recording, and dropping its frames cost ~3.5 VMAF.
The UI shows the guess and allows an override.

## Library

- Import: drag-drop or **Choose files**; the browser uploads the file to the local server, which
  checks free space (copy + output) first, writes `source.<ext>`, probes it, makes a thumbnail
  and runs detection. Imports need ffmpeg installed.
- `meta.json`:
  ```json
  {
    "id": "meeting-2026-10-26", "originalName": "meeting 2026-10-26.mkv",
    "importedAt": "…", "sourceRemoved": false,
    "source": { "file": "source.mkv", "size": 0, "duration": 0, "width": 0, "height": 0,
                "fps": 0, "vcodec": "h264", "acodec": "aac", "abitrate": 0, "bitrate": 0 },
    "contentType": { "detected": "screen", "override": null, "dupRatio": 0.0 },
    "preview": null,
    "outputs": [ { "file": "…mp4", "profile": "archive", "codec": "av1", "encoder": "av1_nvenc",
                   "max": false, "target": 95, "q": 0, "vmaf": 0, "size": 0,
                   "encodeSeconds": 0, "createdAt": "…" } ]
  }
  ```
- Queue (`videos/queue.json`): one job at a time; statuses `queued`, `running`, `done`,
  `efficient`, `failed`, `cancelled`, `interrupted`. On startup `running` → `interrupted` (its
  `.work/` is wiped) and the queue is paused if anything is still waiting.
- Playback fallback (on first open of a video the browser cannot play): remux to MP4
  (`.preview/preview.mp4`), then if that also fails, a quick H.264 proxy. Previews are for viewing
  only; encoding and VMAF always use the real source.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/ping` | liveness (used by bootstrap) |
| GET | `/api/state` | tools, library, queue, disk in one snapshot |
| GET | `/api/events` | server-sent events: `tools`, `library`, `queue`, `job` |
| POST | `/api/tools/install` · `/api/tools/uninstall` · `/api/tools/recheck` | tools panel |
| PUT | `/api/import` | raw upload; headers `X-File-Name`, `Content-Length` |
| PATCH | `/api/videos/:id` | `{ contentType }` override |
| DELETE | `/api/videos/:id` | remove the video folder from the library |
| POST | `/api/videos/:id/remove-source` | delete the source copy, keep outputs |
| POST | `/api/videos/:id/preview` | `{ mode: "remux" \| "proxy" }` |
| POST | `/api/videos/:id/reveal` | open Explorer at the folder or `{ file }` |
| DELETE | `/api/videos/:id/outputs/:file` | delete one output |
| POST | `/api/queue` | `{ videoIds, profile, target, max }` |
| POST | `/api/queue/:job/cancel` · `/retry` · DELETE `/api/queue/:job` | job control |
| POST | `/api/queue/pause` · `/resume` | queue control |
| POST | `/api/quit` | stop the server |
| GET | `/media/:id/(source\|preview\|thumb\|outputs/:file)` | files with HTTP Range support |

## UI — "Darkroom"

- Dark-first charcoal surfaces, one electric accent, a matching light theme that follows Windows.
  Fonts bundled in `app/ui/fonts/` (OFL). Motion is short and purposeful and is disabled by
  `prefers-reduced-motion`.
- **Library** — grid of cards: thumbnail, name, original size, best saving ("2.1 GB → 180 MB,
  −91 %"), queue status. Header shows disk used by the library and free space. Drop anywhere.
- **Video page** — original player, content-type chip (override), outputs smallest first with
  Play / Compare / Download / Show in Explorer / Delete, **New version** (profile, target,
  GPU / max squeeze), Remove source copy.
- **Signature moment** — when an encode finishes, a large before → after size bar collapses to
  the new size with the percentage saved.
- **Compare** — original and output in sync under a full-frame wipe slider; 1:1 zoom follows the
  mouse. Keys: `Space` play/pause, `←`/`→` frame step, `[`/`]` move wipe, `Z` zoom, `1`/`2` solo
  original/output, `?` shortcut list, `Esc` close.
- **Queue drawer** — live progress, phase, time remaining, cancel/retry, pause/resume.
- **Tools panel** — statuses, Install / Re-check / Uninstall, install progress.

## Tests

- `tests/unit` — Node's built-in runner: name cleaning, quality search with a fake encoder,
  `meta.json`/queue recovery, request security checks. Run `tests\run-unit.bat`.
- `tests/e2e` — Playwright (developer-only; own `package.json`; browsers in
  `tests/e2e/.browsers/`, git-ignored). Covers tools panel states, import, encode, compare,
  delete/remove source, interrupted-job recovery and foreign-origin rejection on generated clips.
  The generated screen clip is constant-bitrate with filler (like Game Bar / OBS CBR); a
  low-bitrate fixture would make every encode "already efficient". The tools specs install from
  a local zip of the real ffmpeg through the same download → checksum → extract path. Run
  `tests\e2e\run.bat` (pass a spec path to run one file).
- `tests/e2e/screens.mjs` — captures library / video / compare / tools at desktop and phone
  width, dark and light, into `.impeccable/review/` from a running app.

## v1 done

1. Fresh copy: `start.bat` brings up the UI; Tools shows ffmpeg ❌ → Install → ✅; nothing
   outside the app folder is used or changed.
2. A 1080p screen recording at Archive / VMAF 95 is ≥ 5× smaller with whole-file VMAF ≥ 95, in
   under 5 minutes per 10 minutes of video on an RTX 4050 laptop.
3. A camera clip is ≥ 2× smaller at VMAF 95.
4. Compare view works for both.

Measured (October 2026, full table in [FUTURE.md](FUTURE.md)):
- 10-minute 1080p60 screen recording: 29.75× smaller in 249 s. VMAF was 95.72 by spot-check
  and 96.05 on the whole file.
- Camera footage: 1.97× (Big Buck Bunny 4K) to 62× (ProRes export) smaller.
- 13/13 e2e and 28/28 unit tests pass.

## Known limitations (v1)

- HDR sources are encoded with their colour tags carried over but are not tone-mapped; VMAF is
  computed in SDR terms.
- The verify step checks mean VMAF only, so short dips in hard scenes can sit well below
  target while the mean passes.
- Subtitles and chapters are dropped (`-sn`).
- Opus/AAC tracks in MKV usually have no stored bitrate, so they are re-encoded to AAC instead of
  copied.
- AMD AMF and Intel QSV paths are implemented but untested on real hardware.
- Uploads copy the file even when it is already on the same disk.
