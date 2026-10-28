---
stage: ocr
measure: [judged, judged_vs_reference]
languages: [la, en, de, fr, it]
scripts: [Latn]
canons: []
n_books: 326
n_pages: 326
verdict: "On European print, a GPU draft corrected by agy Gemini 3.8 Flash-low with the page image reads about as well as Opus does. Pooled print TEST (173 pages, one per book, Opus judging blind against the image), the two-draft + diff arm D is accepted on 169/173 (94-99%) against Opus's stored correction of lite at 163/173 (90-97%; 8 of its misses are CONTAIN answers on bad lite drafts), misleading 3 against 2. That clears the preregistered bar: usable lower bound 0.942 vs O 0.942 - 0.05, misleading within the 1-page noise floor. The one-draft arm C (169/173, misleading 4) misses the misleading clause by one page. Latin print (108) clears it for C and D. English, German, French and Italian are underpowered (n 23-45; every arm 41-49 of 42-49 accepted). Flash alone with no draft (E) fails: misleading 18/172 vs 2. Folded CER against typed references: C - O +0.13 pt in Latin and +0.16 in English, D likewise. Cost per accepted page in the router: about 1.03-1.07 agy calls, about 0.46x the Opus route at the default plan fee, plus 1-5 s of GPU card time."
status: undecided
decision: "Evidence, not a lane change: rules.json gains five <language>-gpu-7263 cells and this panel's #7567 E2 evidence on latin-lite and german-lite; router table rebuilt as 2026-10-28-gpu-7263 (before: 2026-10-28-router-next). Recommended route for unread European print (agy/GPU only, Derek 11:24Z): gpu>agy-flash-low (C) with the language's best E1 engine, default; D where a second engine already ran. Flag pages where Flash changed >= 27% of the draft's words (10% of pages, 3 of 4 bad C pages) for a check. Manuscript pages (13 on this panel) are reported apart and route nowhere."
superseded_by: null
issue: [7263, 7567, 6740]
router_evidence: [latin-gpu-7263, english-gpu-7263, german-gpu-7263, french-gpu-7263, italian-gpu-7263, latin-lite, german-lite]
---
## 2026-10-28 · GPU draft + agy Flash 3.8 correction vs Opus reading the page (#7263)

PRIOR ART: `2026-10-28-euro-print-gpu-draft-flash-correct-7567.md` (#7567 E0–E2: the 326-page panel, typed references, every GPU
draft, arm c's reads and arm e's, the two-draft template, `score.py`), reused, not rebuilt. `scripts/eval/ocr-per-call-7522/judge.mjs`
(the blind Opus judge against the image), unchanged. `2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md` tested a stock GLM draft
on 30 Latin router pages; this one tests each language's best draft, two drafts with their diff, and Flash alone.

**Question (Derek, 2026-10-28):** does a GPU draft plus an agy Flash 3.8 correction that reads the page (optionally two drafts and
their diff) read about as well as Opus reading the page, much cheaper? From measured data.

**Prereg** `scripts/eval/gpu-flash-vs-opus-7263/PREREG.md`, committed before any arm ran (3ee8da28f), with two amendments, each
committed before the data it governs: amendment 1 (10:14Z) and amendment 2 (12:32Z).
- **Amendment 1** (Derek 09:43Z, 09:50Z): O is existing Opus work, no new reads, plus escalation triggers.
- **Amendment 2** (10:31Z–12:06Z): arm E (Flash alone) as a separate judge pass; Opus is the bar, never a candidate route;
  print/manuscript split; router evidence.

### Frame and arms
- **Pages:** the #7567 panel, 326 pages, **one per book**, with typed references.
- **Split:** DEV = 10 per language (seed 7263); TEST = the other 276. The O frame is TEST ∩ lite pages: la 116, en 45, de 24.
- **O:** #6740's stored **Opus 5.5 correction of the lite read, with the image** (`f`).
  - It is not a draft-free direct read: arm O's fresh reads were stopped after 61 (Derek 09:50Z).
  - Its 8 CONTAINs are answers on bad lite drafts.
- **C:** best E1 draft (la PERO-OCR, en/it LightOnOCR-3-1B, de CHURRO-3B, fr Surya 2) → agy `gemini-3.8-flash-low`, the #6740
  template, with the image. These are #7567's stored arm-c reads.
- **C′:** C again, 326 fresh calls (the noise floor).
- **D:** both drafts (X, plus Y = the next-best non-GLM engine) + a numbered word-level X↔Y diff + the image → Flash-low (`d-diff.mjs`).
  - One DEV round (template `59a8ae36`): usable 49/50, 0.46 misreads/page against C's 0.90. Nothing was left to revise, so it was frozen.
  - D2 (a self-check pass) was not run: D did not fall short of O.
