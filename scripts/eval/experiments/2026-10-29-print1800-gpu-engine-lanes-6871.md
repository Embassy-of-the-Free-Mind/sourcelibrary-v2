---
stage: ocr
measure: [accuracy, judged]
languages: [en, de, la, fr, it]
scripts: [Latn]
canons: []
n_books: 320
n_pages: 331
verdict: "On 1800+ English print an open GPU engine replaces Flash-Lite: on 97 typed English reference pages every engine tested passes the preregistered rule (LightOnOCR-3-1B median folded CER 0.12% vs lite 0.27%, catastrophic 0 vs 17, loops 0 vs 1), reads lite's 16 RECITATION refusals at median 0.09%, and drafts for agy Flash as well as lite does. German fails every use (lite 0.27% vs the best engine 0.52%; judged misleading 15 vs 4 of 40). French, Italian and Latin fail (a) on judged or answered pages; French passes (b) on 25 refused pages. The English lane (LightOnOCR on pages with no text, books held scans-only) is built; its frame is 984 books, 162,747 pages, about 1.4 GPU-days at the pilot's 4,860 pages/h; a 10-book pilot wrote 780 pages, 10 of 10 checked by eye usable after one guard round (v1 stored an appended engine note on 56 pages; reverted)."
status: undecided
decision: "Proposed: English 1800+ pages with no text (never read or lite-refused) in books held scans-only-publish-7270 are read by LightOnOCR-3-1B on gex45 (scripts/workers/gpu-print-lane.mjs, ocr-filler route gpu-print-en, disabled until Derek turns it on); lite drafts already stored are not replaced. German, French, Italian and Latin 1800+ print stay on Flash-Lite (French refusals: a 731-page follow-up)."
superseded_by: null
issue: [6871, 5660]
router_evidence: "none — no router cell changes here: the English 1800+ GPU lane is proposed with its ocr-filler route off until review; per-language verdicts (English pass on a, b, c; German fail on all; French b pass; Italian and Latin kept on lite) are in the routing proposal table"
---
## 2026-10-29 · Can a GPU engine serve 1800+ European print alone, fill lite's refusals, or draft for Flash? (#6871, #5660)
<!-- PRIOR ART: 2026-10-03-later-the-second-open-engine-olmocr-2-7b-fp8-5660.md (olmOCR-2 on English 1700+, CER 0.002 vs lite 0.022, kept off by one loop); 2026-09-28-is-flash-lite-adequate-on-modern-english-print-or-5216.md (lite refuses 14.9% of English reference pages); 2026-10-12-dropped-lines-two-engine-reads-6326.md (10 of 12 real dropped runs were lite's); 2026-10-28-euro-print-gpu-draft-flash-correct-7567.md and 2026-10-28-euro-print-gpu-correct-e3-e5-7567.md (E1 per-language engine choice and arm c, all on print before 1800; this is the 1800+ frame they left out, with their read.py, drive.sh and score.py reused). -->

### Census (Mongo, read-only, 2026-10-28; `print1800-gpu-6871/census.mjs`)
Books with `year` 1800+ and `language` starting with the language name, visible and hidden. Pages by state: **none** = no text and no refusal stamp; **refused** = no text with a refusal or failure stamp; **lite** = a Flash-Lite text; other = any other engine's text.

| lang | books | books owed OCR | none | refused | lite | other |
|---|---|---|---|---|---|---|
| en | 3,838 | 2,192 | 267,671 | 10,009 | 346,945 | 534,163 |
| la | 657 | 459 | 88,554 | 281 | 60,277 | 143,996 |
| de | 1,080 | 578 | 86,579 | 1,044 | 65,129 | 116,167 |
| fr | 635 | 287 | 46,822 | 731 | 41,970 | 81,228 |
| es | 39 | 32 | 8,587 | 20 | 4,744 | 2,893 |
| it | 99 | 45 | 7,818 | 33 | 6,684 | 17,435 |
| nl | 78 | 33 | 2,271 | 136 | 5,044 | 6,869 |
| **all** | 6,426 | 3,626 | **508,302** | **12,254** | **530,793** | 902,751 |

- **"none" overstates OCR owed:** it includes blank leaves, plates and pages of hidden books. It is an upper bound.
- **English is 53% of the unread pages and 82% of the refusals.** That is why olmOCR-2, the engine with the strongest prior English 1700+ result, is re-downloaded and tested here.
- **GPU-days at the card's alone rates** (capability card 2026-10-18; E5 for LightOnOCR and CHURRO fp8). All of "none" + "refused" (520,556 pages): LightOnOCR-3-1B 3,578/h → **6.1 days**; Surya 2 ~2,000/h → 10.8; CHURRO fp8 1,871/h → 11.6; GLM-OCR 1,462/h → 14.8; olmOCR-2 1,092/h → **19.9 days**. English alone (277,680): LightOnOCR 3.2 days, olmOCR 10.6. Redrafting every lite page (530,793) doubles each.

### Preregistration (committed before any engine output is scored)

**Panels.**
- **Typed** (`build-panel.py`, 146 pages, one per book or Wikisource work, `year` ≥ 1800):
  - en 97: the #5216/#5182 English IA pages with Wikisource/Gutenberg references, the 8 by-eye `reference_error` rows dropped. Lite = the stored #5216 realtime read; **16 are lite RECITATION refusals**, kept as refusals.
  - de 20, la 29: Wikisource proofread pages (`scripts/eval/ground-truth-ws`, the #5660/#6740 ref-ws bench). Lite = the bench reads (4 are empty).
- **Judged a** (`draw-judged.mjs --set=a`): one interior page per visible, idle, unheld 1800+ book whose stored OCR is a Flash-Lite draft of 300+ characters: fr 40, it 20 (all the frame had), de 40.
- **Judged b** (`--set=b`): one page per 1800+ book with no text that lite refused or returned empty: en 30, de 30, fr 25.

**Engines** (gex45, through `/root/gpu-queue` task `40-print1800-6871`, one at a time, temperature 0 except LightOnOCR's card settings): olmOCR-2-7B-1025-FP8 (O; #5660's recipe), LightOnOCR-3-1B (LO), Surya 2 (S), CHURRO-3B fp8 (CH8), GLM-OCR (G). Same prompts and flags as E1 (`drive.sh`, `read.py`).

**Scorer.** E2's `score.py` unchanged: letters only, infix CER, raw and folded views; folded is the decision view. A page with no text (refusal, empty, error) scores CER 1.0.

**Guard.** `scripts/lib/gpu-ocr-loop-guard.mjs` (`tests/unit/gpu-ocr-loop-guard.test.ts`), written before any output was read: refuses a read that hit the token cap, that #4850's guard refuses, that ends in a periodic run of 150+ code points (8+ repeats), or that repeats one 12+-letter line 4+ times in a row.

**(a) The engine alone replaces lite** (typed languages en, de, la; per engine). The engine's guarded read: a guard-refused page has no text (CER 1.0, catastrophic). Passes for a language when ALL hold, on every page of the language's panel:
1. median folded CER(engine) ≤ median folded CER(lite);
2. catastrophic(engine) ≤ catastrophic(lite), where catastrophic = no text, or CER > 0.5;
3. loops(engine) ≤ loops(lite) after the guard, where a loop is score.py's: hit the cap, or more than 2× the letters of the page's median arm.

Reported beside it, never deciding: median Δ with a 95% paired bootstrap CI, wins/losses, answered-only medians.

**Candidate engine for the judged languages.** Chosen from the typed results before any judge call: the engine that passes (a) in the most typed languages; ties go to the lower pooled median folded CER. One candidate for every judged packet.

**(a), judged** (fr, it, and de beside its 20 typed pages). Blind Opus (`claude -p`, #7522's `judge.mjs`, neighbouring leaves attached), two versions per packet: the stored lite draft and the candidate's guarded read (a guard-refused page is shown with no text and counts as misleading). Passes when misleading(engine) ≤ misleading(lite) AND the pages where the engine has more faults than lite ≤ the pages where lite has more than the engine. Misleading = not usable.

**(b) The engine fills lite's refusals and empties only.**
- Typed: the 16 en refusal pages and the 4 empty de/la pages, every engine. Passes when the guarded median folded CER ≤ 2% and catastrophic ≤ 2 of 16. The stored MinerU-fn read (ladder tier 3 today) is reported beside it on the en pages.
- Judged b: the candidate's guarded read alone, against the image. Pages the judge calls blank or without text are left out. Passes for a language when invented text (additions or bleed) is on at most 1 page AND at least 80% of the judged pages are usable.

**(c) GPU draft → agy Flash correction vs lite → agy Flash** (typed panel; E2's `e2-correct.mjs`, template `0601ef30`, Gemini 3.8 Flash low, one page a call). Arm a = lite draft → Flash; arm c = the candidate's draft → Flash. Passes for a language when the mean folded CER difference (c − a), on pages both arms answered, has a 95% paired bootstrap CI whose upper end is ≤ +0.25 points, AND catastrophic(c) ≤ catastrophic(a) over all the language's pages. Pages where lite refused have no arm-a draft: they count as catastrophic for a unless Flash answered from the image.

**Landing.** If (a) or (b) passes for a language, its lane is added as an `ocr-filler` kind with `cli-ocr.mjs apply` guards, provenance, the human-edit guard, and unread-only writes for (b). Then 10 books are piloted with `--apply` and 10 pages spot-checked by eye before any cron. If no language passes, this record reports the measured gap and stops.

**Not run.** PERO-OCR (E1's Latin pick, pre-1800 only); a lite A-vs-A floor (no Gemini API in this job); no new lite reads.

### Results (scored after the preregistration commit 954f2a3b8)

**The run.** gpu-queue task `40-print1800-6871`, 2026-10-29 00:40–01:39Z, card otherwise empty, util 0.6, 16 clients, 331 pages per engine, 0 errors.

| engine | pages/h | token-cap hits | guard refusals |
|---|---|---|---|
| LightOnOCR-3-1B (LO) | 2,899 | 5 | 5 |
| olmOCR-2-7B FP8 (O), pages at 1,288 px | 2,078 | 8 | 8 |
| CHURRO-3B fp8 (CH8) | 1,781 | 7 | 7 |
| Surya 2 (S) | 1,707 | — | 1 |
| GLM-OCR (G) | 1,553 | 14 | 14 |

**(a) Typed panel, the engine alone against lite** (`decide.py`; median folded CER %, catastrophic, loops after the guard; W/L = pages better/worse than lite by > 0.2 pt):

| lang | lite | LO | S | G | O | CH8 | verdict |
|---|---|---|---|---|---|---|---|
| en (97) | 0.27, 17, 1 | 0.12, 0, 0 (W/L 29/10) | 0.11, 0, 0 (26/5) | 0.12, 1, 0 (29/8) | 0.13, 0, 0 (28/8) | 0.16, 0, 0 (26/17) | **every engine passes** |
| de (20) | 0.27, 1, 0 | 1.27, 0, 0 (1/13) | 1.70, 1, 0 | 3.08, 1, 0 | 1.16, 1, 0 | 0.52, 0, 0 (2/11) | **every engine fails** |
| la (29) | 1.00, 4, 0 | 0.99, 0, 0 (6/13) | 1.14, 1, 0 | 1.51, 2, 0 | 1.73, 1, 0 | 2.19, 0, 0 | LO passes, the rest fail |

- **English.** Lite's median carries its 16 RECITATION refusals. On the 81 pages lite answered, the engines and lite are close: LO 0.17% against 0.19%, olmOCR 0.12%, Surya 0.12%. The gain is that no engine refuses, and every engine reads fewer pages worse than lite than better. MinerU, today's tier-3 refusal reader, is 0.24% on the same pages (stored read, descriptive).
- **German** (Wikisource proofread pages, mostly Fraktur, 1803–1847). Lite is better on 11–19 of 20 pages against every engine. The best engine, CHURRO, has twice lite's median.
- **Latin** (Wikisource, 1800+). LO passes by the letter: median 0.99% against 1.00%, 0 catastrophic against 4. The pass is carried by lite's 4 empty bench reads. On the 26 pages both answered, LO is 0.97% against 0.93%, and worse on 13 pages against 6. Treated as a tie (TAKEN below).
- **Candidate** (the preregistered rule: the most typed passes, then pooled median): **LightOnOCR-3-1B**, which passes en and la. It is also the fastest engine.

**(b) Typed: lite's 16 English refusals** (+ 4 empty de/la bench reads): LO median 0.09%, Surya 0.10, GLM 0.13, olmOCR 0.17, CHURRO 0.27, all with 0 catastrophic; MinerU-fn 0.21. **Pass** for every engine.

**Judged** (blind Opus, `claude -p`, #7522's `judge.mjs`, one call a page with the neighbouring leaves; 180 calls, 0 without a verdict; `judge-table.py`):

| set | lang | pages | result | verdict |
|---|---|---|---|---|
| a: lite draft vs LO | fr | 40 | misleading lite 2 / LO 3; LO more faults on 13 pages, lite on 7 | fail |
| | it | 20 | misleading 0 / 1; more faults 5 / 3 | fail |
| | de | 40 | misleading 4 / 15; more faults 26 / 5 | fail |
| b: LO on lite-refused pages | en | 30 | usable 24 (80%), invented 1, not delivered 2 (a token-cap loop; a plate) | **pass** |
| | fr | 25 | usable 22 (88%), invented 0, not delivered 2 | **pass** |
| | de | 30 | usable 20 (67%), invented 2 | fail |

- **The English b-failures are all one kind.** 3 pages are English with a Sanskrit, Devanagari or Chinese span, where LO garbled the span and read the English right. 1 page has a line of engine commentary appended ("Note: The original image contains a decorative brown scroll…").

**(c) GPU draft → agy Flash** (`decide-c.py`; mean folded CER difference c − a on pages both arms answered, 95% bootstrap CI; catastrophic over all pages):

| lang | both answered | Δ (c − a) | median a / c | catastrophic a / c | verdict |
|---|---|---|---|---|---|
| en | 81 of 97 | −0.41 [−1.25, +0.12] | 0.23 / 0.10 | 16 / 0 | **pass** |
| de | 19 of 20 | −0.10 [−0.62, +0.38] | 0.20 / 0.14 | 1 / 0 | fail (CI upper end above +0.25) |
| la | 26 of 29 | −0.04 [−0.26, +0.15] | 0.86 / 0.52 | 3 / 0 | **pass** |

- Arm a's catastrophic pages are lite's refusals: they have no draft to correct. 272 agy calls; the Gemini weekly bucket went 0.28 → 0.24, other pool traffic included.

### Routing proposal

| language, 1800+ | pages with no text (census) | proposal | evidence |
|---|---|---|---|
| **English** | 267,671 none + 10,009 refused | **LightOnOCR-3-1B on gex45 for pages with no text**; stored lite drafts stay | (a), (b) and (c) pass |
| German | 86,579 + 1,044 | Flash-Lite, unchanged | every use fails. Gap: typed median 0.52% (best engine) vs 0.27%; judged misleading 15 vs 4 |
| Latin | 88,554 + 281 | Flash-Lite + the long-s pass, unchanged | (a) a tie carried by lite's empties; refusals too few for a (b) lane |
| French | 46,822 + 731 | Flash-Lite. A refusal-fill route for the 731 refused pages is a follow-up | (a) judged fail by 1 page; (b) judged pass |
| Italian | 7,818 + 33 | Flash-Lite, unchanged | (a) judged fail, n=20 |
| Dutch, Spanish | 2,271 / 8,587 | not measured | no references; below the judged-panel budget |

- **The English frame is smaller than the census.** Visible English 1800+ pages with no text: 213K. Of these, 162,747 are in 984 books held `scans-only-publish-7270` (#7270 published them as scans, OCR undecided) and 31,653 are held `ia-free-text-first-4966` (branch 0: Archive text first). Only 25,051 are in free books.
- **The lane takes the scans-only books.** These are the holds the #7263 Latin GPU lane already reads (`GPU_LANE_HOLDS`). The lane writes OCR into them and keeps the hold, so no translation follows and no hold is released.
- **At LO's rate** (2,899 pages/h on the panel, 4,860 on the pilot's library pages) the frame is **1.4–2.3 GPU-days**. All 277,680 English pages with no text would take 3.2–4.0 days.

### The lane (built here, `scripts/workers/gpu-print-lane.mjs`, `scripts/lib/gpu-print-lane.mjs`, `scripts/gpu/gpu-print-{gpu.sh,read.py}`)
- **`frame` → `plan` → GPU → `apply`**, the Paddle print lane's shape (#6101).
- **It writes only pages with no text** (never read, or lite-refused/empty) in English books dated 1800+ under a GPU-lane hold. With `--free`, an unheld book is held `gpu-print-6871` first.
- **Guards at apply:** the page still has no text and is not human-edited; the book is still under a lane hold; `gpu-ocr-loop-guard` (token cap, #4850 loop, tail runaway, repeated lines); a 30-word-character floor (a blank leaf stays unread); ≤ 3 letters of a non-Latin script; no engine-commentary line; ≤ 15 ‰ Indic transliteration letters.
- **The last three guards were added AFTER the judge and the pilot (post hoc).** They only turn pages away. On the typed English pages they turn away 6 of 97 pages, all pages where lite read better than LO. On the judged b set they turn away all 4 English failures.
- **Every write goes through `writePageText`:** a revision row, CAS on the prior field, and a run id, so `revert-run.mjs` undoes it. The page is stamped `ocr.source: 'lightonocr'`, with an engine block (model, HF snapshot, vLLM version, host, GPU, decode settings, image URL and sha256). `missingProvenance` now checks `lightonocr` with the other specialist engines.
- Each written book also gets sweep_log rows before and after, a recount, and one `book_events` row.

### Deviations
1. **The guard's front-matter strip was wrong** in the first version. LightOnOCR opens with a bare `---` rule, and the strip took everything up to the next rule. It was fixed (and tested) before any judge packet was built. Guard counts on all five engines were unchanged by the fix.
2. **The (b) judged rule.** The rule said pages the judge calls blank are left out. The judge prompt has no blank verdict, so usable is counted over every drawn page, which is stricter. One English "not delivered" page is a plate, where LO's 14 letters were right.
3. **olmOCR read pages at 1,288 px** (its own recipe, #5660); every other engine read at 2,400 px.
4. **The typed panel's lite reads are bench reads,** not the stored library text: realtime #5216 for English, #6740/E2 for de/la.

### What this does not show
- **The English references are Wikisource/Gutenberg books,** which are legible, canonical and memorised. That inflates lite's refusal rate (16/97 here against 10,009 of 357K read pages in the corpus, 2.8%) and understates every engine's CER. Without refusals, LO and lite are close on English. The case for the lane is refusals, catastrophic pages and $0 marginal cost, not a better reading of clean pages.
- **German, Latin, Italian and French n are small** (20–40 a cell), and the judge is one Opus pass.
- **No pilot pages are in the tables above:** see the pilot section.

### Pilot: 10 books, `--apply` (2026-10-29)

**The books.** The first 10 frame books with 30–250 owed pages (seeded order), all held `scans-only-publish-7270`, so no hold was added or released. 1,064 pages had no text.

**The read.** Queue task `41-gpu-print-pilot-6871`, LightOnOCR (HF snapshot `23d54408…`, vLLM 0.31.0): **4,860 pages/h**, 0 errors.

**v1 (run `gpu-print-en-2026-10/lo-20261029T020001Z`).** 852 written, 95 textless (blank leaves: one checked by eye), 117 turned away (115 other script, 2 token cap). By eye, 10 random written pages:
- 8 right; one slip, "chris-tians" read as "Christians".
- **Sanskrit phonetics, p.121:** the transliteration's diacritics were misread (ç as ṣ or ḍ, macrons added), and the LaTeX `$…\ …$` that wraps them was stored.
- **Gibran, *Sand and Foam*, p.31:** the text was right, but empty `<div>`s were stored, and so was an appended engine note: "Note: The actual image URLs are placeholders…". That note is invented text.
- **The note was not one page.** 56 of the 852 written pages carried one ("Note: The page number … is preserved as it appears…"), 50 of them on that book's ornamented pages. On the 331 eval pages it was 3.

**The fix.**
- **The converter** drops HTML tags and blockquote marks, and unwraps `$…$` spans that hold no LaTeX command.
- **The commentary guard** catches any "Note:" line about the image, markdown, placeholders or the page number.
- **A new transliteration guard** turns away a page with more than 15 ‰ Indic transliteration letters. The Sanskrit pages are at 16–111 ‰; English pages naming a Rāma stay under 7 ‰.
- All are unit-tested (`tests/unit/gpu-print-lane.test.ts`).
- **The v1 run was reverted whole** (`revert-run.mjs`: 852 restorable, 0 changed since) and applied again.

**v2 (`…/v2`, the pages as they now stand).**
- **780 written**, 0 conflicts, 95 textless.
- **189 turned away:** 115 other script, 56 commentary, 16 transliteration-dense, 2 token cap.
- **All 780 pass `missingProvenance`**, `ocr.source: 'lightonocr'`, and none carries a note. The two defective pages above are empty again.
- **By eye, 10 newly drawn written pages:** 10 usable, 0 invented, 0 omissions. They include a two-column index (right column order) and a portrait plate's caption.
  - Minor faults: one page silently corrects two printer's typos ("is ot" → "is of", "resuccitation" → "resuscitation"); markdown italics (`*…*`) and list bullets are kept.

**Turned-away pages stay unread in their held books.** No other lane reads them while the hold stands. They are listed in `rejected.jsonl` on gex45.

**Recommendation.** Turn on route `gpu-print-en` (`-` → `on` in `ocr-filler-routes.tsv`) after this PR is reviewed. The frame (984 books, 162,747 pages) is about 1.4 GPU-days at the pilot's rate.
