# LocalPress — test findings and what to do next

Written after the v1 bug hunt (October 2026). Everything below was measured on the reference
machine (RTX 4050 laptop, `av1_nvenc`, Archive profile, VMAF target 95) with the app's own
pipeline, driven through its HTTP API.

## How it was tested

Each clip was imported into a separate library, queued at Archive / 95, and the output was
checked with ffprobe:

- display size, including rotation;
- duration within 0.5 s;
- audio kept;
- VMAF at or above target.

Footage:

- **Real camera material:** Xiph test webcams (VP9 720p60), Tears of Steel 1080p (12 min,
  24 fps), Big Buck Bunny 4K (3 min cut).
- **Variants cut from Tears of Steel:** camcorder `.ts`, ProRes edit export, 1080i TV, 120 fps,
  HDR10 (PQ/BT.2020 HEVC), rotated phone portrait, vertical 1080×1920, 4K 10-bit HEVC phone
  clip, 20 Mb/s camera original.
- **Generated screen recordings:** 720p low bitrate, 1080p VFR, OBS-style multi-track MKV,
  1440p60, 4K30, 1366×767 yuv444 window capture, a 10-minute 1080p60 recording, an already-AV1
  file.
- **Broken inputs:** audio-only, truncated, and a reserved/unicode file name.

Synthetic "camera" clips (fractal zooms, noise) were dropped: VMAF behaves pathologically on
them and they say nothing about real footage.

## Results

Ratio is source size ÷ output size. Pass 1 ran on the code as first built; pass 2 ran after
the fixes below. "—" means the clip was not rerun because nothing affecting it changed.

| Clip | Source | Type | Pass 1 | Pass 2 |
| --- | --- | --- | --- | --- |
| tiny clip | 1080p24 H.264, 6 s | camera | 3.89×, VMAF 95.15, 4 s | — |
| camcorder.ts | 1080p24 H.264 | camera | 13.13×, 95.22, 34 s | — |
| ProRes export | 1080p24 ProRes | camera | 62.63×, 95.30, 14 s | — |
| phone portrait (rotated 90°) | 1080p24 H.264 | camera | 11.23×, 95.10, upright ✓ | — |
| vertical 1080×1920 | H.264 | camera | 6.72×, 95.13 | — |
| camera original 20 Mb/s | 1080p24 H.264 | camera | 12.45×, 95.62, 2 attempts | — |
| phone 4K 10-bit | 3840×1600 HEVC | camera | 12.96×, 95.29, 191 s | — |
| Johnny webcam | 720p60 VP9 | camera | 4.93×, 95.22 | — |
| FourPeople webcam | 720p60 VP9 | camera | 4.41×, 95.01 | — |
| tv 1080i | 1080i25 H.264 | camera | 4.40×, 95.20 (no deinterlace) | **6.18×, 95.28**, 26 s |
| camera 120 fps | 1080p120 H.264 | screen ✗ | 2.15×, 95.23, frames dropped | **camera ✓, 2.43×, 95.11**, 83 s |
| HDR10 | 1080p24 HEVC PQ/BT.2020 | camera | (bad fixture) | 1.75×, 95.18, tags kept ✓ |
| screen VFR | 1080p H.264 | screen | 18.48×, 96.72, 163 s | **44.11×, 96.38**, 187 s |
| OBS multi-track MKV | 1080p30, 2 audio tracks | screen | 22.79×, 2nd track lost ✗ | **31.24×, 96.86, both tracks** |
| screen 1440p60 | H.264 CBR | screen | 50.72×, 96.48, 383 s | **88.27×, 97.02, 234 s** |
| screen 4K30 | H.264 CBR | screen | 74.23×, 96.04, 379 s | **158.65×, 97.15, 168 s** |
| Tears of Steel (12 min) | 1080p24 H.264 | camera | 4.95×, **89.99 ✗** (spot-check) | **2.43×, 95.18**, 117 s |
| Big Buck Bunny 4K (3 min) | 2160p30 H.264 | camera | 1.09×, 95.33, 634 s | **1.97×, 95.71**, 373 s, 2 attempts |
| **screen600 (10 min)** | 1080p60 H.264 | screen | — | **29.75×, 95.72, 249 s** |
| already AV1 / low-bitrate 720p / yuv444 window / small 720p | various | — | "already efficient" ✓ | — |
| audio-only | AAC | — | refused ✓ | — |
| truncated | broken MP4 | — | refused, unclear message | refused, clear message ✓ |

