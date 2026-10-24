# Palenque Cross Group block reference set (`maya_glyph_blocks`)

One Mongo document per glyph-block reading in David Stuart, *The Palenque Mythology: Inscriptions from
the Cross Group at Palenque* (Sourcebook for the 30th Maya Meetings, The Mesoamerica Center, UT Austin,
2006). Each holds Stuart's transliteration, transcription and translation, plus a crop of that block from
the sourcebook's drawing. It is the Classic-period answer key for the glyph-reading evals (#6903).

PRIOR ART: `scripts/learn/maya-signs/` (`maya_signs`, #6935) holds one drawing per *sign* from the Stuart
syllabary and the Wayeb charts. This set is one drawing per *block* of running text, with the expert reading.
The loader follows the `maya_signs` loader (dry run by default, hash-keyed R2 images, upsert by `_id`).

## What is in it (loaded 2026-10-18)

657 reading entries, of which 649 have a crop. 22 entries are ranges such as `A1-B2` (the Initial Series
introductory glyph and the Long Count periods). A range gets one crop covering all its blocks, and `blocks`
lists them. The crops cover 677 blocks in all.

| monument | entries | with crop |
|---|---|---|
| `tc-main-tablet` (Tablet of the Cross, main and secondary texts) | 227 | 227 |
| `tc-alfardas` | 24 | 24 |
| `tc-sanctuary-jamb` | 13 | 12 |
| `tc-sanctuary-panel-left` (caption) | 11 | 11 |
| `tc-shrine-facade` | 8 | 8 |
| `tfc-main-tablet` | 153 | 153 |
| `tfc-alfardas` | 24 | 24 |
| `tfc-sanctuary-jamb` | 24 | 24 |
| `ts-main-tablet` | 145 | 145 |
| `ts-alfardas` | 14 | 10 |
| `ts-sanctuary-jamb` | 14 | 11 |

The 8 entries without a crop are still loaded, with `image: null` and `dropped` giving the reason. Seven are
blocks that are not on the drawing: TC jamb Ap11; TS alfardas C1, pJ1, pJ2, pK1; TS jamb A4, B4. TS jamb A1 was
dropped by eye because its crop is blank broken stone. Temples XIX and XXI and the bench fragments have drawings
and dates but no block-by-block readings in the sourcebook, so they are not here.

**Fields.** `monument`, `coord`, `blocks` (for ranges), `transliteration` (bold line), `transcription`
(italic), `translation` (roman), `flags`, `pdf_page`, `printed_page`, `image` (R2 key, public URL, sha256,
size), `source_ref` (bibliographic data, plus drawing page, box in PDF points and render zoom), `rights`,
`checked`. The readings are kept verbatim, with `?`, brackets and `…`.
- **Flags:** `uncertain` (a `?` anywhere, 202 entries), `bracketed` (13), `range` (22), `incomplete_entry`
  (one of the three lines is missing in the source, 8), `partial_on_drawing` (block broken or only partly
  drawn, 11).
- **Corrected coordinate:** Tablet of the Sun "G11" is printed twice (pp. 85-86). The first one is H10, by
  reading order and its gloss, and is flagged `coord_corrected`.

**Rights.** Stuart describes the sourcebook as open access and a basic public resource:
`rights.permission` = "granted: open access per David Stuart to Derek Lomas 2026-10-18". The drawings are
credited as the sourcebook prints them: p. 24 "Drawings by D. Stuart" (TC alfardas); the TFC alfardas are signed
"L. Schele '78". The other drawing pages have no credit line, and most of the sourcebook's drawings are Linda
Schele's. The PDF is not in this repo.

## Rebuild

Needs PyMuPDF, Pillow and numpy (a venv is enough).

1. `readings.py <pm.pdf> <work>` → `<work>/readings.json`. Each `<coord>:` label is parsed by font: bold = transliteration,
   italic = transcription, roman = translation. Long Count date tables are skipped.
2. `grid.py <pm.pdf> panels.json <work>` → `<work>/cells.json` and `<work>/overlays/`. Each panel of each drawing
   is cut into its printed column letters and row numbers. Gutters come from the ink profile, or from
   hand-checked `xcuts_pt`/`ycuts_pt` where the profile was wrong (façade, caption, jambs, alfardas, secondary
   texts). Crops are rendered at the drawing's native resolution.
3. `build.py <pm.pdf> <work>` → `<work>/out/blocks.jsonl` and `out/img/`. `checks.json` holds the by-eye decisions:
   drops, partial blocks and the coordinate fix.
4. `sheet.py <work>` → labelled contact sheets. Check every sheet by eye before loading.
5. `node --env-file=.env.production.local scripts/learn/maya-blocks/load-maya-blocks.mjs <work>/out [--apply]`.
   Dry run without `--apply`; idempotent. It refuses any image without a granted permission, then reads back
   the counts by monument and fetches one image.

**Known limits.** The crops follow a regular grid. Where a block spills past its cell, or a cell clips part of
a neighbour, the crop holds a sliver of the neighbouring block. Stuart's readings of eroded blocks rest partly on
context, so a crop may show less than the reading claims. Use `partial_on_drawing` and `uncertain` to keep
these out of a "legible" eval set.