- **E:** #7567 arm e, Flash-low with the image and no draft (stored).
- **Judge:** Opus via `claude -p`, one page per call, every version blind under shuffled letters. The main pass shows O, C, C′, D,
  X, S and O-direct; the E pass shows E, O and C.
  - Drift check: C agrees on 182/184 pages between the passes, O on 173/176.
  - 189 of the main pass's first calls hit the account's 5-hour session limit. They were re-judged unchanged after the reset.

### TEST results, print pages (`score-judge.py --script=print`; Wilson 95%)
Usable = delivered and judged usable; misleading = delivered and judged not usable; no-answer = nothing delivered.

| cell | n | O (Opus, stored) | C | C′ | D | E (Flash alone) | X (draft) | rule C / D / E |
|---|---|---|---|---|---|---|---|---|
| Latin | 108 | 99 (85–96%), mis 2, na 7 | **105** (92–99%), mis 3 | 104, mis 4 | **104** (91–99%), mis 3, na 1 | 97 (83–94%), mis 9 | 52 | **pass / pass** / fail |
| English | 42 | 42 (92–100%) | 41 (88–100%), mis 1 | 42 | 42 (92–100%) | 32 (61–87%), mis 8 | 33 | underpowered |
| German | 23 | 22 (79–99%), na 1 | 23 (86–100%) | 22, mis 1 | 23 (86–100%) | 21, mis 1 | — | underpowered |
| **all print** | **173** | **163** (90–97%), mis 2, na 8 | **169** (94–99%), mis 4 | 168, mis 5 | **169** (94–99%), mis 3, na 1 | 150 (81–91%), mis 18 | — | C fail (mis +2 > NF 1) / **D pass** / E fail |

- **The rule:** an arm clears the O bar when Wilson LB(usable) ≥ O's usable rate − 5 pt, and misleading(arm) − misleading(O) ≤
  NF = max(1, |C − C′|) = 1 page.
- **Power:** the rule needs n ≈ 90–130 per cell, so English, German, French and Italian cannot pass it at n 23–45.
- **Sensitivity, O's CONTAINs removed** (165 pages): O 163/165; D 161/165, LB 0.939 against a bar of 0.938 (passes by a hair); C 161/165,
  misleading 4 against 2 (fails).
- **French and Italian** (no Opus read stored; compared against the published Wikisource text, no O):
  - C 28/29 and 30/30; C′ 29/29 and 30/30; D 29/29 and 30/30.
  - Folded CER vs the reference: C 0.43 / 0.87 % median; D − C −0.09 [−0.20, 0.00] and +0.01 pt.
- **Manuscript pages** (13 in the O frame: la 8, en 3, de 2; script type per the 12:06Z rule, `script-type.json`):
  - C 13/13 and D 12/13 (1 no answer) against O 11/12.
  - n is too small to route; they are reported in `score-test-7263.json` `<lang>|manuscript` and HOLD in the router.

