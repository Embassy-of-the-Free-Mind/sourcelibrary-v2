---
stage: ocr
measure: [judged, accuracy]
languages: [de]
scripts: [Latn]
canons: []
n_books: 434
n_pages: 434
verdict: "On German Fraktur first reads (40 unread books, one page each, paired, blind Opus), the agy Flash-low correction did not raise acceptance enough to measure: read@4 29/40, read@4 then correction 4 a call 31/40 (2 gained, 0 lost, McNemar p 0.50; +5 points, 95% CI 0 to +12.5), at 1.7 times the agy calls. On 40 Fraktur pages that hold stored Flash-Lite text, a fresh read@4 was accepted on 33/40 against 27/40 for the #7558 correction (2 vs 8, p 0.11) and 25/40 for the stored text. The re-read cost a third as much per accepted page ($0.00042 against $0.00129) and left 4 wrong-text pages against 7. Against DTA on 40 pages, no route keeps the long s (0 to 1 of 1,143 to 1,384) or the superscript-e umlaut (0 of 264 to 296). Diplomatic CER is 5.9 to 8.4% and Level-1 CER 2.3 to 5.0% (means; medians 0.5 to 0.8%). 90% of the German holdings with text is Fraktur (198/221, 85 to 93%)."
status: informational
decision: "Recommended defaults (preregistered rules): German first reads stay read@4 with NO correction; the stored-lite German queue is RE-READ (agy read@4), not corrected. Not applied: the cron and routing decisions are Derek's (#7809). The export is in router-table/evidence/fraktur-paired-7835.score.json, with no rules.json entry."
superseded_by: null
issue: [7835, 7818, 7701, 6012, 7824, 7809]
router_evidence: "none — the export is in evidence/ but rules.json does not name it: adding it moves german-blank-fraktur's pick, which is Derek's call (#7809)"
defect_rates: "scripts/eval/fraktur-paired-7835/results/defect-rates.json"
---
## 2026-10-31 · Fraktur: correct the first read or not, correct or re-read the stored text, and diplomatic accuracy against DTA (#7835)