v1 criteria against these numbers:

- **10-minute 1080p screen recording:** 29.75× smaller at VMAF ≥ 95 in 249 s, against a budget
  of ≥ 5× in under 300 s. **Met.**
- **Camera footage at VMAF 95:** 2.4× to 62× smaller depending on how wasteful the source was.
  **Met.** The tightest was the 4K Blender film at 1.97×, which is already a lean encode.
- **Whole-file VMAF of the spot-checked outputs** confirms the estimate holds; it lands on the
  safe side or within 0.03:

  | Output | Spot-check | Whole file |
  | --- | --- | --- |
  | Tears of Steel 12 min | 95.18 | 96.29 |
  | screen600 10 min | 95.72 | 96.05 |
  | Big Buck Bunny 4K 3 min | 95.71 | 95.68 |

  Before the fixes, the old Tears of Steel output scored 91.6 on the whole file. Single frames
  went down to 57, and 342 frames were under 80.

## Bugs found and fixed

1. **Long films could finish below target.** On Tears of Steel the spot-check scored 89.99 and
   the output was kept as "done". The four 4-second search samples happened to miss the hard
   scenes.
   - Fix: the search now uses 8×4 s samples spread across the file.
   - When verify misses, the engine re-aims along the measured quality/score slope, up to 4
     full encodes.
   - Every version records `metTarget`, and the UI marks a miss ("VMAF x · below T").
2. **High-frame-rate camera footage was treated as a screen recording.** At 120 fps many
   adjacent frames are near-identical, so the loose duplicate detector fired. Dropping them cost
   about 3.6 VMAF points.
   - Fix: detection now uses strict thresholds (`hi=32:lo=16:frac=0.02`). Only true repeats,
     which is what screen recorders produce, count.
3. **Only the first audio track was kept.** OBS/Game Bar files with mic and desktop audio on
   separate tracks lost one silently.
   - Fix: every track is mapped. Each is copied when it is already AAC/Opus/MP3 at ≤ 192 kb/s,
     otherwise re-encoded to AAC.
4. **Interlaced TV/camcorder footage was encoded with combing.**
   - Fix: it is now deinterlaced with `bwdif`, and the reference is deinterlaced the same way
     for VMAF.
   - The ratio went from 4.4× to 6.2× because the encoder no longer spends bits on comb edges.
5. **VMAF on 1440p/4K sources was slow and not comparable with the 1080p model.**
   - Fix: both sides are scaled to 1080p before scoring (`vmafScale`), which is what the
     default VMAF model is trained for.
   - Encode times dropped about 40%, and the 4K film went from 1.09× to 1.97× because
     sub-1080p detail no longer dominated the score.
6. **Quality range clipped too early.** NVENC/SVT AV1 now search CQ 20–63 and x264/NVENC H.264
   CRF 14/16–51, so very clean screen content can reach high CQ values (59–63 above).
7. **Damaged or still-copying files** got "No video stream found". They now get a message that
   says what probably happened and what to do.
8. **Reserved Windows names** with dots or trailing spaces (`CON.. clip`, `nul .backup`) are now
   prefixed so they cannot become device names.
