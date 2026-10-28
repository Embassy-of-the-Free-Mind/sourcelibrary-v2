# PREREG — Can a GPU draft + agy Flash 3.8 correction match Opus reading the page directly? (#7263)

Written and committed before any arm below has run (job gpu-flash-vs-opus-7263, gex45, 2026-10-28).

PRIOR ART: `scripts/eval/euro-gpu-correct-7567/` (#7567 E0–E2: the 326-page panel with typed references, every GPU
draft, arm c's reads, `e2-correct.mjs`, `score.py`, the two-draft template), `scripts/eval/ocr-per-call-7522/judge.mjs`
(the blind Opus judge against the image, used unchanged), `scripts/batch/claude-ocr.mjs` (the Opus read: live OCR
prompt, sealed `claude -p`, `claudeCall`), `scripts/eval/flash-reread-5924/` (Wilson intervals),
`scripts/eval/estimator/chain/capacity.json` (cost units: account-week, agy call), `.claude/docs/eval-design.md`.

## Question (Derek, 2026-10-28)
Does a GPU draft corrected by agy `gemini-3.8-flash-low` with the page image (and, as a variant, two drafts plus
their diff) read about as well as Opus reading the page directly, at a fraction of the cost? Decided from measured
k/n and measured cost, not expectation.

## Frame
- **Pages:** the #7567 E0 panel, 326 pages, **one page per book**, European print with a typed reference
  (EEBO-TCP, CAMENA, Wikisource proofread, DTA): la 126, en 58, de 62, fr 40, it 40. All public domain (pre-1800
  print, 1557–1800 DTA). Its 16 `excluded_from_scoring` pages stay in the judge and out of CER, as in #7567.
- **Cells:** language (la, en, de, fr, it) × "print". Plus a pooled European-print cell (all five).
- **Out of scope:** Chinese print (Paddle) and Tibetan pecha (Yigdzin). Each has one GPU engine only, so arm D cannot
  exist there, and Yigdzin → Flash-low correction already has a measured NO-GO (#7477). Named as a next row, not run.
- **Split** (`split.py`, seed 7263): DEV = 10 pages per language (50); TEST = the other 276
  (la 116, en 48, de 52, fr 30, it 30). D/D2 prompts are revised on DEV only, at most 3 rounds, each recorded.
  The verdict is computed on TEST only.

## Arms (all on the same pages)
| arm | what | model / channel | status |
|---|---|---|---|
| **O** | Opus reads the page image directly, one page per call, live production OCR prompt with the language slot (`claude-ocr.mjs` prompt + `callInstruction(1)` + `claudeCall`) | Opus 5.5, `claude -p`, this box's subscription | new |
| **C** | best GPU draft X (la PERO, en LightOnOCR, de CHURRO, fr Surya 2, it LightOnOCR; `c-pick.json`) → agy Flash-low correction with the image, #6740 template `0601ef30` | agy main pool | **reused**: #7567 E2 arm c reads (same template, model, draft, image) |
| **C′** | C again, fresh calls (A-vs-A noise floor) | agy main pool | new; runs first |
| **D** | two GPU drafts (X and Y, a second engine: la/en/it Surya 2, de dots.ocr, fr LightOnOCR — the next-best non-GLM engine by E1 median CER per language) + their word-level diff + the image → Flash-low reconciles | agy main pool | new; prompt from DEV rounds |
| **D2** | D, then a second Flash-low pass that sees D's output, the drafts' diff and the image and checks its own output | agy main pool | only if D falls short of O on TEST in the pooled cell |

Y is chosen by E1 CER on these same panel pages (as #7567 chose X): a language-level engine choice, stated, not hidden.

## Metrics, per cell and arm (TEST)
1. **Blind Opus judge with the image** (`ocr-per-call-7522/judge.mjs` unchanged; one call per page; versions O, C,
   C′, D, [D2], the draft X, and on our own pages S (the stored OCR, for the write-back), under letters shuffled per page; identical texts shown once; the arm key never in
   the prompt). Per version: usable, omissions, additions, bleed, order errors, misreads.
   - **usable** = delivered and judged usable.
   - **misleading** = delivered and judged not usable.
   - **no-answer** = nothing delivered (CONTAIN, refusal, empty, quota stop, wrapper fault). Counted as an outcome,
     never dropped. usable + misleading + no-answer = n.
   - **worse-than-draft** (C, C′, D, D2) = more faults than X in the same call (faults = omissions + additions + bleed
     + order errors weighted 3, misreads weighted 1), or X usable and the arm not.
2. **Folded CER** vs the typed reference (`euro-gpu-correct-7567/score.py`, folded view), mean and median, paired
   bootstrap 95% CI of (arm − O). Secondary: the model-free check on judge self-preference.
3. **Refusal / no-answer rate**, and wall seconds per page.
4. **Span diff with an image check** (page metrics hide word swaps): on a seeded sample of 10 TEST pages per language
   (50), the word-level spans where O and the best Flash arm disagree are put to Opus, blind (two readings labelled
   1/2 at random per span), with the image: which reading the page prints (1 / 2 / both wrong / can't tell).
5. **Cross-family judge** (self-preference bracket): agy `gemini-3.8-flash-high` judges the same packets on a seeded
   60 TEST pages (12 per language) with the same prompt. Reported beside the Opus judge; it does not enter the rule.
6. **Cost per usable page**, measured:
   - Opus: dereklomas@ `weekly_all:all` from the climits meter (`/root/.claude-limits/latest.json`) before and after
     the O run, read at least 2 h apart, ÷ O calls → account-week per page; plus the CLI's own token usage per call.
   - agy: Gemini `weekly` remaining_fraction from `agy -p /quota` before and after each agy arm, hours apart, ÷ calls
     (shared pool: noisy, other jobs included, so an upper bound); plus per-call tokens.
   - GPU draft: card-seconds per page from E1's measured pages/h (beside another tenant), as a fraction of a card-week.
   - Cost per usable page = cost per page ÷ usable rate. Opus judge calls are eval overhead, reported, not charged.

## Decision rule (per cell; the pooled cell is the headline)
An arm A **replaces O in a cell** only when both hold on TEST:
1. **Usable, non-inferior:** Wilson 95% lower bound of A's usable rate ≥ O's usable rate − **5 points** (the margin).
2. **Misleading, not higher beyond the noise floor:** misleading(A) − misleading(O) ≤ NF pages, where
   NF = max(1, |misleading(C′) − misleading(C)|) in that cell.

Otherwise the cell keeps O, and if A is cheaper the gap is named (usable and misleading differences with intervals),
not rounded up. Secondary (reported, not in the rule): the paired difference usable(A) − usable(O) with a 95% paired
bootstrap CI; folded CER δ vs O.

**Power.** The rule needs about **n ≈ 90–130 per cell** for an arm truly equal to O to pass when usable rates sit at
95–99% (Wilson LB within 5 points: n = 91 at 99%, 106 at 97%, 127 at 95%; 184 at 90%). Only la (116) and the pooled
cell (276) reach it. **en / de / fr / it per-language cells will be reported with their k/n and marked
"underpowered" unless the rule passes anyway**; no per-language verdict is claimed from them beyond that. Adding
pages would need new typed references (not in this budget).

**Which Flash arm is tested against O:** C (reused reads) and D are both tested. D2 is tested only if it ran. With
two or three arms against one O, a pass is read per arm; the recommended route is the cheapest arm that passes.

## Dev rounds (D/D2), at most 3
Each round: run D on the 50 DEV pages, judge DEV with O and C in the packet, score; revise the prompt only from DEV
verdicts; record the template hash and the change. The TEST run uses the last DEV round's template, frozen in a commit
before the TEST D run starts.

## Order of runs
1. C′ on all 326 (noise floor; also DEV material). 2. O on all 326. 3. D DEV rounds. 4. D on TEST (frozen).
5. Judge TEST. 6. D2 decision; if run, judge again for D2 in its own packet with O and D. 7. Span check, cross-family
judge, CER, cost. 8. Write-back.

## Stopping
- agy Gemini weekly remaining < **0.25** → stop all agy arms (main pool, never AGY_HOME).
- dereklomas@ `weekly_all` ≥ **85%** → stop all Opus calls (O, judge, spans).
- A quota stop leaves the run partial: the table is built on the pages every arm and the judge answered, and says so.

## Writes (useful output)
For each panel page that is one of our pages (EEBO-TCP and latin-period sets, 150 pages), the best judged read among
O, C′, D, D2 (C was already considered by #7567's write-back) — clean (usable, no omission / addition / bleed / order
error), fewest misreads, and beating the stored OCR in the same judge call — is written through `cli-ocr.mjs apply
--apply` with every guard and provenance, under a revertable run id. Held books and image-mismatch pages are refused.
Invented or wrong-leaf text found by eye is contained (hold + withhold, label `contained`).

## Not decided here
No lane or routing table is changed by this job; the recommended route per cell goes to #7263 with its default.

## Amendment 1 — 2026-10-28T10:25Z, before any TEST judge call or score (Derek, inbox 09:43Z and 09:50Z)

**State when written:** C′ done on all 326 pages; D round 1 done on the 50 DEV pages (not judged); arm O had made
61 fresh Opus reads (2 smoke + 59 in panel order) when it was stopped at ~10:00Z on the 09:50Z note. No judge call
had run.

**1. Arm O becomes EXISTING Opus work; no new Opus reads.** ("minimise NEW Opus reads … Opus as JUDGE is fine.")
- **O := `f`**, #6740's stored Opus 5.5 correction of the lite read, made with the page image
  (`/root/jobs/euro-gpu-correct-7567/drafts/f.jsonl`, `correct.mjs` instruction; #7567 judged it as arm f). It
  exists on the panel's 211 lite pages (la 126, en 55, de 30). **It is Opus reading the page with a draft, not a
  draft-free direct read**; every table says "O (Opus, correcting lite)". Its CONTAIN answers (8) count as no-answer.
- **The 61 fresh direct reads** (`O-direct`) are kept and reported only as a side note (O-direct vs O on the pages
  both have); they do not enter the rule.
- **TEST frame:** the lite pages with `f` that are not in DEV: **la 116, en 45, de 24; pooled 185.** The DEV split
  is unchanged (it tunes D only).
- **fr and it** have no stored Opus read: C, C′, D are compared against the **published text** there (the
  Wikisource typed reference, folded CER) and judged without O. No verdict "replaces O" is possible in those cells,
  and none is claimed.
- A search for pages whose stored OCR is Opus (`pages.ocr.model`) timed out (no index on that field, 500 s) and
  the lane registry (`lane_job_books`) only lists 3 recent claude-opus-ocr jobs, so no other cell was drawn from
  Mongo. #7568's Opus corrections (zh 75 pages / 3 books; de, grc, sa, ar 250 each) are the next frame; the
  Chinese one (Paddle draft) is run only if this frame finishes with time and meter to spare, and is reported as
  its own cell if it is.
- **Power, restated:** en (45) and de (24) are far under the n ≈ 90–130 the rule needs; la (116) and pooled (185)
  are the cells that can pass.

**2. Exceptions to Opus: an escalation rule, measured.** ("can always have exceptions that require opus.") The
target is the cheap route by default plus a rule that sends to Opus the pages it would get wrong.
- **Candidate triggers, all known before any Opus read** (from the drafts and the cheap arm's own answer):
  - T1 draft disagreement: share of draft-1 words in X↔Y diff spans (d-diff.mjs alignment), thresholds at the
    TEST pages' 80th and 90th percentiles;
  - T2 the Flash arm answered CONTAIN / no-answer / UNCHANGED-on-a-bad-draft is not knowable, so T2 = CONTAIN or
    no-answer only;
  - T3 change size: share of draft-1 words the Flash correction changed (large rewrites), 80th/90th percentile;
  - T4 page kind from the cheap arm's own tags: `<page-type>` not `text`, `<columns>`, `<margin>` present, a
    markdown table, or `<warning>`;
  - T5 cell (language);
  - draft confidence is not available (the E1 engines report none), so it is not a trigger.
- **For each trigger and the union T1∪T2∪T4** on TEST: recall = share of the cheap arm's not-usable pages it flags;
  escalation rate = share of all pages it flags.
- **Blended route per cell:** pages not flagged keep the cheap arm's read; flagged pages take O's read. Report the
  blended usable rate vs O-everywhere (Wilson), and blended cost per usable page. The blended route is tested
  against O by the same decision rule as any arm.
- Thresholds are fixed here (percentiles of TEST's own distribution, which needs no labels); no trigger is tuned
  on TEST verdicts.
