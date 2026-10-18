# Maya sign reference set (`maya_signs`)

One Mongo document per glyph drawing, from two published sign charts, for the glyph-reading
evals (#6903) and the Learn Maya loop (#6921).

PRIOR ART: round 1 of #6903 built a 605-row TEXT sign catalogue (Bonn TWKM + Montgomery) in its job
scratch on l7a. It has values and concordances, but no drawings tied to values, and drawings are what
the models were missing. `learn_maya_items` (#6926) holds learner items, not reference signs.

## What is in it (loaded 2026-10-18)

| source | kind | docs | image |
|---|---|---|---|
| David Stuart, *Maya Hieroglyph Syllabary* v2 (2013) | syllabogram | 147 drawings + 15 empty cells | R2 `reference/maya/stuart-syllabary-v2/` (public URL) |
| Kettunen & Helmke, *Introduction to Maya Hieroglyphs*, 20th ed. (Wayeb 2025), App. N | syllabogram | 170 | stored in the doc (`image.data`), no URL |
| same, "potentially confusing signs" (printed p. 86) | confusable | 39, in `confusable_group`s | in the doc |
| same, Concise Dictionary of Maya Logograms (pp. 87-96) | logogram | 88, with transliteration, transcription, translation, alternative spellings | in the doc |

Every doc carries `source_ref` (title, authors, edition, URL, PDF page and box), `rights`, and `checked`
(every crop was viewed on a labelled contact sheet against its source page).

**Rights.** Stuart gave permission to Derek on 2026-10-18 (exact scope being confirmed), so his
drawings have public URLs and carry the credit line "Drawing © David Stuart, used with permission".
The Wayeb handbook is a free download with no licence stated: its drawings stay inside Mongo for
private research use, and the loader will not upload any image whose `rights.permission` does not
start with `granted`. Ask the authors before showing them to readers. Neither PDF is in this repo.

## Rebuild

1. Download both PDFs (URLs in `build.py`). For Stuart: `pdfimages -j` (the five grids are 150 ppi
   scans), then `stuart/seg.py <dir> 5` → `cells-d5.json`, `stuart/final.py <dir> stuart/ovr.json`
   (merges nested boxes, flags `?`, applies the two hand splits in `ovr.json`), `stuart/crops.py`.
2. Wayeb: `pdftohtml -xml -f 84 -l 98 -zoom 1` into `<dir>/x/` and `pdftotext -bbox -f 88 -l 88` to
   `<dir>/p88.html`, then `wayeb/parse.py <dir>`. Each glyph is its own embedded image, so no cropping.
3. `build.py <stuart-dir> <wayeb-dir> <out>`; check `sheet.py` contact sheets by eye.
4. `node --env-file=.env.production.local scripts/learn/maya-signs/load-maya-signs.mjs <out> [--apply]`
   (dry run without `--apply`; idempotent).

Known gaps: empty cells of the Wayeb chart are not recorded; the parse keeps the handbook's text
verbatim, including two rows where two senses share one image (K'AN).