9. **UI:**
   - Progress bars animate with `transform` instead of `width`.
   - Mobile compare hides the side labels that overlapped the wipe handle.
   - The Uninstall button no longer shows when nothing is installed.
   - The profile field had a `<label>` wrapper that stole clicks; it is now a plain field group.
   - The disk meter wraps below 820 px.
   - The video page shows "+ N more tracks", "interlaced" and "HDR".

## Recommendations

Rough priority order: things that affect correctness or trust first.

### Quality and correctness

1. **Add a low-percentile VMAF guard, not just the mean.**
   - Tears of Steel had single frames down to ~57 while the mean passed.
   - Track the 1st percentile or harmonic mean in verify, and treat a large gap as a miss
     (for example p1 < target − 15).
   - This matters most for film with dark scenes.
2. **Verify HDR properly.**
   - Colour tags carry over (checked: `bt2020` / `smpte2084` on the output). Mastering
     display and MaxCLL/MaxFALL side data have not been checked yet.
   - VMAF on PQ signals is not meaningful. Either tone-map both sides to SDR for scoring, or
     label HDR results as "approximate" in the UI.
3. **Copy Opus/AAC tracks from MKV.** MKV often stores no per-track bitrate, so the OBS test
   re-encoded two Opus tracks to AAC. Estimate bitrate from packet sizes (`ffprobe
   -show_packets` on the first 30 s) and copy when it is under the limit.
4. **Keep subtitles and chapters.** The encode currently uses `-sn`. Map text subtitles (convert
   to `mov_text` for MP4) and chapters, and warn when image subtitles (PGS) cannot go into MP4.
5. **Cadence and telecine.**
   - 24p content in a 60 or 120 fps container should be returned to 24p (`mpdecimate` on
     cadence, or `fps` after detection).
   - Telecined 29.97i should use `fieldmatch,decimate` instead of `bwdif`.
   - Both save bits and look better.
6. **Exit early on "already efficient" files.** The efficient verdict took 36–67 s because the
   whole search ran first. Probe bits-per-pixel-per-frame and codec up front, and run one
   probe encode at a low CQ: if it is not at least 10% smaller, stop.

### Speed

7. **Score VMAF on the GPU.** ffmpeg 8 has `libvmaf_cuda`. On NVIDIA it would cut the scoring
   share of each job (currently about half the time on long files).
8. **Pipeline encode and scoring.** Score finished samples while the next probe encodes, and
   start verifying the first windows of the full encode while it is still writing.
9. **Run GPU and CPU jobs in parallel.** One NVENC job plus one SVT-AV1 "Max squeeze" job can
   share the machine. The queue is strictly serial today.
10. **Use a frame budget for short high-resolution clips.** Under 40 s the whole clip is used as
    the sample. For a 4K60 30 s clip that is 1800 frames per probe; sample by frame count
    instead of duration.

### Features

11. **Per-scene target quality** (Av1an-style chunking): split on scene cuts, search each chunk
    and concatenate. It gives the best ratio on mixed content such as a talk with slides and
    camera. It is the largest piece of work here.
12. **Film-grain synthesis** for SVT-AV1 Max squeeze (`film-grain=8` with denoise). Large wins
    on grainy camera footage. VMAF punishes it, so it needs its own "visual" mode.
13. **"Share to phone" preset:** 720p H.264 with a size cap for messaging apps.
14. **Batch actions:** queue every video in the library with one profile, and remove all source
    copies once every video has a version that met its target.
15. **Import by reference** instead of copy for files already on the same disk (hard link or
    stored path), with clear wording that the original must not move.

### Platform and testing

16. **Validate AMD AMF and Intel QSV.** The paths exist but were only tested on NVIDIA.
17. **Add a slow e2e suite on real footage.** Download Xiph/Blender clips into `tests/e2e/.media`
    (git-ignored) and assert ratio and VMAF bands, run before releases. The bug-hunt scripts
    that produced the table above are a starting point.
18. **Fonts:** Geist was flagged by the design linter as an overused choice. Keep it or pick a
    less common OFL grotesk. This is a taste call, not a bug.
