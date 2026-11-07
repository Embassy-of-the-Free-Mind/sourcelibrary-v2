---
stage: translation
measure: [judged, judged_vs_reference]
languages: [zh, lzh]
scripts: [Hani]
canons: []
n_books: 100
n_pages: 100
verdict: "Re-translating the stored 3 Flash English on Paddle-read Chinese with agy 3.8 Flash low beats it on the same 60 pages (one per book), and 4 pages a call does at least as well as 1. Accepted: stored 13/60, one page a call with the previous page's English (F) 27/60, without it (N) 30/60, 4 a call (F4) 33/58 (wrong-text pages 37, 25, 20, 17). Reference works stay weak: 12/30 (N) and 15/30 (F4) against 21/30 needed. 45% of N's major defects come from the transcription. Test 2, on 40 佩文韻府-family pages: English from the Opus-corrected source is accepted on 24/38 pages, from the Flash-corrected source on 8/38 (+18 −2, p=.0004). The Kanripo trace puts the gap on the source (80 vs 27 source-caused major defects; translator-caused 49 vs 47)."
status: adopted
landed: "PR #8174"
decision: "DECISION on #5274: re-translate the 47,150-page frame with 3.8 Flash low at 4 a call (prose first; reference works after an Opus OCR correction), and use Opus, not Flash, for the ditto/Siku OCR correction of reference works. 36 judged-better pages were written through the translate door; nothing at scale."
feeds: [route, cost]
superseded_by: null
issue: [5274]
router_evidence: "none — exported as cell zh-paddle-3flash-tr in router-table/evidence/zh-translation-paired-5274.score.json, which rules.json does not name yet (no existing cell is this frame; zh-siku-tr is stale English on Paddle CER < 0.1). Adding it is the route change in the DECISION on #5274"
defect_rates: scripts/eval/results/zh-translation-paired-5274/defect-rates.json
---
## 2026-11-04 · Should the 3 Flash English on Paddle-read Chinese be re-translated with 3.8 Flash, at one page or four a call, with or without the previous page's English? And does the Opus/Flash OCR gap survive into the English? (#5274)

PRIOR ART: `scripts/eval/route-judge-6740/judge.mjs` (the judge prompt, unchanged, with two questions appended);
`2026-11-03-chinese-translation-strata-5274.md` (the strata and the 83% figure); `2026-11-03-zh-ditto-restore-5274.md`
(the ditto pilot whose stored corrections test 2 translates). The `paired-arm-judge` skill merged at 12:23Z, after both
preregistrations (11:00Z and ~11:05Z), so it was not used. Run after the fact, its `check` reads this run's `key.json` as
**one arm** (it reads `route`; this key has `arm`), so its R1 one-page-per-book check passes vacuously. It also does not
recognise `swap` and `retest` rows as its wrong-page and repeat controls (R3/R4 FAIL, although there were 10 of each).
Those are field-name mismatches, not design gaps. R1's silent pass is the one that matters: rename the field and the
check can miss a real violation.

Preregistered: `scripts/eval/zh-translation-paired-5274/PREREGISTRATION.md` (commit 8823b44bd; F4 is amendment 1,
2d775a20f, committed before any F4 read: N 60/60 and F 52/60 read at that commit, no verdicts) and
`scripts/eval/zh-ocr-gap-translation-5274/PREREGISTRATION.md` (8ffea0e73, before any test-2 translation). Results:
`scripts/eval/results/zh-translation-paired-5274/`, `scripts/eval/results/zh-ocr-gap-translation-5274/`.

### Which factor each comparison changes

| comparison | model tier | pages per call | previous-page English | source draft | stratum |
|---|---|---|---|---|---|
| F vs S | 3 Flash → 3.8 Flash low | 1 (S: as stored) | stored → stored | Paddle (same) | ref + prose |
| N vs F | same | 1 | yes → no | same | same |
| F4 vs F | same | 1 → 4 | yes (the page before the block, as the live lane sends) | same | same |
| test 2 | same (3.8 low) | 1 | no | Paddle / Opus correction / Flash correction | 佩文韻府 family only |

