# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain static HTML, CSS and ES modules served by a local Node server using built-ins only. No
framework, no bundler, no build step, no CDN or internet fonts (confirmed by the user; see
docs/adr/0001).

## Users

People on Windows laptops (primary: an RTX 4050 laptop owner) who make screen recordings and
camera/phone clips and are running out of space or need smaller files to share. HandBrake crashed
on their machine. They are not video engineers and do not want to pick codecs or bitrates.

## Product Purpose

Make recordings much smaller while they look the same. "Looks the same" is defined as a VMAF
score (95 by default). Success: a typical 1080p screen recording comes out at least 5× smaller,
a camera clip at least 2× smaller, without the user being able to tell the difference.

## Positioning

Fully local and quality-targeted: instead of asking for a bitrate or preset, LocalPress measures
perceived quality and finds the smallest file that still meets the target, using the laptop's
GPU encoder. Videos never leave the PC.

## Operating Context

- Launched by double-clicking `start.bat`; the UI opens in the default browser at 127.0.0.1.
- Typical session: drop one or several recordings in, queue a version, wait, compare original
  and output with a wipe slider, keep the small file.
- The library is a folder of plain files (`videos/<name>/`) the user can also open in Explorer.
- Encodes take minutes and run one at a time; the user often leaves the tab open in the
  background.

## Capabilities and Constraints

- Profiles: Archive (AV1, VMAF 95 default) and Share (H.264, VMAF 93 default, for messaging apps
  and old devices). Targets 90 / 93 / 95 / 97. GPU by default, "max squeeze" on CPU.
- Screen vs camera detected automatically, overridable per video.
- Many versions per video, never overwritten; originals on the PC are never touched (dropped
  files are copied in).
- Tools panel shows whether ffmpeg/Node/GPU encoders are present and installs ffmpeg into the
  app folder with one click.
- Windows 10/11 only for v1.

## Brand Commitments

- Name: LocalPress.
- Agreed visual direction, binding: "Darkroom" — dark-first, one accent colour, a matching light
  theme that follows Windows, fonts bundled in the app folder, monospaced figures for sizes and
  scores, motion disabled by reduced-motion. Award-winning tool feel.
- Agreed signature moments: a before → after size bar that collapses when an encode finishes;
  a full-frame wipe-slider compare with 1:1 zoom.

## Evidence on Hand

Measured on the target laptop with a synthetic 1080p60 screen recording: 120.7 MB → 3.7 MB at
VMAF 95.24. No real user footage, testimonials or benchmarks beyond that; do not invent any.

## Product Principles

1. Never touch or lose the user's original.
2. Quality is measured, not promised: always show the VMAF reached and let the eye confirm.
3. Nothing leaves the PC.
4. Sensible defaults first; choices only where they change the outcome (profile, target, speed).

## Accessibility & Inclusion

Keyboard operable throughout (compare view has full shortcuts), respects reduced motion, both
colour schemes meet WCAG AA contrast.
