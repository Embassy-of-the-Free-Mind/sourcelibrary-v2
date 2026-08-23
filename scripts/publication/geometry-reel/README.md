# Esoteric Geometries — reel & print tooling

One-off art tooling built around `scripts/publication/esoteric-geometries.mjs`
(the EPUB generator). These scripts scan the public gallery API for circular
plates (alchemical cosmograms, volvelles, Tibetan mandalas, chakra plates),
center them with a gradient-based Hough circle detector, mask them to
transparent discs, and assemble animated reels and print artifacts.

Everything writes into `esoteric-geometries-out/` at the repo root (gitignored).
All data comes from the public sourcelibrary.org API — no DB access needed.
Some scripts carry an absolute `ROOT` path from the original session; adjust it
(or run from the repo root) before reuse.

## Gathering (gallery API sweeps)

| Script | What it collects |
|---|---|
| `probe-buddhist.mjs` | Sizes the pool of Buddhist imagery available |
| `gather-buddhist.mjs` | Downloads Buddhist mandala plates + manifest |
| `gather-eyes.mjs` | "All-seeing eye" imagery |
| `gather-psychedelic.mjs` | Proto-psychedelic / visionary-art material |
| `gather-spiritual-anatomy.mjs` | Subtle-body / spiritual-anatomy plates |
| `mandala-dataset.mjs` | Nested-circle mandala dataset (multi-circle Hough + NMS, relation classification, annotations.json) |
| `mandala-center.mjs` | Center-crops the mandala dataset to the largest detected circle |

## Circle extraction & reels

| Script | Output |
|---|---|
| `build-gif.mjs` | The main animated reel (env-driven: `MASK`, `HERO`, `CLOSER`, `INCLUDE`, `EXCLUDE`, `OUTRO`, `WARP`, `TEMPO`, …). Contains the Hough detector and the swirl-warp engine |
| `all-circles.mjs` | Masked discs for every keyword-circular plate, for curation |
| `chakra-reel.mjs` | The seven Leadbeater chakras ascending, as a GIF |
| `universe-warp.mjs` | Reel → Fludd-man vortex → stripe spiral → observable universe → Boehme eye warp finale (GIF + WebP) |
| `warp-figure.mjs` | Standalone breathing swirl-warp on a single disc |
| `recenter.mjs` | Rim-alignment grid search to fix a disc's center (`SEED_CX`/`SEED_CY`/`SEED_R`/`SEARCH` env seeds); rewrites the print disc, sticker, and button |
| `citations.mjs` | Provenance list (Markdown + JSON) for every image in the reel |

## Print & gift artifacts

| Script | Output |
|---|---|
| `print-portfolio.mjs` | Letter PDF, one plate per tear-out page with citation (cover + colophon + 28 plates) |
| `flipbook.mjs` | Printable flip-book sheets from the warp reel GIF |
| `gifts-booklet.mjs` | "Eight Circles" booklet — the eight sticker/button designs with a significance paragraph each |

Sticker and button artwork lands in `esoteric-geometries-out/playa-gifts/`.