What F4 sends (from each read's meta): the block prompt, the stored 3 Flash English of the page before the block, the OCR
of the pages before and after the block, and the other block pages as source. Across 228 pages: 188 in 4-page blocks with
the stored previous English, 12 with none (book start), 21 read again alone after a guard refusal. **F4 vs N is not a
pages-per-call effect, and no interaction is claimed: there is no N4 arm.** Test 2 is on different pages and is its own
comparison.

### Test 1 — 60 pages, one per book, 30 reference works and 30 running prose (blind Opus, scan + Paddle text)

Frame: 47,150 live pages in 720 books (31,555 reference, 15,595 prose) whose English is `gemini-3-flash-preview` on a
PaddleOCR reading. Excluded: 佩文韻府 / 駢字類編 / 韻府拾遺 (694 books), books in earlier samples (172), held books (85),
near-empty leaves, withheld pages. No book in the frame has a human edit.

| arm | accepted | ref | prose | wrong-text pages | major pages | weighted defects / 1k words | fidelity | tokens / page | calls / page |
|---|---|---|---|---|---|---|---|---|---|
| S stored 3 Flash | 13/60 | 4/30 | 9/30 | 37 | 57 | 142.8 | 3.10 | — | — |
| F 3.8 low, prev English | 27/60 | 12/30 | 15/30 | 25 | 46 | 80.8 | 3.57 | 7.7K | 1.0 |
| N 3.8 low, no prev English | 30/60 | 12/30 | 18/30 | 20 | 44 | 78.4 | 3.63 | 8.6K | 1.0 |
| F4 3.8 low, 4 a call | 33/58 | 15/30 | 18/28 | 17 | 38 | 61.5 | 3.64 | 4.1K | 0.35 |

Paired, exact McNemar on accept: F vs S +17 −3 (p=.0026); N vs S +22 −5 (p=.0015); F4 vs S +23 −3 (p=.0001); N vs F
+9 −6 (p=.61); F4 vs F +10 −4 (p=.18; wrong text added 5, removed 12). Two judged pages had no F4 block (the book did not
allow one). Seven judged pages were refused in their block and read again alone, which is what would be served: 3
accepted, 4 wrong text. Guard refusals by reason: moved 10, number-prev 1, number-next 1. 79 calls for 228 pages, none
refused.

Controls: swaps caught 10/10, retests within one fidelity point 10/10, accept agreement 9/10. The gate passed. 258
Opus verdict calls.

**OCR misread share.** On 38 of 60 pages (63%) the majority of verdicts flag a misread in the Paddle transcription that
changes the sense. 45% of N's major defects have origin `transcription`. Translator-only weighted defects for N: 35.2 per
1,000 words. So a re-translation alone cannot clear these pages: about half of what is left is the OCR.

**Decision rule.** F and N both pass the switch rule; N is chosen by rule 2 (k 30 ≥ 27 − 2, wrong text 20 ≤ 26). N
accepts 12/30 reference pages, below the 21/30 bar, so rule 3 calls for M (3.8 Flash medium). **M was not run**: the
two agy logins are held to flash-low, and root's pool was under its floor (10% of its week). Reference works stay
undecided.

**F4 slip screen** (all 224 parsed pages of the 58 blocks; Sonnet with the scans of n−1, n, n+1; every flag confirmed by
Opus): 17 Sonnet flags. Opus confirmed 1 wrong-leaf page, 1/224 = 0.4% (Wilson 95% 0.1–2.5%), in 1 of 58 blocks (0.3–9.1%).
Opus counted 11 sentences finished on the wrong side of a page break, all short carries across a break, and no missing
text. At n = 224, a slip rate below 1.3% (rule of three) could still go unseen. Pages Sonnet did not flag were not read by
Opus, so this rests on Sonnet's recall.

**Five disagreements opened with the scan** (`disagreements-opened.md`): one real N win, where F's English carried the
previous page's content (the context-bleed path); one real F win (a dosage); three accept-boundary calls by the judge. A
side finding: 丨 ditto marks also occur outside the three excluded titles (御定子史精華 p.32).

**Written.** 36 pages whose judged read beat the stored English (accepted, no wrong text, higher fidelity or fewer
weighted defects; F 8, F4 13, N 15) went through `cli-translate.mjs apply`, with the old English kept in page_revisions
(run cli-translate-20261104121854). Nothing else was written.

### Test 2 — does the Opus/Flash OCR gap survive into the English? (40 pages, 佩文韻府 family)

The ditto pilot's zero-丨 pages (PR #8062), 20 from each per-call set, seeded. **tP**, **tO** and **tFl** are 3.8 Flash
low translations, one page a call with no previous English and no neighbour OCR, of the stored Paddle draft, the Opus
correction and the Flash-low correction. No new correction calls were made. Flash-medium correction had not landed.

| judge | arm | accepted | wrong-meaning pages | name/number pages | major / 1k words | fidelity |
|---|---|---|---|---|---|---|
| Opus (scan) | tP Paddle | 1/38 | 35 | 30 | 11.2 | 2.84 |
| | **tO Opus-corrected** | **24/38** | **8** | 21 | **3.05** | 3.79 |
| | tFl Flash-corrected | 8/38 | 26 | 26 | 6.05 | 3.29 |
| Flash low (scan) | tP | 2/36 | 34 | 33 | 13.1 | 2.50 |
| | tO | 4/36 | 31 | 28 | 9.1 | 3.11 |
| | tFl | 6/36 | 30 | 27 | 8.6 | 3.19 |

Opus judge, paired: tO vs tFl +18 −2 (p=.0004); tO vs tP +23 −0; tFl vs tP +7 −0 (p=.016). By per-call set, tO 10/20
(1 a call) and 14/18 (10 a call), tFl 5/20 and 3/18. Controls: Opus swaps 10/10, retests 10/10. Flash swaps 10/10,
retests within one point 8/10, which **fails the 9/10 gate**. The Flash-low judge (a substitute for the Flash medium
Derek asked for; logins held to low) accepts almost nothing and cannot separate the arms. Agreement between the judges is
kappa 0.27 pooled (tO 0.14, tFl 0.53). Only the Opus judge is read.

**Cause trace** (every Opus major defect; agy Flash-low given the defect, the arm's source and the Kanripo WYG leaf):

| arm | major defects | source misread | translator | no leaf / unclear |
|---|---|---|---|---|
| tP | 253 | 181 | 63 | 9 |
| tO | 77 | 27 | 47 | 3 |
| tFl | 140 | 80 | 49 | 11 |

Translator-caused defects are about the same for both corrections (47 vs 49). The gap is in the source: Flash's
correction leaves 3× the source-caused major defects. **So the OCR gap survives into the English, and it is not the
translator's doing.** That answers the #7611 question: on Chinese reference pages, far more than 17% of OCR errors reach
the reader.

Five accept-flips opened with the scan: on 3 of the 4 tO wins checked, tO was really better. On two of them the
Flash correction had put text in the wrong column order, and the English then spliced one entry's text into another
(p.35, p.37). One was mixed: a dropped 丨丨 (source) and a dropped name (translator) (p.45). One tFl win was real:
tO rendered the 尺 headword as cun (p.89; both arms mistranslate 四寸 there, judged at different severities). One flip
was judge noise: all three English versions say the same name (p.81).

**Scope.** These are 佩文韻府-family pages, which are reference works, so the result says little about Siku prose or print.
No stored Opus and Flash corrections exist for 20 Siku prose pages, so the prose add-on was not run.

### Quota (agy $200 plan; router `agy_share` 4.45e-6 of a month per call)

| route | calls / page | per 1,000 pages | per 1,000 accepted | the 47,150-page frame |
|---|---|---|---|---|
| 1 a call (N) | 1.0 | 0.45% of a month, 1.9% of a pool-week, $0.89 | $1.78 | ≈ 0.9 pool-weeks |
| 4 a call (F4) | 0.35 (calls) / 0.48 of N (tokens) | $0.31 (calls, a lower bound) – $0.43 (tokens) | $0.54–0.76 | ≈ 0.3–0.45 pool-weeks |

The OCR correction for test 2 (from the ditto pilot): Opus costs 6–12% of a Claude account-week per 1,000 pages
($2.9–5.7 at fee share). Flash costs about 1% of an agy pool-week ($0.60–0.82). Cash billed: $0.

### Router evidence

`scripts/eval/estimator/router-table/evidence/zh-translation-paired-5274.score.json` exports the cell
`zh-paddle-3flash-tr` (pooled, plus `-reference` and `-prose`), with the routes `stored`, `agy-text@1` (F),
`agy-text@1-noprev` (N) and `agy-text@4` (F4). **`rules.json` does not name the cell, and would have to**: no existing cell
is this frame (`zh-siku-tr` is stale English on Paddle with CER < 0.1). Until rules.json adds the cell, build.py reads
none of it. Adding it is the route change the DECISION asks for. Test 2 is not exported: it judges English to settle an
OCR route, which is not a translation cell's instrument.

*Replicated?* No. Test 1's F/N/F4 effects over S are large and significant. N vs F and F4 vs F are within noise.