PRIOR ART:
- `2026-10-31-correction-pass-paired-7818.md` and `scripts/eval/correction-pass-7818/`: the design, the judge driver, `servedCorrection` (checked 320/320 against the lane's own reads), `servedArmc`, `spanSeverity`, `fca`, the pooled defects-per-1,000-words CI and the export through `exportScore`. Imported from its `lib.mjs`, unchanged; its judge loop, Wilcoxon and bootstrap are restated with the same rules (they live in top-level scripts).
- `scripts/eval/route-judge-6740/judge.mjs`: `judgePrompt`, `opusCall`, `parseVerdict`, `clusterCI`, unchanged. `defect-rate.mjs` `words()`: #7824's word count, imported (it is on main now; #7818 had to restate it).
- `2026-10-30-german-cheaper-first-reads-7701.md`: the first-read frame and the Fraktur / Antiqua split (labelled by eye there on 170 pages: 141 Fraktur, 12 Antiqua, 17 other). Here one agy call labels each page and Opus checks 30 (T4).
- `2026-10-06-typed-references-dta-camena-eebo-6012.md` and `scripts/eval/typed-refs-6012/`: the DTA page matches (`kgram-vote-v2`), the typed pages (`tei-pages-v1`, private R2), 35/36 leaves right by eye.
- `scripts/batch/cli-ocr-lane.mjs` / `cli-ocr.mjs`: the live first read (read@4), the #7558 correction (`fc-prompt.mjs` template), the block correction (`--per-call` with `--correct-prompt`, #7701 arm C), the arm-c GPU template (`GPU_TEMPLATE`, hash 0601ef30e816f7a7).
- `.claude/docs/quality-rubric-and-sampling.md` §4.2: the OCR-D level names.

Code: `scripts/eval/fraktur-paired-7835/` (`lib.mjs`, `frame.mjs`, `arms.mjs`, `judge.mjs`, `analyze.mjs`, `writeback.mjs`). The analysis, `analyze.mjs score`, is committed in this PR, before any tag, verdict or CER exists.

**Why.** About 83% of unread German books are Fraktur (141/170, #7701), and 409,596 pages of stored Flash-Lite German text wait in german-lite/print. Three route choices rest on small unpaired samples: correct the first read or not (63/68 without, 43/44 and 20/20 with, on different pages); correct the stored lite text or re-read it (100/117 against 243/280, not paired, not split by face); and how accurate the letters are (every German rate so far is against references that modernise ſ).

### Instrument

- **Judge.** Opus `claude -p --model opus` on this box's subscription, `judgePrompt` (task ocr, language German) unchanged, the page image in the workspace, one text a call, blind to arm. A text identical to one already queued for the page is judged once and stands for every arm that served it. Queue order `makeRng(78355)`, 3 at a time.
- **Noise floor: not rerun.** #7818's test-retest on the same judge, prompt and kind of page (German and French print, 30 items twice): accept κ 0.87 (α 0.87), 29/30. It is reused as this study's A-vs-A floor.
- **Controls.** Wrong-page: 2 per stratum (T1 Fraktur, T1 Antiqua, T2, T3), this page's image with another page's text (`mulberry32(78356)`); passes when not accepted at fidelity ≤ 2. Planted: 4 per test (T1, T2, T3) on accepted texts, kinds B, C, D, E rotating (`plantError`, `makeRng(78357 + test)`), scored by `scorePlant`. The judge is **valid for this study** when every wrong-page control passes and at least 0.80 of plants are caught (the sampler's bar). If not, the judged outcomes are reported as invalid, not as results.
- **Budget.** At most **600** Opus calls (abs + controls + T4 check), counted from the verdict files. Planned: T1 ≤ 180, T2 ≤ 120, T3 ≤ 160, T4 30, controls 20. Pace: stop at weekly ≥ 85% or 5-hour ≥ 95% (the sampler's guard); never probe after a limit. If the plan will not fit, T3 is judged in queue order as far as it goes and the cut is reported.
- **Face tag (T4, and the T1–T3 strata).** One agy call a page (`gemini-3.8-flash-low`, agy's default model, gated workspace, `lib.mjs facePrompt`): fraktur (any blackletter) / antiqua (roman or italic) / mixed (both set substantial body text) / none (no printed body text). One retry on an unparsed reply.

### T4 — how much of the German holdings is Fraktur

- **Frame.** Visible books, `pages_count > 0`, `language` /^German/: 7,682 books (2026-10-31).
- **Draw (`frame.mjs t4-draw`, seed 78354).** Books sorted by id, shuffled; the first 300; in each, one interior page (`isInterior`) with an image, picked from the same stream. Drawn: 300 of 300 tried.
- **Outcome.** Fraktur share = fraktur / (fraktur + antiqua + mixed), pages tagged `none` excluded, with Wilson 95%; also fraktur-or-mixed; by century of the book's year. Opus tags 30 of the tagged pages (`mulberry32(78358)`) with the same question, blind to the agy tag: agreement k/30 and κ on fraktur-vs-not.
- **Weight.** w = fraktur / (fraktur + antiqua) from T4 weights T1's two strata: corpus accept = w · Fraktur + (1 − w) · Antiqua, per arm, reported beside the strata.

### T1 — first reads: read against read + correction, paired

- **Frame.** The first-read lane's German frame: `FIRST_READ_BOOKS`, language /^German/, `firstReadSkip(…, ['deu'])` null: 3,129 books.
- **Draw (`frame.mjs t1-draw`, seed 78351).** Books sorted by id, shuffled. Per book: its unread pages (`UNREAD`); `spreadReason` must be null; one interior unread page with an image, picked from the stream; its **block** is that page and the next 3 unread pages (shifted back at the end of the book; a book with < 4 unread pages is skipped). 450 candidates (462 tried: 8 no interior unread page, 4 short).
- **Strata.** Candidates are tagged in draw order (4 at a time) until 40 Fraktur and 20 Antiqua are found; the strata are the first 40 Fraktur and the first 20 Antiqua in draw order (`frame.mjs select`). Mixed and none are counted, not tested. If the 450 candidates hold fewer than 20 Antiqua, all are taken and n is reported.
- **Arms**, all on the same page, through `cli-ocr.mjs` exactly as the lanes call it, every `apply` a DRY run with `--emit-written` (nothing is written):
  - **(a)** the live route: `read --per-call=4 --model=gemini-3.8-flash-low` on the block, then `apply --lane=agy-first-read-7701 --first-read-only --print-only`. Served text = what apply would write. A refused page serves no text. If the live lane reads the page in between (apply refuses on "has OCR now" / "rewritten after this read"), the read stands as made, and the case is flagged.
  - **(b)** `agy-flash-low@4>agy-flash-low@4-written`: (a)'s served texts of the block's pages as `--draft-file`, `read --correct-prompt=<fc-prompt.mjs template> --lane=agy-first-read-correct-7701 --per-call=4`. Served by `servedCorrection` (apply refuses a draft-file read by design; #7818 §W3).
  - **(c)** the same correction 1 a call, on the judged page only.
  - Reads are not `--fresh`: a kept read of the identical request is reused, as the lanes do.
- **Primary outcome.** Paired accept, **(b) against (a), Fraktur only**: exact McNemar (two-sided binomial on the discordant pairs), α 0.05. An arm with no served text is not accepted.
- **Secondary.** (c) vs (a), (b) vs (c), the Antiqua stratum and all pages; wrong-text pages added / removed; defects per 1,000 words (#7824 `words()`), pooled with a page-bootstrap 95% CI (4,000 resamples) and paired per-page differences (Wilcoxon); made worse by severity (pages with more wrong_text / misleads / cosmetic defects than (a)); agy calls per page and $ per accepted page at #7701's $0.00087 a call.

### T2 — stored Flash-Lite text: correct against re-read, paired

- **Frame.** The #7558 correction lane's German frame (`correctMain`'s book query: visible, idle, no hold, not held; `correctablePages` restated: Flash-Lite OCR, not edited, ≥ 300 characters, not handwritten, interior), less pages in the lane's gex45 ledger (26,911 processed) and pages in `lane_judge_verdicts`: 2,690 books.
- **Draw (`frame.mjs t2-draw`, seed 78352).** Books sorted and shuffled; one eligible page a book from the stream; its block = it and the next 3 pages of the book. 120 candidates (251 tried, 131 with no eligible page). Strata: the first 40 Fraktur in draw order.
- **Arms**, same page:
  - **(a)** the stored lite text.
  - **(b)** the #7558 lane's own correction: `read --correct-prompt=<template> --lane=agy-correct-lite-7558` on the stored draft, `apply --mark-stale` DRY: its real guards. Refused → (a) stands.
  - **(c)** a fresh read, 4 a call, of the block (`read --per-call=4`), `apply` DRY (the 40% shared-words floor against the stored text). Refused → (a) stands.
- **Primary outcome.** Paired accept, **(b) against (c)**, exact McNemar, α 0.05. Secondary as T1, against (a) as well.

### T3 — diplomatic accuracy against DTA

- **Frame.** #6012's DTA same-edition books with a congruent page (our page is one typed page: both edges on its page breaks), ≥ 600 of our letters, whose stored OCR is still Flash-Lite: 87 books with congruent pages, 42 with a lite page (2 more had no typed text at the index).
- **Draw (`frame.mjs t3-draw`, seed 78353).** Books sorted and shuffled; one such page a book; up to 40. Drawn: 40 pages (16th c. 1, 17th 8, 18th 10, 19th 21). All are tagged for face and reported by face. The reference is the typed page's body text (`tei-pages-v1`), notes not included.
- **Arms**, same page: **lite** (stored); **(a)** agy read@4 on the block, served as the plain apply would (`--print-only`, dry; a refused read is missing for that arm and counted); **(b)** (a) then the block correction (T1's (b)); **(c)** arm c: PERO-OCR `pero_eu_cz_print_newspapers_2022-09-26` on gex45 (`pero-draft.py`; `--device=gpu` if the card is under 10% and 2 GB, else the CPU config; the configs differ only in USE_CPU), the same image bytes the judge sees, then agy Flash-low on `GPU_TEMPLATE`, served by `servedArmc` over the stored lite (E3 put-back).
- **Normalisation (`lib.mjs`, fixed here).**
  - Base, both sides: NFC; line-break hyphens (- ¬ ⸗ before a line break) rejoined (layout at every level, §4.3); whitespace collapsed and not scored. OCR: #7818's furniture tags removed with their content (header, page-num, sig, catchword, catch, meta, vocab, summary, keywords, language, script, page-type, scan-quality, columns, warning, note), other tags dropped and their text kept, markdown heading marks, `*`, `_` and `|` dropped. Reference: gap marks ◊ dropped.
  - **Level 2 (diplomatic)**: the base text. Case, punctuation, ſ, ß, the superscript-e umlaut (aͤ, U+0364), ꝛ and ligature code points are kept.
  - **Level 1**: Level 2, then ſ→s, ꝛ→r, ligature code points split, aͤ/oͤ/uͤ → ä/ö/ü, u/v → u and i/j → i in both cases. Abbreviation marks are not resolved (the live prompt expands abbreviations; DTA keeps them: a declared convention difference charged at both levels).
  - **Level 1 + case/punctuation + diacritics**: #7818's `scoreText` (`normalizeForScript` v4 'latin', ß→ss), for continuity with #7818's tables. It is not called Level 1.
  - **CER** over NFC grapheme clusters, windowed (`metrics.mjs windowedErrorRate`: OCR text before and after the page's text is free, interior insertions charged). **FCA** (#7818 A3) at the third level, alongside.
- **Error kinds (`errorKinds`, `nameErrors`; a fixed rule).** A fitting alignment with backtrace over the Level-2 grapheme strings (spaces removed); per aligned reference grapheme:
  - **ſ / s / f**: reference ſ kept, → s, → f, dropped, other; and reference s or f read as ſ. Rates per reference ſ.
  - **umlaut**: reference aͤ/oͤ/uͤ kept, → ä/ö/ü, → the bare vowel, other; reference ä/ö/ü read as the e form.
  - **ligatures**: ligature code points in the reference kept; ligature code points the OCR emits (DTA writes none, so every one is a Level-2 error).
  - **r rotunda**: ꝛ in the reference kept; ꝛ the OCR emits (DTA writes r).
  - **numbers**: edit operations touching a digit on either side, per reference digit.
  - **proper names (approximation)**: a reference word that is capitalised, not sentence-initial, ≥ 3 letters, whose Level-1 key occurs in at most 2 of the 84 typed works of the frame's books; an error when its aligned OCR word (word alignment on Level-1 keys) has another key. German capitalises every noun, so this counts rare capitalised words, names and rare nouns alike. Declared.
  - **capital I/J**: DTA writes the Fraktur I/J capital as J; reference J read as I is counted apart (a Level-2 convention, folded at Level 1).
- **Leaf / edition check.** A page where no arm aligns with the typed page (#7818's fold WER guard, 0.35) is excluded and counted (a leaf or edition that differs).
- **Outcomes.** Per arm: mean Level-2, Level-1 and fold CER, median Level-1 CER, FCA, the error kinds, judge accept. Paired contrasts (a vs lite, b vs a, c vs lite, c vs b) on each CER level: mean difference, page-bootstrap 95% CI, Wilcoxon. **Judge against diff**: on every judged T3 text, the judge's wrong_text against #7818's span rule (`spanSeverity`, A2) as a confusion table, the judge's recall of span-rule wrong-text texts, AUC of accept against Level-1 CER and against span severity, Spearman of the judge's defects per 1,000 words against span severity.

### Analysis (`analyze.mjs score`, committed here)

- Wilson 95% for every k/n; page-bootstrap 95% CIs (`clusterCI`, one page per book) for differences; exact McNemar for paired accept; Wilcoxon signed-rank for paired continuous measures.
- **Supported** = exact McNemar p < 0.05 and gained > lost. Below that the effect and its interval are reported, not "no effect".
- **Decision rule, German first reads (T1, Fraktur primary).**
  - **YES, put the correction back** (b, 4 a call) if the primary is supported and (b) adds no more wrong-text pages than it removes.
  - **NO** if (b) loses more than it gains at p < 0.05, or adds wrong text on ≥ 2 more pages than it removes.
  - Otherwise **NO** (no measured gain at this n; the pass spends agy quota the first reads need). If (c) vs (a) is supported where (b) is not, that is reported as a secondary result for a follow-up test, not as the decision.
- **Decision rule, stored-lite queue (T2).**
  - If (b) vs (c) is supported in either direction, the winner.
  - Otherwise the arm with the lower $ per accepted page, unless it has ≥ 2 more wrong-text pages than the other, in which case the other.
- T3 and T4 decide nothing; they weight and qualify the two rules.

### Write-back (the only production write)

On T1 and T2 pages, only the best judged arm, only where it was accepted and no other arm was judged better:
- **Best** = accepted, then higher fidelity, then fewer wrong_text, misleads and cosmetic defects. Ties go to the cheaper arm (T1: a, b, c; T2: a, c, b).
- T2 pages whose best is the stored text (a) are left alone.
- Written through the lanes' own `cli-ocr.mjs apply --apply` from the arm's read directory, with its guards and provenance (`writeback.mjs`; dry run first):
  - T1 (a): `--lane=agy-first-read-7701 --first-read-only --print-only`;
  - T1 (c): (a) first by the same apply, then the correction re-requested by the lane's own `read --correct-prompt --lane=agy-first-read-correct-7701` on the now-stored draft (the identical request, so the kept read is reused) and applied;
  - T1 (b): a block correction over drafts on disk, which the lane apply cannot take; not written, listed;
  - T2 (b): `--mark-stale=agy-correct-lite-7558`; T2 (c): the plain apply.
- Every page written is listed in the results. T3 and T4 are read-only.

### Seeds

| purpose | seed |
|---|---|
| T1 / T2 / T3 / T4 draws | 78351 / 78352 / 78353 / 78354 |
| judge queue | 78355 |
| wrong-page | 78356 |
| planted | 78357 (+ test index) |
| T4 Opus check | 78358 |
| bootstrap | 7835–7975 |

### Declared deviations from the issue

- The face is tagged by one agy call, not by eye (#7701): ~450 tag calls fit; Opus checks 30 (T4).
- T1's block is the drawn page and the next 3 unread pages, not the live lane's 40-page chunk position.
- T3 is restricted to pages whose stored OCR is Flash-Lite, so every arm runs on every page; that leaves 42 books, 21 of the 40 drawn pages from the 19th century.
- Limits: Claude only via `claude -p` on this box's subscription; Gemini only through agy (flash-low); no paid API call; no cron or routing change.

## Amendment 1 (2026-10-31, 10:30Z): reads the box killed, the Antiqua shortfall, e-rara

Made before any T1 arm, any T3 verdict, any CER score and any judge call on the texts it changes.

**What existed when this was written:**
- face tags: T2, T3 and T4 complete; T1 about 300 of 450;
- arms: T2 (a), (b), (c) and T3 lite, (a), (c) complete; T3 (b) stopped after it started (no row written); no T1 arm;
- Opus verdicts: about 45 of T2's 104 items; nothing else judged; no CER, FCA or error kind computed.

**A1. A read the box killed is retried once.** Between 09:50Z and 10:20Z the box ran out of memory and the kernel's OOM killer took agy processes (`dmesg`: "Out of memory: Killed process … (agy)"). Their reads end with `exit -9` and no model reply: an infrastructure kill, not an answer of the route.
- Affected: T2 (c) 6 of 40 judged pages (whole blocks), T3 (a) 1 judged page and killed neighbours in 4 other blocks.
- Rule: `arms.mjs retry-killed --set=… --arm=…` moves each `exit -9` read aside (kept under `killed/`), re-opens the key once, and the arm's own stage reads the missing pages again. A second kill stands as the outcome. The first outcome stays in `arms.jsonl` and is reported.
- This study's agy concurrency is cut to 2 calls at a time in all from here.
- T2 (c)'s 6 pages had served the stored text and were judged as (a)'s item; their retried (c) texts are judged as new items.

**A2. T1's Antiqua stratum will be short.** About 3% of the tagged T1 candidates are Antiqua (10 of about 300), against #7701's 7% (12/170, by eye). As preregistered, all Antiqua among the 450 candidates are taken and the stratum's n is reported. Below 20 it is exploratory: only Fraktur carries the primary outcome.

**A3. T4: 17 of 300 pages could not be fetched.** They are all e-rara (`www.e-rara.ch/i3f/…`) images, which answer HTTP 403 to this box for any user agent. They are reported untagged, and the Fraktur share is over the 283 tagged pages. e-rara's books are therefore missing from T4's share.

**Code fix (no change of method).** `arms.mjs t3-pero` compared PERO's image hash with a hash of the image as a string (always a mismatch). It now hashes the bytes. The PERO drafts were not re-run.

## Results (run 2026-10-31 09:25Z – 12:58Z)

**Run.**
- Opus `claude-opus-5-5`, `claude -p` on this box's subscription (milolomas), the image attached.
  - Calls: 382 against the 600 cap: 332 absolute (5 replies did not parse and were judged again), 20 controls, and the T4 check of 30.
  - Pace: from 11:16Z, `CLAUDE_PACE_OFF=1`, as #7818 did. The box's pace guard was holding each call for about 9 minutes. The study kept its own stop at 85% weekly and 95% 5-hour.
  - Meter: weekly 26% → 33%, 5-hour 5% → 48%. The account is shared, so these are upper bounds. List-price equivalent $22.31, not billed.
- agy: `gemini-3.8-flash-low` on the default pool, about 1,330 calls.
  - 751 face tags: the T1 frame needed 450 candidates to look for Antiqua.
  - About 580 read and correction calls.
- GPU: PERO on the gex45 card, 40 pages in 23 s, at about 09:50Z, before Derek's 11:27Z note on queueing GPU work (logged on #6871 and #7845).
- **Paid API: $0.**
- **Code changed after the preregistration, reporting only.** No outcome or rule changed. `analyze.mjs`:
  - writes `defect-rates.json` for the header;
  - adds the `router` stage (#7818's method);
  - export records carry `judged_at` and `script_type: print`, which `exportScore` requires;
  - controls are attached to every route of their cell;
  - DTA words are dropped from `t3-pages.json`.

  `writeback.mjs`: T2 (c) writes add `--mark-stale`, and T1 (c) is guarded (see Write-back).
- Amendment 1 retries (reads the OOM killer took): T2 (c) 7 blocks, T3 (a) 5, T1 (a) 5, T1 (b) 1 and T3 (b) 1. None was killed a second time.
- Artifacts: `scripts/eval/fraktur-paired-7835/results/` (`score.json`, `defect-rates.json`, `t3-pages.json`, `router-evidence.score.json`, `router-check.json`, `writeback*.json`). Texts, verdicts and reads are in `$JOB_SCRATCH/fraktur-7835/` (archived to R2). The DTA text stays out of the repo (#6012).

### Instrument: valid for this study

- Wrong-page controls: 8/8 rejected at fidelity ≤ 2 (T1 Fraktur 2, T1 Antiqua 2, T2 2, T3 2).
- Planted errors: 12/12 caught (4 per test).
- Noise floor: #7818's κ 0.87 on the same judge and prompt, not rerun.
- Face tags: Opus agreed with the agy tag on 29/29 parsed check pages (23 Fraktur, 6 none). The check drew no Antiqua or mixed page, so the agreement on Antiqua is not measured.

### T4: the Fraktur share of the German holdings

283 of 300 drawn pages were tagged. The other 17 are e-rara images that answer 403 to this box (Amendment 1 A3). 62 tagged pages have no printed body text.

| books' century | pages with text | Fraktur | Fraktur or mixed | Antiqua |
|---|---|---|---|---|
| **all** | 221 | **198 (89.6%, Wilson 84.9–93.0)** | 210 (95.0%, 91.3–97.2) | 11 (5.0%, 2.8–8.7) |
| 16th | 65 | 62 (95%) | 64 | 1 |
| 17th | 61 | 55 (90%) | 60 | 1 |
| 18th | 73 | 65 (89%) | 70 | 3 |
| 19th | 14 | 9 (64%, 39–84) | 9 | 5 |
| 20th / undated | 8 | 7 | 7 | 1 |

- **The weight w = Fraktur / (Fraktur + Antiqua) is 0.947.**
- The T1 frame (unread, held) is even more Fraktur. Of 379 tagged candidates: 327 Fraktur, 14 Antiqua (3.7%), 15 mixed, 23 none. Another 71 candidates are e-rara pages that cannot be fetched from this box; the live lane cannot read them from here either.

### T1: first reads, read against read + correction (preregistered primary: (b) against (a), Fraktur)

One interior unread page per book; arms on the same page. A page whose read the lane's apply would refuse serves no text and counts as not accepted.

| stratum | arm | accepted (Wilson 95%) | wrong-text pages | wrong_text / misleads per 1,000 words | agy calls a page | $ per accepted page |
|---|---|---|---|---|---|---|
| **Fraktur (40)** | (a) read@4, live | 29/40 (0.73, 0.57–0.84) | 4 | 0.44 / 1.54 | 0.40 | 0.00048 |
| | (b) + correction @4 | 31/40 (0.78, 0.63–0.88) | 5 | 0.55 / 1.53 | 0.68 | 0.00076 |
| | (c) + correction @1 | 31/40 (0.78, 0.63–0.88) | 3 | 0.55 / 1.10 | 1.40 | 0.00157 |
| Antiqua (14) | (a), (b), (c) | 10/14 each (0.71, 0.45–0.88) | 1 each | 0.27 / 0.53 | 0.88 / 1.25 / 1.78 | 0.00107 / 0.00153 / 0.00217 |

- **Primary: not supported.** (b) against (a), Fraktur: 2 gained, 0 lost, exact McNemar p 0.50, effect +5 points (95% CI 0 to +12.5).
  - (b) added a wrong-text page on 1 page and removed none.
  - Made worse, against (a): 1 page with more wrong text, 3 with more misleads, 3 with more cosmetic defects.
- (c) against (a), Fraktur: 2 / 0, p 0.50, +5 (0 to +12.5). Wrong text added 1, removed 2.
- (b) against (c): 0 / 0.
- Of the 40 Fraktur reads, the lane apply would refuse 3:
  - 2 for letters outside the book's scripts;
  - 1 restarted read.

  The correction cannot rescue these pages: it has no draft. Over all 54 pages it was 6 (2 more cut before `<<<END>>>`).
- **What the correction changes.** On Fraktur it rewrote 31 of 37 drafts, but the judge's verdict moved on 2 of them. On Antiqua it left 6 of 11 drafts unchanged and moved no verdict.
- **Weighted by T4** (w 0.947): corpus acceptance (a) 0.72, (b) 0.77, (c) 0.77.
- **Rule (§Analysis):** not supported, and the added wrong text is 1 page against 0 removed, under the 2-page line. Result: **NO, no measured gain at this n.** The pass would raise agy calls a first-read page from 0.40 to 0.68.

### T2: stored Flash-Lite text, correct against re-read (preregistered primary: (b) against (c))

40 Fraktur pages in the #7558 lane's frame that the lane had not processed. Arms on the same page; a refused correction or re-read leaves the stored text.

| arm | accepted (Wilson 95%) | wrong-text pages | wrong_text / misleads per 1,000 words (95% CI) | agy calls a page | $ per accepted page |
|---|---|---|---|---|---|
| (a) stored lite | 25/40 (0.63, 0.47–0.76) | 13 | 2.64 (1.33–4.22) / 4.59 | 0 | — |
| (b) #7558 correction, 1 a call | 27/40 (0.68, 0.52–0.80) | 7 | 0.88 (0.30–1.61) / 3.11 | 1.00 | 0.00129 |
| **(c) fresh read@4** | **33/40 (0.83, 0.68–0.91)** | **4** | **0.38 (0.10–0.72) / 1.81** | **0.39** | **0.00042** |

- **Primary: (b) against (c): 2 gained, 8 lost, exact McNemar p 0.11, effect −15 points (95% CI −30 to 0). Not supported in either direction.**
  - Against (c), (b) has wrong text on 5 more pages and on 2 fewer.
- (c) against (a): 10 gained, 2 lost, **p 0.039**, +20 points (+5 to +35). Wrong text removed on 9 pages, added on 0. Per-page wrong_text −5.2 per 1,000 words (−12.0 to −1.2).
- (b) against (a): 5 / 3, p 0.73, +5 (−7.5 to +17.5). Wrong text removed 6, added 0. Per page −4.7 per 1,000 words (−11.5 to −0.7).
- **Why (b) trails (c).** The lane's guards left 9 of 40 drafts standing:
  - 3 UNCHANGED;
  - 6 refused by the 25% word-change cap, at 26%, 35%, 43%, 67%, 750% and 817%.

  The last two are Flash-Lite drafts that dropped most of the page. A correction cannot be written over such a draft, but a re-read replaces it.
- **Rule (§Analysis):** primary not supported. The arm with the lower $ per accepted page is (c), and (c) has 3 fewer wrong-text pages than (b). Result: **RE-READ.**
- **Caveat.** This is Fraktur only, with n = 40. (c) cannot be served on a page where the 40% shared-words floor refuses it. Here that floor refused none of the 40 (6 reads killed by the box were retried under A1).

### T3: diplomatic accuracy against DTA (40 pages; 35 Fraktur, 5 Antiqua; all leaves matched, none excluded)

CER over grapheme clusters, windowed; the mean over pages (the median in brackets). Error kinds are pooled over the pages.

| arm | pages | Level 2 (diplomatic) | Level 1 | L1 + case/punct + diacritics (#7818) | FCA | judge accept |
|---|---|---|---|---|---|---|
| lite (stored) | 40 | 6.8% | 3.3% (0.8%) | 1.0% | 0.975 | 27/40 |
| (a) agy read@4 | 35 | 8.4% | 5.0% (0.5%) | 1.1% | 0.978 | 34/35 |
| (b) (a) + correction @4 | 35 | 8.4% | 5.0% (0.5%) | 1.1% | 0.978 | 35/35 |
| (c) PERO > agy (arm c) | 40 | 5.9% | 2.3% (0.7%) | 0.9% | 0.980 | 32/40 |

- **Long s.** In the reference, 1,143 to 1,384 ſ per arm.
  - Kept: lite 0, (a)/(b) 1, (c) 0.
  - Read as s: 96 to 99%.
  - Read as f: 14 to 16 per arm (about 1%), a real misread at every level.
  - No arm wrote ſ where the print has s or f.
- **Superscript-e umlaut (aͤ, oͤ, uͤ).** Kept: 0 of 264 to 296 in every arm. Written as ä/ö/ü: 92 to 95%.
- **Ligatures and r rotunda.** DTA writes neither. No arm emitted a ligature code point; one (a) read emitted one ꝛ.
- **Capital I/J.** DTA writes J for the Fraktur I/J capital. The arms wrote I for 28 to 35% of them.
- **Numbers.** Errors touched a digit at 0.18 to 0.20 per reference digit (lite 37 of 205; (a) 33 of 162; (c) 37 of 205).
- **Rare capitalised words** (names and rare nouns, the declared approximation): 10.5 to 12.0% are not read as the reference has them.
- **Paired contrasts (Level 1).** None of the CER contrasts is significant at Level 2 or Level 1:
  - (a) against lite: +1.5 points (−0.2 to +4.2), p 0.48;
  - (b) against (a): 0;
  - (c) against lite: −1.0 (−3.8 to +0.7);
  - (c) against (b): −2.7 (−7.2 to +0.5).

  At the folded level, on Fraktur, (a) is below lite: 0.5% against 0.7%, −0.2 points (−0.4 to −0.1), p 0.0004. The means at Levels 1 and 2 are driven by a few pages each arm reads badly; the medians all sit between 0.5 and 0.8%.
- **What this says.** Every route here is a Level-1 transcription. At OCR-D Level 2, which the rubric names as our serving target, every German page we serve is wrong on every long s and every superscript-e umlaut. The live prompt says "preserve original spelling" but names neither sign.
- **Judge against the diff** (150 judged T3 texts):
  - The span rule finds wrong text in 38; the judge rejects or tags wrong text on 8 of those (0.21, 0.11–0.36).
  - The judge tags wrong text on 9 texts the rule does not.
  - AUC of accept against Level-1 CER: 0.75; against span severity: 0.69. Spearman, judge defects per 1,000 words against span severity: ρ 0.39.
  - As in #7818 (51/132), the span rule's number spans include printed digits the judge reads as minor. So 0.21 is a lower bound on the judge's recall, not a miss rate.

### Write-back (the #7835 rule only)

**49 pages written**, each through `cli-ocr.mjs apply --apply` from the arm's own read, with its guards, a `page_revisions` row and provenance. Undo any page: `scripts/maintenance/revert-run.mjs --run-id <run>`.

- **T1 (a), 19 pages** (`--lane=agy-first-read-7701 --first-read-only --print-only`; books stay held):
  6a26d8476be3d771538c107d, 6a4300c04e06bc233ecf6ce2, 6a26cb0c5ac5aecc53ce93ab, 69aea304803d5b811fc12630, 6a26cba85ac5aecc53cec523, 6a26d0c7f5273a8d9079aba1, 6a26cdca5ac5aecc53cf6813, 6a4a5ba09050f0b434312a6d, 6a26db8005d7c1d9b108d6a3, 6ac50cb54ba7223afe01a4bb, 6a49394e1bbf4176e1e974f5, 69b51e5e9a81ef7feb3d3e96, 6a905b04785d9b40577f6ee6, 6ac50c014ba7223afe012e34, 6ad92bdab48e2f8490802e91, 6a26d999863cf28d8f649742, 6aa3369e77a4d7cfc5130ddd, 69aebd727dbbe2b7d6aa1dd2, 6ad1638d9ec7b8bcd02def80.
- **T2 (c), 23 pages** (the plain apply, the 40% floor; `--mark-stale=fraktur-7835-reread` queues their English):
  6a243dfb0f0e4f405e632769, 69dbcce30f8c5edf20f4f6db, 6a267b2f6c1f37c9c4f30c88, 6a491c6ca9e39181572e459c, 69bda11bf6d63c919748e2b8, 6a00d3a9da2a5c6a1ca77ee3, 6a26c34caad44c98627c9735, 69b51e979a81ef7feb3d7d73, 6a267e946c1f37c9c4f3c872, 69dbcc141040d1d5e20bcbc8, 6a267bc06c1f37c9c4f33b42, 69e961962beefe2f6f72c13d, 6a267f4288f11913ee9c8c0f, 69e75a02095c302d3fddeab6, 69b51e86ff09e4fe943b0c8d, 69f7052c28877807ac521890, 69f694822df99ed5124e236f, 69b51e08cf111105c4295671, 69f53a71cd95ea2189656344, 69f65b04bf6f02199077f78c, 69f6bbcc9afa1539c6ede46b, 69d389aaf897231f325c66f7, 69f69060aadb4c5ba0ee15bf.
- **T2 (b), 7 pages** (`--mark-stale=agy-correct-lite-7558`):
  69f668118b8e4d6b41815b33, 69c7fab1b05038301822d2d3, 6a243db50f0e4f405e63168f, 69f6adec29fb368c7a69dd1b, 69f5023dcf0b2623d7c3214e, 69f734c033881e31c2c0ef9a, 69f50eb477423d42db37b50e.
- Runs and books: `results/writeback-applied.json`.

**Not written:**
- **T1 (b), 12 pages:** a block correction over drafts on disk, which the lane apply cannot take.
- **T1 (c), 10 pages.** The preregistered path wrote arm (a) first, then re-requested the correction. cli-ocr did reuse the kept read (the same read the judge saw), but the reused meta still says `draft.source: 'file'`, and apply refuses it. The 10 arm-(a) writes were reverted with `revert-run.mjs` within two minutes (restorable 1 / changed since 0 on each; `results/writeback-t1c-reverted.json`). The pages are unread again. The `page_type` / `script_type` tags the read lifted (text / printed) stay, because revert-run restores text only. `writeback.mjs` now lists T1 (c) as not writable.
- **T2 pages whose best arm was the stored text:** left alone.
- **T3 and T4:** read-only.

### Router evidence

`router-evidence.score.json` (`exportScore`) is also at `scripts/eval/estimator/router-table/evidence/fraktur-paired-7835.score.json`, with its by-script cut.
- Cells: german-blank-fraktur (40 pages, three routes), german-blank-antiqua (14) and german-lite (40; routes lite, lite>agy-flash-low and agy-flash-low@4-read).
- The controls are attached to every route of their cell: they test the judge, which judged every arm.
- **No rules.json entry was added.** If rules.json named the export, `build.py` on main (`results/router-check.json`) would:
  - pool german-blank-fraktur's read@4 to 42/55 and move its pick to `agy-flash-low@8-written` (still HOLD);
  - keep german-blank-antiqua on HOLD with LightOnOCR;
  - keep german-lite/print on lite>opus: lite 257/347, lite>agy-flash-low 127/157. Its rules carry agy-flash-low-read (1 a call), not this test's @4 read.

### Recommendations (the preregistered rules)

- **German first reads: no correction.** Keep read@4 alone. On Fraktur the correction gained 2 pages and lost none of 40, which is not measurable (p 0.50), at 1.7 times the agy calls, and it added wrong text on 1 page. On Antiqua (n 14, exploratory) it changed no verdict.
- **Stored-lite German queue: re-read, do not correct.**
  - The re-read was accepted on 33/40 Fraktur pages against 27/40 for the correction (not significant, p 0.11) and 25/40 for the stored text (+20 points, p 0.039). It cost $0.00042 against $0.00129 per accepted page.
  - The correction's 25% cap leaves exactly the worst drafts, the truncated ones, in place.
  - Against #7818. #7818's correction-ON result compared the pass with no pass and stands as such. This test compares it with a re-read, which is the cheaper and better arm here.
- **Diplomatic transcription is a prompt question, not a route question.** No engine keeps ſ or the e-umlaut. If Level 2 is the target, the prompt has to ask for it, and that needs its own test.
