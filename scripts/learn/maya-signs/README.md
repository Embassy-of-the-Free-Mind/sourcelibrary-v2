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
| Kettunen & Helmke, *Introduction to Maya Hieroglyphs*, 20th ed. (Wayeb 2025), App. N | syllabogram | 170 | R2 `reference/maya/wayeb-handbook-2025/` |
| same, "potentially confusing signs" (printed p. 86) | confusable | 39, in `confusable_group`s | R2 `reference/maya/wayeb-handbook-2025/` |
| same, Concise Dictionary of Maya Logograms (pp. 87-96) | logogram | 88, with transliteration, transcription, translation, alternative spellings | R2 (same prefix) |

| Bonn TWKM *Digital Catalog of Maya Hieroglyphs* (Grube, Prager et al.), snapshot 2026-10-18 (#6980) | logogram 678, syllabogram 370, numeric 41, diacritic 3, undeciphered 514 | 1,606 graphs, 1,582 with a Prager drawing | R2 `reference/maya/twkm-signcatalog/` (public URL) |

A TWKM doc is one *graph* (a sign variant, `graph_no` such as `796st`). It carries all its `readings` (value,
TWKM type, `conf_level`: **1 is the most secure, higher is less secure**, criteria, bibliography); `kind` and
`value` come from the most secure reading, and a phonogram is stored as `syllabogram`. It also carries `concordance`
to all 11 catalogs (with `thompson` and `macri_vail` pulled out), `translation`, `nicknames`, `iconography` and
`occurrence`. The full portal snapshot (decipherments, concordances, 7,826 bibliography rows, artefact zones,
places…) is in `maya_twkm`, one doc per entity row (`_id` = `<entity>:<id>`), **Mongo only**: TWKM states no
licence for the tabular data, so it never goes to the public bucket or this repo.

Every doc carries `source_ref` (title, authors, edition, URL, PDF page and box), `rights`, and `checked`
(every crop was viewed on a labelled contact sheet against its source page).

**Rights.** Stuart gave Derek permission on 2026-10-18 for open use ("a basic public resource");
credit "Drawing © David Stuart, used with permission". The Wayeb handbook is a free download with
no licence stated; on Stuart's advice (same day) it is treated as an open public teaching resource,
credited to Kettunen & Helmke on every use; the authors were not asked individually. The loader
uploads an image to the public bucket only when `rights.permission` starts with `granted`;
anything else stays inside the Mongo doc (`image.data`). Neither PDF is in this repo.

## Rebuild

1. Download both PDFs (URLs in `build.py`). For Stuart: `pdfimages -j` (the five grids are 150 ppi
   scans), then `stuart/seg.py <dir> 5` → `cells-d5.json`, `stuart/final.py <dir> stuart/ovr.json`
   (merges nested boxes, flags `?`, applies the two hand splits in `ovr.json`), `stuart/crops.py`.
2. Wayeb: `pdftohtml -xml -f 84 -l 98 -zoom 1` into `<dir>/x/` and `pdftotext -bbox -f 88 -l 88` to
   `<dir>/p88.html`, then `wayeb/parse.py <dir>`. Each glyph is its own embedded image, so no cropping.
3. `build.py <stuart-dir> <wayeb-dir> <out>`; check `sheet.py` contact sheets by eye.
4. `node --env-file=.env.production.local scripts/learn/maya-signs/load-maya-signs.mjs <out> [--apply]`
   (dry run without `--apply`; idempotent).

5. TWKM: fetch `https://classicmayan.org/portal/sc/client/data/data.en.json`, then each graph's drawing
   `https://classicmayan.org/portal/sc/client/data/images/graphs/<imgUrl>.jpg` (`imgUrl` from `graphs[]`,
   0.2 s apart) into one dir; `twkm/build.py <data.en.json> <graphs-dir> <out>`; then the loader above, plus
   `twkm/load-twkm-raw.mjs <out> [--apply]` for `maya_twkm`. Rights: Prager's drawings are CC BY 4.0
   (legal notice https://classicmayan.org/portal/doc/246); credit on every use.

Known gaps: empty cells of the Wayeb chart are not recorded; the parse keeps the handbook's text
verbatim, including two rows where two senses share one image (K'AN).

## ULB Bonn Maya archive (`maya_archive`, #6985)

Objects and their photographs/drawings from the *Maya Hieroglyphic Text and Image Archive*
(Universitäts- und Landesbibliothek Bonn, https://digitale-sammlungen.ulb.uni-bonn.de/maya), one doc per
ULB record: `kind` artifact (site, current location, Long Count / Calendar Round / Gregorian date,
material, extent, `images`) or photograph/drawing (`creator`, `date`, `licence`, `rights`, `image` on R2
under `reference/maya/ulb-archive/`). Records are CC BY 4.0, some drawings PDM 1.0; an image goes to the
public bucket only when its licence is one of those.
`ulb/build.py <out> <artifact-oai-number>…` then `ulb/load-maya-archive.mjs <out> [--apply]`. Loaded so far:
Yaxchilan, Lintel 21 (9605478), for a monument-page prototype (#6985) that was unpublished the same day: a
page of unordered sign lists is not a reading. Any new page waits on a block-ordering eval. The whole set's
oai_dc records (27,319) are loaded as an index by `ulb/load-oai-records.mjs` (#6988).
