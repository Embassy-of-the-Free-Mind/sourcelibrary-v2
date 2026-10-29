---
stage: ocr
measure: [accuracy, judged]
languages: [en, de, la, fr, it]
scripts: [Latn]
canons: []
n_books: null
n_pages: 331
verdict: "PREREGISTERED, not yet scored."
status: undecided
decision: null
superseded_by: null
issue: [6871, 5660]
router_evidence: "none yet"
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
