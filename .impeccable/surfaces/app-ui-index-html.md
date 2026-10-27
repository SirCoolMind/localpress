---
version: 1
slug: "app-ui-index-html"
primary_target: "app/ui/index.html"
related_targets: []
---

## Scope

The whole LocalPress app UI (single page: library, video page, compare overlay, queue drawer,
tools drawer). Mode: Operate.

## Audience and task

Windows laptop users with oversized recordings. Task: drop videos in, queue a version, wait,
compare, keep the small file. Frequent states: first run without tools, empty library, importing,
encoding in the background, finished result, failure, unplayable original.

## Constraints

No framework, no build step, no network assets; fonts bundled (Geist, Geist Mono, OFL).
Keyboard operable; reduced motion respected; AA contrast in both themes.

## Direction contract

THESIS: A darkroom for footage: the screen is a neutral grading surround where the user's video is
the only bright thing, and every result is read as a measured print (size, VMAF, time). Refuses the
generic "upload card + settings form + progress spinner" converter page.

OWN-WORLD: Charcoal surround (neutral, faint warm tint) in stepped surfaces; one safelight accent
(electric orange-red) reserved for the compressed result, progress and primary action; state colours
for done/failed/warning. Geist for UI, Geist Mono tabular figures for every measurement. Hairline
1px rules, 6px radii, authored 1.5px-stroke SVG icons.

STORY: The user sees their library as a contact sheet, each frame carrying its before → after bar;
believes the saving because the VMAF and the wipe compare prove it; acts by dropping files and
pressing Compress.

FIRST VIEWPORT: Top bar (wordmark left; library disk use, Queue and Tools on the right). Library as
a dense contact-sheet grid of 16:9 thumbnails, each with name, figures and a thin before/after bar;
running jobs expose along the thumbnail's bottom edge in safelight. Empty or first-run state fills the
viewport with one drop target and the one-time setup action.

FORM: Pinned by the user ("Darkroom"), list position 1, no seed key (direction pinned, concept-seed
not run). Signature move: the size bar that collapses from the original's length to the output's when
an encode finishes, with the percentage saved set large in mono; second moment: full-frame wipe
compare.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
