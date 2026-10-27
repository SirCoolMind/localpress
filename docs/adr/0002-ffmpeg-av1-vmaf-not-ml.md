# 0002 — ffmpeg + AV1 + VMAF targeting instead of an ML model

- Status: accepted
- Date: 2026-10-26

## Context

The goal is "looks the same, much smaller". One option considered was a local AI model.

- Neural video codecs are research-grade: slow, and their files need a matching decoder, so
  normal players cannot open them.
- "Downscale now, AI-upscale later" only works if every viewer runs the upscaler.
- The real waste in screen recordings is elsewhere: recorders write H.264 at very high bitrates
  for speed, at 30–60 fps, while most frames barely change.

## Decision

- Encode with **ffmpeg** using modern codecs:
  - **Archive** profile: AV1 (10-bit), target VMAF ≥ 95.
  - **Share** profile: H.264 (8-bit, plays everywhere incl. messaging apps), target VMAF ≥ 93.
- Prefer **hardware encoders** (NVIDIA NVENC → Intel QSV → AMD AMF), falling back to the CPU
  (`libsvtav1` / `libx264`). A "max squeeze" option always uses the CPU encoder for the smallest
  files.
- Define "looks the same" as a **VMAF** score. The engine searches for the highest quantizer
  (smallest file) whose VMAF on representative samples meets the target, encodes the whole video
  once, then scores the whole output and re-encodes one step better if it missed.
- For **screen recordings**, drop frames that repeat unchanged (`mpdecimate`, conservative
  thresholds, at least one frame per second kept) and enable AV1 screen-content tools.

## Consequences

- Outputs are ordinary MP4 files any modern player or browser opens.
- Each encode costs some extra time for the quality search and verification.
- VMAF is a perceptual model, not a guarantee; the compare view (wipe slider, 1:1 zoom) lets the
  user confirm with their own eyes.
- Measured on the RTX 4050 laptop with a synthetic 1080p60 screen recording (120.7 MB, H.264
  16 Mbps): Archive / VMAF 95 produced 3.7 MB (32× smaller, VMAF 95.24) with `av1_nvenc`.
  Dropping repeated frames made outputs about 30 % smaller at equal VMAF.
