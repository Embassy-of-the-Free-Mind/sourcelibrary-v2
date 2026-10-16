---
stage: ocr
measure: none
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 221
n_pages: 12214
verdict: "Yigdzin read 6,933 empty pages in hidden Tibetan books; 5,145 passed v4 + first-ocr-guard + 150 syllables and are written, 0 invented in 7 opened against the image, €1.50 GPU."
status: adopted
decision: "Same read and write rule as yigdzin-rest-4523, run on the hidden Tibetan books (DECISION default, parent session 2026-10-14); 5,145 pages served from Yigdzin (run yigdzin-leaf-2026-10-14-hidden)"
superseded_by: null
issue: 4523
---
## 2026-10-14 · Yigdzin read of the hidden Tibetan books: 5,145 of 12,214 candidate pages written (#4523, job yigdzin-hidden-4523)
<!-- PRIOR ART: 2026-10-14-yigdzin-rest-withheld-and-unread-tibetan-4523.md (yigdzin-rest-4523, #6717): same scope script, worker, judge, guard and apply. That run took the live books and left the hidden ones as a decision; this is that decision at its default. -->

**Question.** Run the yigdzin-rest-4523 read and write rule on the withheld or empty pages of the HIDDEN Tibetan books.

**Frame.** 638 hidden Tibetan books (`language: Tibetan`, `visible` not true). `scope-rest.mjs` takes them with
`YIG_VISIBILITY=hidden`. Every other rule is unchanged.

**Why 12,214 and not the 24,929 in the brief.** The estimate in the rest-4523 record subtracted the excluded
books but not the other skips that `scope-rest.mjs` applies:
- 8,143 pages already have a Yigdzin REJECT from yig527 or #5660. At temperature 0 the read and the verdict would be the same.
- 3,996 pages sit in books held by another lane: `kangyur-import` 2,914 and `warehouse-promotion-5470` 1,082.

**Skipped before any read** (a withheld Gemini / b no OCR):
- Excluded books (yig527 list, e.g. the Taishō): – / 19,835.
- Book not held: 475 / 2,251. A write would create an untranslated page in an unheld book.
- Book held by another lane: – / 3,996.
- Prior Yigdzin REJECT: – / 8,143.
- Book gate, by eye: – / 375 (below). Non-positive page number: – / 79.

**Book gate by eye.** 23 books with candidate pages have no Gemini text, so the script gate has nothing to count.
Two mid-book images each (one where the book has a single candidate page):
- **21 are Tibetan**: blockprints, dbu med manuscripts and modern prints. Some of the candidate pages are blank leaves.
- **2 stay out**:
  - *Yuktiṣaṣṭikāvṛtti* (`6a37d7e4…`) is a Sanskrit palm leaf in Nepalese script.
  - *A Dictionary Tibetan and English* (`69bc8039…`) is bilingual. Yigdzin would drop the English.
- The verdicts are in `$YIG_DIR/eye-books.json`, which `scope-rest.mjs` already reads.

**Recipe.** Unchanged from yig527 / rest-4523:
- `yig_leaf_worker.py` per leaf, BDRC/tibetan-ocr `50506eb6`, vLLM 0.29.0;
- v4 judge against an empty reference;
- `guard.mjs`: written only if `first-ocr-guard` does not flag the page **and** it has ≥ 150 syllables;
- `apply-reocr-verdicts --model=bdrc-yigdzin-v1 --read-mode=leaf`, with the snapshot to `page_revisions` before any overwrite.

There was no separate pilot box. Apply stayed off until 3 pages from the first judged batch, in 3 books, had been opened against the image.
Hardware: 2 × L4-1-24G (fr-par-1, pl-waw-2), each leased through `gpu-lease-watchdog` (`idle-stop on mongo:bdrc`
once the first apply landed) and run under `idle-poweroff.sh`. Tender cap €9.5.

| | (a) withheld Gemini | (b) no OCR |
|---|---|---|
| sent to the worker | 10 | 12,204 |
| worker skip: guttered image | 3 | 5,132 |
| worker skip: image < 5 KB | – | 146 |
| read | 7 | 6,926 |
| v4 reject | 5 (4 duplication, 1 validity drop) | 135 (15 / 120) |
| guard refuse | 0 | 883 (613 punct_noise, 128 dominant_unit, 62 local_loop, 47 numeral_loop, 22 line_loop, 8 blank_leaf, 3 repeated_line) |
| < 150 syllables | 2 | 763 |
| **written** | **0** | **5,145** |

**The guttered skip is most of what stays empty.** The worker refuses an image when its gutter detector sees a bound-book
opening rather than a pecha leaf. Here that is 5,135 pages, mostly in modern bound reprints. Examples: the
*rgyud-stod* ritual collection (761 pages), the *gnas-chung* liturgy (471), *Bar do thos grol* (429) and Ri-bo-che rje-drung (411).
Those pages need a page-format read. That is a different lane and was not run here.

**Refusal rate.** The guard refuses more here than in the live run: 13 % of judged-SERVE pages against 2 %.
`punct_noise` dominates. The hidden books include more faint or broken scans, and the guard is doing what it is for.

**Checked in Mongo after the run** (read-only, over the 221 frame books):
- 5,145 pages carry `ocr.engine.run = yigdzin-leaf-2026-10-14-hidden`, in 15 books. All of them are `bdrc-yigdzin-v1`.
- 0 written pages have a translation, and 0 are left `unreadable`. 0 pages outside the written set carry the run.
- All 221 books are still hidden: 0 `visible`. Holds: 220 `specialist-ocr-lane-4523`, 1 `gpu-backlog-5660`.
  Each is a #4523/#5660 lane hold, so no translation is queued.
- No scope-(a) page was overwritten. Every written page was empty before, so the snapshot holds empty text.

**By eye**, 7 written pages (`read-from-image`): 3 before apply was enabled (3 books), 2 mid-run, 1 from the last batch,
and the shortest written page.
- **0 invented, 0 wrong-leaf.**
- **6 clean.** They include a two-leaf dbu med manuscript whose red section marks fall where the read puts `༼ ༢༽`.
- **1 minor**: `69bd003a…_00409`. Every line's text matches the image, but the line breaks are lost, so the page is served as one line.
- n = 7 only rules out a high invented rate. The #5660 measurement (5 % [2–13 %] for unflagged pages ≥ 150 syllables)
  is the better estimate for this rule.
- Nothing needed containment.

**Spend.**
- GPU **€1.50**: 1.90 L4-h at €0.7875 (`sl-yighid-0` 0.81 h, `sl-yighid-1` 1.10 h). Gemini $0.
- The brief's estimate was €7–9 with a cap of €10. The difference is the smaller frame and the 5.3K worker skips, which cost no GPU time.
- Both servers and both volumes are deleted (API GET 404). No `sl-yighid-*` server and no unattached volume is left in
  fr-par-1/2/3, pl-waw-1/2/3 or nl-ams-1/2/3.

Files: `scripts/eval/results/yigdzin-hidden-4523/summary.json`, plus `page-outcomes.jsonl.gz`, one row per candidate
page with its outcome. Tooling: `scope-rest.mjs` with `YIG_VISIBILITY=hidden`. Everything else is as in #6717.
