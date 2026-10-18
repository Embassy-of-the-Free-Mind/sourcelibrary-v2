# Chinese held residue: reference pages per failure class (#6871 item 3)

PRIOR ART: `scripts/audit/gpu-queue-5660.mjs` (the 47,420 total, not split by class); the class lists made by
jobs gpu-resume-5660 / zh-paddle-resume (#5660, 2026-10-06/07); `scripts/eval/results/gpu-resume-5660/zh-stress/`
(by-eye verdicts on *Paddle's* reads of stress pages; those are verdicts, not reference text). No reference text
existed for any of these pages.

This is the **gate** for #6871 item 3: an engine bake-off on the GEX45 GPU (Paddle with layout and tables, MinerU,
a VLM…) over the Chinese pages Paddle could not be trusted on. It is a reference set, nothing else. No GPU, no
OCR engine, and no writes to `pages` were involved. Built 2026-10-17 by job `zh-residue-refs-6871`.

## 1. The residue, recounted (Mongo, 2026-10-17 22:23Z, exact counts)

`node --env-file=/root/sourcelibrary/.env.production.local recount.mjs` → `recount.json`. "Unread" = no
`ocr.data`. Population = books held `gpu-backlog-5660` (3,481).

| class | definition (book lists in `classes.json`) | books with unread pp | unread pages |
|---|---|---:|---:|
| table | 109 table-heavy works, title rule 表/圖/曆/算/律呂/樂譜/切韻/七政… | 109 | **15,280** |
| mixed | 131 mixed-script books (127 unread + the 3 清文鑑 vols written then reverted + 1), title + preview-script rule | 130 | **17,784** |
| seal | 42 seal/clerical/inscription works (`dedup.json → held_seal_script_5660`, main box, never committed until now) | 42 | **5,878** |
| reverted | the pages in `page_revisions` source `revert-paddle-5660` (2026-10-10), still empty 372/372 | 11 | **372** |
| other | every other held book's unread pages (not in the brief; found by the recount) | 2,400 | **8,106** |
| **total** | | | **47,420** (matches `gpu-queue-5660.mjs`) |

The issue's "109 / 127 / 42 works" were book counts; the page split above is new. The 15,280 and 5,878 differ from
the "16,643 pp" and "≈ 7.9K pp" quoted at hold time because those counted whole books, including their 25 Gemini
preview pages per volume, which already have text.

## 2. The draw (`draw.mjs` → `draw.json`, seed 6871)

- Per class: 24 books uniformly at random (20 + 4 spares), **one page per book**, uniform among the book's unread
  pages in the body window `[10%, 95%]` of `pages_count`. Two alternates per book were drawn at the same time.
- A drawn page that the readers marked `blank` or `non-body` (cover, fold-strip-only leaf) was replaced by the
  book's first alternate. That happened once each in table, mixed, seal and reverted (`reads/replacements.json`).
  `other` was **not** replaced (see §5).
- **reverted** has only 11 books, so one-per-book cannot give 20: all 8 single-page books + 4 random pages from
  each of the 3 清文鑑 volumes.
- Images: `pages.photo` for each page, i.e. the Internet Archive IIIF full image (≈ 1,900×2,700 px). The URL is
  in every reference row. Readers got the full page plus halves and quarters cut from it.
- Same-work repeats are allowed, since the unit is the book (volume): table has 2 volumes of 易圖明辨 and 5 of
  欽定詩經樂譜全書; mixed has 13 of 御製律呂正義後編.

## 3. How the references were made

All readers were Claude Opus 5.5 (`claude-opus-5-5`) running as Claude Code subagents on the subscription, with
the images opened. Nothing went through agy. There were 10 pages per call.

1. **Pass A**: 10 calls, batches shuffled across classes (seed 11). Readers were not told the class.
2. **Pass B**: 10 calls, a different shuffle (seed 22). Each reader was told not to open pass A's files.
   Brief: `READER-PROMPT.md`, the same text as A.
3. **Pass C (resolver)**: run on every page where A and B differed in their Han string or page kind (65 of 100).
   The resolver saw both reads blinded as X/Y in a random order (`reads/pairs_map.json`), plus the image. It
   decided each disagreement from the image and recorded each one (`resolutions`, with basis
   `image|convention|unresolvable`). It could also overrule spots where A and B agreed. Brief: `RESOLVER-PROMPT.md`.
4. **Final** = C where it ran, else A (A and B agree). → `refs.jsonl`, one row per page: `page_id, book_id,
   title, page, image_url, cls, page_kind, layout, layout_note, text, margin, foreign[], n_han, uncertain[],
   confidence (final reader's own), confidence_A/B, readers, resolved, resolutions[], unresolvable_chars, ab_cer,
   model, date`.

Raw reads: `reads/{A,B,C}.jsonl`. To re-score: `python3 compare.py reads draw.json reads/replacements.json`
gives `agreement-AB.json`, and `python3 assemble.py reads draw.json reads/replacements.json reads/pairs_map.json`
gives `reliability.json` + `refs.jsonl` (reproduces byte for byte).

### Convention (full text in the two briefs)
- Traditional characters as printed, with variant forms kept (㑹, 隂, 葢, 冨…). **No punctuation added.**
- Columns right to left, each top to bottom, **one line per printed column**.
- Double-line small notes go inline in `〔…〕`, right sub-column then left.
- Tables: cells separated by ` | `, one line per table column, or per row where rows are the unit (stated in
  `layout_note`). Digits printed side by side in a cell are written left to right.
- Seal, clerical and archaic **head glyphs** are written as the regular-script character they stand for, in `⟨…⟩`;
  `⟨□⟩` where it cannot be identified.
- Non-Chinese script gets a placeholder in `text` (`[滿文]`, `[蒙文]`, `[藏文]`, `[other]`), plus a
  transliteration attempt in `foreign[]` with a confidence (`null` allowed).
- `□` = an illegible character. `▣` (added in pass C) = a clearly visible glyph with no Unicode character the
  reader could confirm, e.g. qin/se tablature composites or rare characters. Its components are given in `uncertain`.
- The fold strip and running title go in `margin`, not `text`. Collectors' seals are ignored.

## 4. How reliable each class's reference is

A/B = disagreement between the two independent reads, on Han characters (□ removed; ○ and 〇 folded to one
symbol). It is character-weighted over pages with ≥ 20 Han characters.
- *order* = Levenshtein, the number a scorer sees.
- *bag* = order-insensitive. *order* minus *bag* is disagreement in reading order only.
- *A→final* and *B→final* = how far a single read sits from the resolved reference.
- *agreed-but-corrected* = places where A and B agreed and the resolver changed the reading from the image. This
  is evidence that two Opus reads share errors.

| class | text pp | Han chars | A/B order | A/B bag | pp > 10% | A→final | B→final | unresolvable | agreed-but-corrected | verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| table | 20 | 3,488 | 14.0% | **2.0%** | 4 | 12.9% | 2.2% | 16 | 2 | **credible for characters; not for table reading order.** See below |
| mixed | 19 | 2,123 | 7.5% | 5.5% | 4 | 7.2% | 2.7% | 63 | 3 | **credible for the Chinese; no credible reference for the Manchu/Mongolian/Tibetan script** |
| seal | 19 | 2,466 | **3.2%** | 3.2% | 1 | 2.4% | 2.0% | 10 | **13** | **credible for the regular-script text; the seal head readings are provisional** |
| reverted | 19 | 3,018 | 8.0% | 4.6% | 8 | 4.5% | 5.8% | 40 | 8 | **split**: non-清文鑑 pages credible (3.8%); 清文鑑 pages not (below) |
| *清文鑑 pages (mixed + reverted)* | 13 | 1,326 | **20.0%** | 11.3% | 9 | 13.7% | 10.1% | 79 | 3 | **no credible model reference** |
| other | 1 | 300 | — | — | — | — | — | 2 | 1 | 19/20 are textless or near-empty (§5) |

Per the brief's rule (two Opus reads disagree on more than ~10% of characters → "no credible model reference"):

- **清文鑑 pages (御製增訂清文鑑, 三合切音清文鑑): no credible model reference.** Two reads disagree on 20% of
  the Han characters. Those characters are the tiny Chinese phonetic spellings beside the Manchu (三合切音), set in
  two sub-columns, with characters written across both. The main disagreement is which character goes in which
  sub-column, and a second is reading glyphs at this resolution. For the Manchu script itself, the two reads gave
  the same transliteration on 21 of 98 tokens; the median self-rated confidence was 0.3; 223 of 312 placeholders
  were never transliterated. **What would be needed:**
  - a reader of Manchu, or alignment to an existing digital text of 增訂清文鑑 (the Manchu–Chinese headword lists
    are published in digital form), for the Manchu and the phonetic spellings;
  - a convention decided in advance for the order of 三合切音 components (the resolvers did not apply one rule the
    same way);
  - the full-resolution jp2 instead of the IIIF derivative.

  These pages are 14 of the 100 drawn. In the residue, 15 books have 清文鑑 in the title, with **2,772 unread
  pages** (364 of them the reverted pages); counted by title on 2026-10-17.
- **table: credible for characters.** Order-insensitive disagreement is 2.0%. The 14% order-sensitive figure
  comes from:
  - one 710-character ephemeris table (御製歷象考成·表 卷七), read by row in both reads but with cells in opposite
    directions (bag 0.1%, order 56%);
  - two se-zither tablature pages, where one reader wrote look-alike characters and the other wrote `□`.
  
  Tablature glyphs are `▣` in the final (146 in the class). They have **no reference**, because no Unicode
  character exists for them. **Score tables order-insensitively** (bag CER, or cell-level), and exclude `▣`.
- **mixed (without 清文鑑): credible.** 3.3% order-sensitive. Most pages are 律呂正義後編 prose and scores. The 工尺
  notation marks and the Manchu lyrics on score pages are the weak spots. Manchu has no reference, as above.
- **seal: credible by the rule (3.2%; head glyphs 5.9% over 171 heads), but agreement overstates accuracy here.**
  Both readers named most seal heads **from the gloss printed under them** and said so. Their errors are therefore
  correlated: the resolver overruled the agreed reading 13 times (蛇鮮→蛇鱓, 雨元切→兩元切, 夂/夊→𠔾, 娼→媢…). Treat
  the `⟨…⟩` head readings as provisional. An engine that reads the gloss and invents the head is scored the same
  as one that reads the head. Score head glyphs separately from the regular-script text (`compare.py` extracts
  them), and give the gloss text the main weight.
- **reverted (non-清文鑑: 康熙字典, 佩文韻府, 圖書編, 西清古鑑): credible** (3.8%). The exception is the
  西清古鑑 bronze-inscription ring diagram: its inner ring is mostly `⟨□⟩`, with 14 characters unresolvable.

## 5. "other": the 8,106 unclassed pages are almost all textless

Of 20 drawn pages: 11 are non-body (covers, fold-strip-only leaves), 2 are blank, 6 are end-of-volume leaves
carrying only the closing title (6–7 characters, e.g. 墨莊漫錄卷三), and 1 is a real text page (欽定音韻述微).
That is **19/20 textless or near-empty, Wilson 95% CI 76–99%**. Paddle's empty result was correct on these. The
class needs no engine. Its 20 references are kept as a **hallucination check**: an engine should return nothing,
or only the closing title, on them.

## 6. What this does not do
- **It is not a human reference.** Every reader is the same model. Agreement between two Opus reads is a lower
  bound on Opus's error, not a measure of accuracy (eval-design: agreement ≠ accuracy). The 27 agreed-but-
  corrected cases show that the bound is loose, especially on seal pages.
- I checked two finals against the image myself (律呂正義後編 p50, 說文繫傳 p11), and both match. I am the
  same model, so that is not an independent check.
- `confidence` is each reader's own estimate (mean 0.89–0.97 per class). It is reported as given and not
  calibrated.
- No engine was run, and Paddle's reads of these pages were not compared. Those are the bake-off's job.
- Image resolution: readers saw the IIIF derivative, cropped. A few `□`/unresolvable characters are resolution-
  bound.

## Files
`classes.json` (class lists + provenance) · `recount.mjs` → `recount.json` · `draw.mjs` → `draw.json` ·
`READER-PROMPT.md`, `RESOLVER-PROMPT.md` · `reads/{A,B,C}.jsonl`, `reads/{replacements,pairs_map,batches_*}.json` ·
`compare.py` → `agreement-AB.json` · `assemble.py` → `reliability.json`, **`refs.jsonl` (the reference set)**.
