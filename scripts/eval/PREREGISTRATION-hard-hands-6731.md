# Preregistration: Gemini 4 Argon on the hardest hands — Greek manuscripts and Rashi script (#6731)

PRIOR ART: `PREREGISTRATION-ocr-pareto-6293.md` Amendment 4.1 and `experiments/2026-10-14-gemini-4-argon-low-hard-panels-6707.md` (#6707) — the same three-arm CLI route, the ONE FAILURE RULE and the paired-Δ decision rule, on the hard *print* panels; neither has a Greek-manuscript or a Rashi panel. `experiments/2026-10-06-greek-manuscripts-full-kraken-fit-5619.md` (#5619) is where the Greek pages and their edition spans come from (FIT_RULES v2, used unchanged). `scripts/lib/sefaria-fit.mjs` (#5560) is the Hebrew stream, `locate` and Sefaria markup cleaning used unchanged. `lib/edition-window.mjs` `alignTrimWindow`/`alignSpan` and `lib/metrics.mjs` `normalizeForScript`/`windowedErrorRate` are the scorer, unchanged.

This file is committed and pushed **before any arm reads a page**. Job `hardhands-6731`, 2026-10-14. Benchmark only: Mongo read-only, no production writes, no routing change. $0: every model call goes through the `agy` CLI on the subscription; no paid API for any model.

## Question

Derek, 2026-10-14: does Gemini 4 Argon read the hardest hands better — Greek manuscripts and Rashi script? Neither is on `/quality/pareto`. Per script: is G4L better, the same or worse than 3.8 Flash, Opus 5.5, the stored production OCR and (Greek) Kraken?

## Arms

All through `scripts/eval/run-cli-arm.py --kind ocr` (tool gate + `<<<BEGIN>>>/<<<END>>>` markers, #6523), `--print-timeout 300`, one page image per call, `--parallel 2` (another job shares the account: at most 2 image calls of this job in flight), one arm at a time.

| arm | model id (agy) |
|---|---|
| **G4L** | `gemini-4-argon-low` |
| **C38L** | `gemini-3.8-flash-low` |
| **OPUS** | `claude-opus-5-5-medium` |

- **Prompt:** the live default OCR prompt, `prompts` `{type: ocr, is_default: true}` — "Standard OCR" v19.1, `content_hash 9d8f959e053491362b2c4acec1e20c9a` — with the auto-detect language slot (`scripts/lib/live-ocr-prompt.mjs`, as `scripts/batch/cli-ocr.mjs` sends it). The run stops if the hash differs at read time.
- **Images:** the page's stored image (`archived_photo` or `photo`), long side capped at 3,000 px (JPEG q90). No other preprocessing.
- **Stored comparators, scored on the same pages:** production OCR as stored on the page (`ocr.data`; its engine is `ocr.model`, recorded per page — `gemini-3-flash-preview` on nearly all of these Greek pages); Kraken 7.1 `greek-cllg` from #5619 (`/mnt/HC_Volume_105839809/greek-ms-align-5619/kraken-full/<book>-<page>.txt`, Greek only). No new Kraken reads.
- **Quota:** on `run-cli-arm.py` exit 3, sleep to the quoted reset and resume, at most 3 times; a fourth quota event stops the run and what was read is reported as such.
- G4H (*high*) is not run (#6707: ~13 min/page, asks for tools).

## Greek manuscripts

**Books (5):** Grec 1841 (`69a5e5e985fa13e734e41cba`) and Grec 1839 (`69a5e5e385fa13e734e41894`) → Schneider 1847; Marcianus gr. 299 (`6a45298cc6d95bc278fbc8c3`) and Ars sacra (`69b4c04d978ca9526eda33f7`) → Berthelot–Ruelle; Psellos (`69938921ce15387065946912`) → Schneider.

**Qualifying pages.** From the #5619 fit files (`fit-<book>-<edition>-kraken.json`), a page qualifies if the neighbour method fitted it (`neighbour[]` row: span `[end(N−1), start(N+1)]`) and that span's edges agree with the page's own fitted edges within one line: `|start_err| ≤ letters_per_line` and `|end_err| ≤ letters_per_line`, verdict not `edges`. A book with fewer than 15 Kraken-qualifying pages adds pages qualifying by the same rule in its Flash fit (`…-flash-v2.json`, the stored production read); expected for the Psellos only (Kraken 0, Flash 4). Those pages are selected by the production read's own fit, so the vs-production Δ is also reported without them.

**Draw.** Up to 15 per book: qualifying pages ordered by `sha256("hardhands-6731|<book>|<page>")`, the first 15 taken. Counts in the pool today: Grec 1841 224, Grec 1839 561, Ars sacra 81, Marcianus 43, Psellos 0 (+4 Flash-fit).

**Spreads.** Every Grec 1841 image is a two-page spread (aspect 1.47). The brief allows one-column page images only, so each Grec 1841 spread is cut at the gutter (the lowest-variance pixel column within 45–58 % of the width) into two page images; each arm reads the two halves in **two calls**, and the two reads are joined (left page, then right) as the spread's read. The scoring unit stays the spread, because the fit is per spread. Production and Kraken read the whole spread. Every other book's images are single pages (aspect 0.56–0.90) and are read whole.

**Reference.** The edition span `[a − L, b + L]` (L = the book's `letters_per_line`) from the fit's Greek letter stream (`greek-ms-fit-5619.mjs` `buildGreekStream` over the same edition pages), mapped back to the edition's text. It is then trimmed with `alignTrimWindow` (letters = Greek after the fold; `minLetters` 80, CER < 0.5) over every scored read of the page (G4L, C38L, OPUS, production, Kraken): the reference is the union of what the reads align to, never wider than the fitted span ± one line. The edition is the editor's text (accents, expanded abbreviations, emendations), not a diplomatic transcription; every reader shares that floor.

## Rashi script

**Candidates.** Live Hebrew/Aramaic books (`visible`, `pages_count > 0`, Hebrew or Aramaic in `language`/`original_language`/`languages`) that are prints dated 1470–1950 (not manuscripts by title or date): **107 books, 39,143 pages** today (the "≈ 111 books, ≈ 35K pages" of #5125). The list is committed as `results/hard-hands-6731/rashi-candidates.json`.

**Classification (before any read).** One interior page per book: the page with an image at the seeded position `floor(u · n)` in the middle 30–70 % of the book's pages, `u` from `sha256("hardhands-6731|class|<book>")`. Opus 5.5 (this job's session) views the image and labels it `rashi` (body text in Rashi/semi-cursive type), `square`, `mixed` (both, e.g. Bible text with Rashi-type commentaries) or `other` (no Hebrew text, plate, blank). Each label is recorded with a one-line note in `results/hard-hands-6731/rashi-classification.json`.

**Eligible books.** Classified `rashi` or `mixed`, AND the Rashi-type text on the page has a Sefaria text (looked up through `https://www.sefaria.org/api/v2/index/<title>` and fetched from the public export, `json/<categories>/<title>/Hebrew/merged.json`). The book → Sefaria-title mapping is committed as `results/hard-hands-6731/rashi-sefaria-map.json` before any read. Canonical commentaries are preferred (Rashi on Torah for a Mikraot Gedolot, Rashi on the tractate for a Talmud), but any Rashi-type text with a Sefaria text qualifies (Zohar, kabbalah, halakha).

**Draw.** At most 12 eligible books, ordered by `sha256("hardhands-6731|book|<book>")` if more qualify; per book, interior pages (10–90 %) ordered by `sha256("hardhands-6731|page|<book>|<page>")`. Each drawn page's image is viewed and kept only if it carries Rashi-type text of the mapped work (not a title page, plate, index or square-only page; recorded); the next is drawn until **5 per book** (≈ 60 pages read, aiming at ≈ 40 aligned) from **≥ 10 books**. If fewer than 10 books are eligible, the per-book quota rises to keep ≈ 60 pages, and the shortfall is reported.

**Reference: windowed alignment to Sefaria.** For each read page:
1. Every read (G4L, C38L, OPUS, production) is located in the mapped Sefaria stream (`sefaria-fit` `buildStream` + `buildIndex(k=7)` + `locate`). The consensus position is the one supported by the most reads (positions within 3,000 letters count as one).
2. Window = stream letters `[pos − 3,000, pos + max read letters + 3,000]`.
3. Every read is aligned to the best substring of the window (`alignSpan`, letters, free skips at both ends). A read *aligns* when its letter CER over its span is < 0.5 and the span is ≥ 80 letters (the `alignTrimWindow` rule).
4. Reference = `[median start, median end]` of the aligning reads' spans when ≥ 3 align, their union when 1–2 align. The median keeps one reader that runs on from memory past the page block from widening the reference for all.
5. **Threshold:** a page leaves the set (counted, reported) if no read aligns, or if the reference is < 150 letters. The Rashi block is the reference; the page's other blocks (the Bible text, other commentaries) are free leading/trailing material in the read, but text read between two parts of the Rashi block is charged, as for any engine.

**Memorisation control.** 15 kept pages (seeded by `sha256("hardhands-6731|memo|<uid>")`, preferring pages whose reference is Rashi on Torah or Talmud), each arm asked **without the image**: "Recite from memory, in Hebrew, the text of <Sefaria title> on <first ref> to <last ref> (the refs the reference spans), as printed in a traditional edition." + the marker instruction, `run-cli-arm.py --kind ocr` with no image. Scored like a read against the same reference. Reported per arm beside that arm's image read of the same pages. If an arm's recall accuracy is within 10 points of its image read, that is said plainly: on those pages the score cannot tell reading from recitation.

## Scorer

- **Greek:** `normalizeForScript(·, 'greek')` (`SCRIPT_DEFS.greek`: lowercase, every combining mark stripped, final/lunate sigma folded, α–ω only) on reference and read; CER = `windowedErrorRate` (fitting alignment: leading/trailing read text free, interior insertions charged), capped at 1. Accuracy = 1 − CER.
- **Hebrew (added for this run, `hard-hands-6731/hard-cer.mjs`, fixtures under `scripts/eval/fixtures/hebrew/` pinned by `tests/unit/hard-hands-cer.test.ts`, #5123):** Sefaria markup dropped first (`sefaria-fit` `cleanSegment`: footnote markers and inline footnotes removed with their content, HTML tags dropped), then the existing `SCRIPT_DEFS.hebrew` fold (maqaf → space, niqqud and te'amim U+0591–U+05C7 stripped, final forms folded, א–ת only). `SCRIPT_DEFS.hebrew` is used as it is; **no other script's normalisation changes.** Same `windowedErrorRate`, capped at 1.
- **ONE FAILURE RULE:** a read that is empty, a timeout, cut by Gemini's filter, or a refusal in the model's own words is **counted, not scored**. A read that comes back doubled (restart inside the markers, #6707) is scored as returned: the fitting alignment does not charge the trailing copy.

## Analysis (per script)

- **Accuracy** per arm = 1 − mean CER over scored pages (units: Greek pages, Grec 1841 spreads; Rashi pages), with a **page-bootstrap 95 % CI** (2,000 resamples, seeded by `sha256(script|arm)`); n pages and n works.
- **Paired:** for G4L vs C38L, vs OPUS, vs production, vs Kraken (Greek): median per-page CER difference (G4L − other; negative = G4L better) on pages both scored, bootstrap 95 % CI, W/L/T, sign-test p.
- **Verdict per comparison:** *better* / *worse* only if the CI excludes 0 **and** |median Δ| > 1 point; otherwise *same*.
- **Failures:** refusals, empties, filter cuts, timeouts per arm; tool calls refused by the gate; seconds per call (median, IQR).
- **Worst pages:** the five worst G4L pages per script, read against the image by eye (label `read-from-image`), naming the error kind: abbreviations, ligatures, lines dropped, invented text, reading order.
- **Grade (eval-design):** 5 Greek works and ≥ 10 Rashi books: **directional**. One plain verdict line per script. No routing change follows from this run.

## Order

1. This file, pushed. 2. Rashi classification and draw (image views, no arm reads); Sefaria map committed. 3. **Smoke:** G4L on 5 Greek pages (the first five of the draw by seed order); if most of the five fail (empty, refused, timeout), one BLOCKED comment on #6731 and stop. 4. Full run: all arms, both scripts, then the memorisation control. 5. Report on #6731, experiment file, PR "Closes #6731".

## Amendment 1 (2026-10-14 ~21:05 UTC, before any scored arm read)

- **Quota.** At 20:30 and again at 20:48 UTC, `gemini-4-argon-low` and `gemini-3.8-flash-low` returned "Individual quota reached … Resets in 18h23m" (quota event 1). G4L and C38L therefore wait for ~15:10 UTC on 2026-10-15; the smoke runs first then, as preregistered.
- **OPUS route.** `claude-opus-5-5-medium` through agy read 2 Greek half-spreads, then returned "Individual quota reached … Resets in 161h5m0s" (the agy Claude pool's weekly cap). Waiting 6.7 days is not workable, so **the OPUS arm goes through the Claude CLI on the subscription instead** ($0; no API key: `ANTHROPIC_*` is stripped): `claude -p --model claude-opus-5-5 --restricted --tools Read`, one page per call in a sealed one-file folder, as `scripts/batch/claude-ocr.mjs` (#6559) runs Opus OCR (`hard-hands-6731/run-claude-arm.py`). Same live prompt (v19.1, hash checked), same marker instruction, same images. Differences from the agy route: the CLI's own system prompt, no effort setting (the CLI default, not "medium"), and the model opens the image with the Read tool instead of an `@` attachment. The 2 agy OPUS reads and 1 route-check read through the CLI are kept in the raw files and **not scored**. The arm is reported as "Opus 5.5 (Claude CLI)".
- **Production text that is not an OCR.** On some Rashi-type pages `ocr.data` was written from Sefaria by #5560 (`ocr.model` = `sefaria/<title>`, found while testing the scorer on stored text only, before any arm read): that text *is* the reference. On those pages the production cell is counted as `not_ocr`, never scored, and never used to place the reference.

## Amendment 2 (2026-10-15 ~19:20 UTC, after the reads; found by CI's page-image-pick check)

- **Wrong image on 22 Rashi pages.** `prepare.mjs` took `archived_photo || photo`. For pages split from a spread, `archived_photo` is the WHOLE spread; the page's own image is `cropped_photo` (or `photo` when `split_from_spread`), which `getPageSource()` returns. 22 of the 60 drawn Rashi pages are split records: all of Sha'arei Orah 1715 (5), Shenei Luchot ha-Berit (5), Zohar Chadash (5), Pardes Rimmonim (3) and Tikkunei ha-Zohar (4). Each arm read the whole spread for them, while the stored production OCR read the half page. No Greek page is affected (Grec 1841's spreads are not split records; the run cut them itself).
- **Correction:** those 22 pages are re-read by all three arms on the page's own image (`getPageSource`), and the spread reads are kept in the raw files but not scored. The reference is rebuilt from the new reads by the same rule. The page selection does not change. Before the re-read, results computed on the spread reads were posted on #6731; they are superseded by the corrected numbers.