### Folded CER against the typed references (TEST, lite frame; δ vs O, paired bootstrap 95%)
| | la (106) | en (45) | de (24) |
|---|---|---|---|
| C − O | +0.13 [−0.11, +0.35] | +0.16 [+0.01, +0.35] | −4.83 (O's 1 CONTAIN scores 1.0) |
| C′ − O | +0.33 [+0.06, +0.65] | +0.21 [+0.04, +0.41] | −4.70 |
| D − O | +0.84 [−0.46, +2.94] | +0.28 [+0.05, +0.60] | −4.80 |
| E − O | +2.00 [0.00, +4.87] | **+8.01** [+2.14, +15.21] | +0.08 |

Medians: O 5.15 / 3.36 / 0.26 %; C 5.49 / 3.63 / 0.23 %.

On words, O is slightly closer to the reference (a few tenths of a point). On pages, the judge finds C and D at least as usable as O.

### Span check, word swaps (O vs D, 50 seeded TEST pages, 46 answered; Opus with the image, readings blind as 1/2)
- **356 disagreeing spans:** the page prints D's reading on 256, O's on 96, neither on 4, can't tell 1.
- **By page it is even:** D more right on 15 pages, O on 15, tie 16. The D-favoured spans sit on a few pages: la 135–33, en 110–18.
- **German favours O, 45–11:** mostly ß/fs and similar letter forms.
- So page metrics are not hiding a systematic word-swap problem in D.

### Cross-family judge (agy `gemini-3.8-flash-high`, 60 seeded TEST pages, same packets and prompt)
- **Usable:** C 57/60, C′ 58/60, D 58/60, X 23/60.
- **Agreement with Opus:** 58/60 on C, C′ and D.
- **On O it is harsher than Opus:** 21/27 usable, agreeing with Opus on 21/27. Self-preference may run either way; the direction of the C/D vs O call does not depend on which judge you pick.

### Escalation (amendment 1 §2; triggers known before any Opus read; pooled lite frame, 185 pages)
| trigger | pages flagged | C's bad pages caught | blended usable (flagged → O) |
|---|---|---|---|
| T3 Flash changed ≥ p90 (27%) of draft words | 10.3% | 3/4 | 184/185 (97–100%) |
| T1 X↔Y draft disagreement ≥ p90 (32%) | 10.3% | 2/4 | 181/185 |
| T2 CONTAIN / no answer | 0% | 0/4 | 181/185 |
| T4 page kind (non-text page-type, columns, margin, table, warning) | 47.6% | 1/4 | 176/185 |

- For D, T3 ≥ p80 flags 20% and catches 4/4.
- **Derek 11:24Z rules out Opus as a print route,** so the blended route is reported, not recommended. The usable recommendation is to
  hold T3-flagged pages for a check: 10% of pages, 3/4 of the bad ones.

### Cost (measured, and how firm each figure is)
- **agy:** C, D and E are one call per page (1.03–1.14 agy calls per *accepted* page in the router table). Per call, input/output tokens
  are about 24.5K / 0.62K (C), 28.1K / 0.62K (D, the diff adds about 3.5K), 22.0K / 0.63K (E). Median wall time is 10–12.5 s.
  - The main Gemini weekly pool went 0.4027 → 0.2931 (09:47–14:11Z) over this job's ~710 Flash-low calls and 60 flash-high judge calls. That reading is shared with other
    jobs (the E5 job ran beside it), so it is an upper bound only.
  - The router prices agy at `rules.json` stages.agy, unchanged.
- **Opus:** O's reads already existed, so this job bought no Opus reads beyond the 61 direct reads made before the 09:50Z stop.
  - The router's lite>opus route is 0.0041–0.0044 Claude points per page, from capacity.json, unchanged.
  - Judge overhead: 459 TEST and 50 DEV judge calls plus 46 span calls, median list $0.081 per judge call. The account meter went
    60 → 77 % over the job, shared with the E5 job's judge and this session.
- **Per accepted page** (router build, default plan fee convention): gpu>agy routes cost about 0.46× lite>opus. That does not price
  GPU card time: about 1–5 s a page per draft beside another tenant (#7567 E1), and D needs two drafts.
- **This is a capacity choice more than a price one.** agy's spare pool is the binding limit (#7263, 2026-10-27).

### Router (Derek 10:32Z)
- **`route-score.py`** writes this TEST and #7567 E2's judged arms as route-judge-format score files. Each has whole-language cells
  and `<lang>|<script>` cuts, and a copy goes in `evidence/by-script/`.
- **Mapping:** accept = usable; wrong text = delivered and not usable; no-answer is counted in n and as neither.
- **`add-evidence.py`** takes one source per route and cell, so no page counts twice: TEST for O, X, C, D, E; E2 for lite, lite>agy and GLM.
- **Table `2026-10-28-gpu-7263`:**
  - Every `<language>-gpu-7263/print` cell switches to an agy route. The pick among C, D and GLM→Flash is a near-tie at ~1.05 calls.
  - `german-lite/print`: keep → **switch to lite>agy-flash-low**.
  - `latin-lite/print`: keep **lite>opus**. lite>agy is 135/146 with 9 wrong-text pages against Opus's 0/147, which fails the relative wrong-text bar.
  - Manuscript variants HOLD (< 10 pages a route).

### Written (useful output)
- **7 library pages** got arm D's read, the best judged read that beat the stored text inside the same call, through
  `cli-ocr.mjs apply --apply`. Run `cli-ocr-20261028140316-1740366`; undo with `revert-run.mjs --run-id`.
- **Refused:**
  - 4 by the foreign-script guard (Greek letters);
  - 9 in held books;
  - 57 whose stored text #7567 had already rewritten with an arm this judge never saw. Its picks are kept.
- **Containment:**
  - The one wrong-leaf page the judge found (Velser p.18) was already contained by #7567.
  - Two pages whose stored text invented words in faded citations were among the 7 rewritten.
  - Nothing new to contain.

### What this does not show
- **O is Opus correcting lite, not Opus reading with no draft.** The 61 direct reads are too few to score apart.
- **Per-language verdicts beyond Latin are underpowered.** Every arm sits at 41–49 of 42–49 accepted there; the panel has no more typed pages.
- **The noise floor is one page,** so the misleading clause decides on single pages: C fails pooled by one.
- **Chinese (Paddle) and Tibetan (Yigdzin) cells were not run.** Each has one GPU engine (no D), and Tibetan Flash-low correction has a
  NO-GO (#7477). #7568's zh Opus corrections (75 pages, 3 books) are the frame for a next row.

Files: `scripts/eval/gpu-flash-vs-opus-7263/` holds the prereg, code, `split.json` and `results/score-*.json`. Scratch, with reads,
packets and verdicts, is in `/root/jobs/gpu-flash-vs-opus-7263` on gex45.
