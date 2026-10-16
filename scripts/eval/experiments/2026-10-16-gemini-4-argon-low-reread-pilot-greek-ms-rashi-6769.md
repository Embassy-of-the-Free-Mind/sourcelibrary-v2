---
stage: ocr
measure: judged
languages: [grc, he, arc]
scripts: [Grek, Hebr]
canons: []
n_books: 2
n_pages: 543
verdict: "One-book pilots, no writes. Against the page image, a blind Opus judge prefers the Gemini 4 Argon low re-read to the served text on 29/30 Grec 1841 spreads (0 worse) and on 25/25 Zohar Chadash pages served from flash-lite OCR. It prefers the served text on 5/5 pages whose text was fitted from Sefaria (#5560). As built, cli-ocr.mjs apply would write 5 of 355 Greek pages: the 40% shared-words guard refuses the other 350, because the stored read is that far from the page. On Rashi it would write 121 of 188, 30 of them over Sefaria text. G4L reads the left column first on 6 of 23 two-column Hebrew pages."
status: undecided
decision: null
superseded_by: null
issue: 6769
---
## 2026-10-16 · Gemini 4 Argon low re-read pilots: Grec 1841 and Zohar Chadash (#6769)
PRIOR ART: `2026-10-15-gemini-4-argon-hard-hands-greek-ms-rashi-6731.md` (the panel result this pilots: G4L 0.78 vs served 0.58 on Greek manuscripts, 0.83 vs 0.48 on Rashi; Amendment 2's spread-vs-page image fix), `2026-10-06-greek-manuscripts-full-kraken-fit-5619.md` (the 385-book Greek manuscript census used for the plan).

**Question (Derek, 2026-10-15).** #6731 found that G4L reads Greek manuscripts and Rashi script far better than the served text. Before re-reading these whole shelves, run one book of each through the real writer: does the apply write what it should, is the new text better against the image, and what would a write set off downstream?

**Design.** $0. No page was written; `apply` ran without `--apply`.
- **Books.**
  - Greek: Grec 1841 (Proclus, *In Timaeum*, 355 spreads). This page was named in the brief.
  - Rashi: the rule was "the lowest served accuracy in #6731 among the 12 books, ≥ 100 pages, visible". It picks Zohar Chadash (1702, 188 pages): served 0.22 on its 3 OCR-scored pages; G4L scored 0.77. Pardes Rimmonim was next (0.22, 348 pp).
- **Read.** `cli-ocr.mjs read --model=gemini-4-argon-low --concurrency=2`. This is the live OCR prompt, agy 1.3.6, on the page's own image (`getPageSource`). Grec 1841's page records are whole spreads, so they were read whole: #6731 cut them at the gutter. Pages that failed for transient reasons (503 "service unavailable", or a 300 s timeout) were re-run until they read: 3 passes.
- **Blind A/B (step 2).** `draw.mjs`: 30 pages per book, seeded random, from the pages with both a G4L read and served text. There were 5 more pages per book as **controls**: the G4L text against a copy of itself with planted errors (8% of words swapped for other words of the page, one middle line dropped).
  - Both texts were stripped of markup, so the judge cannot recognise a prompt generation by its format.
  - A/B order was randomised; ids were opaque.
  - The judge got the image whole plus two enlarged halves, long side ≤ 2,000 px.
  - The judge was Opus 5.5 through the Claude CLI (`judge.py`; never agy, no API key). It had to check ≥ 3 differing places against the image, then answer A / B / same. It also reported the column count and each text's reading order.
- **Column order (step 3).** On every page the judge saw as ≥ 2 columns, it reported order for each text. I (Opus, this job) read 5 of those images myself.

**Result: reads.**

| book | pages | final reads | transient failures retried | median s/page | wall s/page (2 at a time) |
|---|---|---|---|---|---|
| Grec 1841 | 355 | 355 ok | 13 (11 × 503, 2 timeouts) | 81 | 46 |
| Zohar Chadash | 188 | 187 ok, 1 timeout with partial text | 29 (26 × 503, 2 timeouts, 1 "model not recognised") | 82 | 49 |

- In all, the job made 586 G4L calls: 544 ok, 38 exit 1, 4 timeouts.
- There was no quota error. About 1,090 G4L calls ran account-wide in those 4.5 h.
- No read needed a nudge. Two Rashi reads were re-read by the chatter guard.

**Result: dry apply (step 1).**

| book | would write | refused | reasons |
|---|---|---|---|
| Grec 1841 | **5** (microfilm target, covers) | **350** | all "only N% of its words are in the stored read" (median 15%) |
| Zohar Chadash | **121**: 48 over flash-lite OCR, **30 over Sefaria-fitted text**, 43 onto empty pages | 67 | 66 shared-words guard (median 7%), 1 CLI timeout |

- No page was refused as human-edited, a loop, a refusal, chatter or over-long.
- No page was held. Neither book carries a pipeline hold, and the ya-btags hold is Tibetan-only.
- Folding accents and final sigma does not change the guard result (Greek median shared 0.15 → 0.16; 5 pass either way). So the guard is not tripping on orthography: the stored reads are simply that far from the page.

**Result: blind A/B against the image (step 2).** G4L vs served, 30 pages per book:

| book | G4L better | same | G4L worse | controls (clean copy chosen) |
|---|---|---|---|---|
| Grec 1841 | **29/30 = 97%** [83, 99] | 1 (a French microfilm notice) | **0/30** [0, 11] | 5/5 |
| Zohar Chadash, all | 25/30 = 83% [66, 93] | 0 | 5/30 = 17% [7, 34] | 5/5 |
| · served from flash-lite OCR | **25/25** [87, 100]: 13 the apply would write, **12 the guard refuses** | 0 | 0 | |
| · served from Sefaria (`sefaria-fit-5560`) | 0/5 | 0 | **5/5** | |

- 59 of 60 verdicts were "high" confidence. Every judge call opened all three images (4 turns).
- A slip let 8 requests run twice, and all 8 repeats gave the same verdict.
- On the Sefaria pages, the judge's notes match the image to the Sefaria text word for word: שבע אלפי עלמין, ולא קשיר קשרא. G4L misreads these, giving צבע and פקיד.

**Result: column order, Rashi (step 3).** The judge saw 23 of the 30 drawn Zohar Chadash pages as two columns.
- G4L gave the right column first on 17 of them and **the left column first on 6 (26%, [13, 46])**. That is the same left-before-right fault #6731 saw on spreads.
- The served text was in order on 12, interleaved line by line on 4, and not columnar on 7.
- I read 5 images myself, and all 5 agree with the judge:
  - p47: the right column's last line "…ללכת" runs on into the left column's "בהבלי העולם". G4L starts at בהבלי, so it is reversed.
  - p116: G4L starts with the ליקוטים column, not זהר כי תבוא. Reversed.
  - p154: G4L starts with "ומתמן שמעון · ריחא", not "עלייהו איתמר". Reversed.
  - p84: correct.
  - p135: correct. G4L places the bracketed side-gloss (אמ"ו בככ"י מצאתי כתוב…) after its anchor line.
- Two of the five images are mis-split. p84 carries a strip of the neighbouring page. p135's crop cuts off its own right column, and G4L leaves the cut column out.

**Downstream (step 4): what an apply would set off.**
- **The marker.** `mark-stale-translations.mjs --apply --since-hours=26` runs daily at 07:30 on Hetzner. It stamps `translation_stale` on every rewritten page that carries English.
  - The reader shows nothing for that marker (`git grep translation_stale -- src`). Readers would see the new transcription beside English made from the old one.
  - The marker is not a withhold: `WITHHOLD_LANES` is BDRC and Syriac only.
- **Who retranslates.**
  - Orchestrator gap-fill picks a book at `translate_partial` / `translate_complete` / `chapters_complete` / `complete` whose `pages_translated < 0.9 × (pages_ocr − pages_blank)`. It then dispatches **every page whose English is older than its OCR**, i.e. the whole re-read book.
  - translate-worker self-dispatch does the same for books at `ocr_complete` / `translate_partial`.
  - Both refuse held books and books the #5700 trust gate refuses.
  - The model is `getTranslateModelForBook`: Greek and Hebrew → `gemini-3-flash-preview`.
  - Both lanes ask the daily dial, which is currently **$5/day**.
- **Price.** 4,435 in / 1,581 out tokens a page: the Greek/Hebrew mean of `realtime-translate.mjs` flash rows over the last 45 days. At $0.50 / $3.00 per M that is **$0.0069/page** realtime, $0.0035 on Batch.
  - This is a floor: thinking tokens are not in the meter.
  - `gemini_usage` logs those 13,692 flash rows at `cost_usd: 0`, so they are priced here from tokens.
- **Grec 1841:**
  - 354 pages carry English. Status `complete`, 100% translated, not held, and the trust gate passes: its pages carry no handwriting tag, so it is not counted as a manuscript.
  - The apply as built writes 5 pages (4 with English): 4 stale marks and no dispatch.
  - A full write would stale 354 pages and still dispatch nothing: the share stays at 1.0. The English would stay stale until someone retranslates (≈ $2.44 realtime).
- **Zohar Chadash:**
  - 95 pages carry English. Status `failed`, not held, trust passes.
  - The would-write set holds 38 pages with English, 28 of them over Sefaria text. Status `failed` is selected by neither lane, so nothing dispatches now.
  - If the book reaches a translate status, it is under the 90% bar (95/188 after an apply). Gap-fill would then retranslate all ~188 pages (≈ $1.30).
- **The $0 route.** `scripts/batch/cli-translate.mjs` (agy, one call at a time, ~30 s a page), or `claude-translate.mjs` (Opus through the Claude CLI, #6559), both through its `apply`. Neither asks the trust gate. `writePageTranslation` clears the stale marker.

**Full-run frame** (`plan.mjs` → `results/g4-reread-pilot-6769/plan.json`, `plan-books.csv`). "CLI days" means one concurrency-2 stream at the pilot's wall rate: 46 s/page Greek, 49 s/page Hebrew.

| shelf | visible books | pages | pages with English | trust-refused | held | CLI days | paid retranslation (realtime / Batch) |
|---|---|---|---|---|---|---|---|
| Greek manuscripts (#5619 census) | 355 | 137,189 | 117,557 | 207 | 11 | 73 | $818 / $409 |
| · Greek share ≥ 0.5 | 296 | 125,892 | 115,280 | 191 | 11 | 67 | |
| · located in an open edition (#5619) | 87 | 37,138 | 32,540 | 66 | 1 | 20 | |
| · trust row `greek-manuscript` | 126 | 68,987 | 59,352 | 126 | 3 | 37 | |
| Rashi (#6731 classification) | 28 | 8,363 | 6,846 | 0 | 7 | 4.5 | |
| Mixed square + Rashi | 10 | 7,360 | 5,085 | 0 | 1 | 3.9 | |
| Rashi + mixed | 38 | 15,723 | 11,931 | 0 | 8 | 8.9 | $83 / $42 |

- Across the 38 Hebrew books, 43 pages in 2 books are Sefaria-fitted.
- Two of them, Ein Yaakov (270 pp) and Talmud Yerushalmi (736 pp), are already under the gap-fill bar. A write there turns a gap-fill of the untranslated pages into a retranslation of the whole book (1,006 pages, ≈ $7 realtime).

**Caveats.**
- **One book per script.** Grec 1841 is the book #6731 found worst served (0.36), so its 29/30 is the easy end of the shelf.
- **Judge.** The judge is one model family's preference. The controls show it catches planted errors at this length; they do not show it can rank two real reads of a hard hand. The Sefaria result (5/5 for an edition text) is consistent with it reading the image, not the fluency.
- **Frame.** The A/B frame excludes pages with no served text: the 43 empty Zohar Chadash pages, which G4L fills.

**Grade:** directional (2 books, 30 + 30 pages, 10 controls). Nothing here changes routing. *Cost:* $0; 586 G4L calls, 80 Opus judge calls (2 of them a smoke test). *Artifacts:* `scripts/eval/g4-reread-pilot-6769/` (draw, judge, score, timing, plan), `scripts/eval/results/g4-reread-pilot-6769/` (keys, verdicts, scores, dry-apply logs, timing, plan, and the G4L reads as `reads-g4l.tar.gz`, which `cli-ocr.mjs apply --out=` can consume once unpacked).

**Verdicts (2026-10-16, these two books):**
- **Greek manuscripts:** the G4L re-read is better than the served text against the image (29/30, 0 worse). As built, `cli-ocr.mjs apply` cannot write it: the 40% shared-words guard refuses 350 of 355 pages.
- **Rashi:** the G4L re-read is better than flash-lite OCR (25/25, including 12 pages the guard refuses). It is worse than Sefaria-fitted text (0/5). It reads the left column first on 26% of two-column pages.
