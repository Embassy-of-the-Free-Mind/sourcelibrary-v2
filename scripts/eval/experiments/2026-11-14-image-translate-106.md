---
stage: translation
measure: judged
languages: [la, de, fr]
scripts: [Latn]
canons: []
n_books: 120
n_pages: 120
verdict: "Attaching the page image to the agy Flash translation call cut serious defects from 4.10 to 3.28 per 1,000 English words over 120 random pages (paired difference 0.81, 95% CI 0.28–1.34; the same text call run twice moved 0.24). Accepted pages 88/120 with the image, 77/120 text only. French passes the #106 rule alone (5.40→4.53, CI 0.06–1.77); Latin (3.52→2.72) and German (3.57→2.77) move the same way but their CIs cross 0 at n=40. It repaired 12/12 planted OCR misreads (text only 1/12) and cut real misreads carried into the English from 119 to 76 of 188 spots, with no more false claims about the leaf (24 vs 24 pages), at +17% tokens and no extra calls."
status: undecided
decision: "No routing row changes. DECISION on #106: attach the page image in the live Latin/German/French agy translation lane (recommended default), or rerun Latin and German at n=60 first. 66 pages written with the judged-best read (run image-translate-106-20261114024226)."
feeds: "route"
supersedes: []
superseded_by: null
issue: [106]
router_evidence: [latin-tr-image-106, german-tr-image-106, french-tr-image-106]
defect_rates: "scripts/eval/route-judge-6740/results/image-translate-106/defect-rates.json"
---
PRIOR ART: `2026-11-07-ocr-doubt-flags-and-image-translation-8358.md` (v2#8358: the image arm on error-enriched pages repaired 9 of 21 carried misreads, 43%; it proposed this random-draw cell test), `2026-11-02-ocr-error-to-translation-7611.md` (how OCR errors carry into English; its books are left out of this draw), the #7263 European cell test (`eu-agy-translate-7263`: the live agy@4 text route, which this test's text arm reproduces one page a call).

## 2026-11-14 · Does attaching the page image to the translation call lower serious errors in the English? Latin, German, French (#106)

**Who reads this.** Derek deciding whether the live Latin, German and French agy translation lanes send the page image with the text; the router table (three held slice cells).

**Design** (pre-registered on #106 before any model call; `scripts/eval/image-translate-106/results/preregistration.md`). One seeded interior page from each of 120 visible books on the live agy route, 40 a language, v2#7611 books left out. Arms, all `gemini-3.8-flash-low` through agy with the production translation prompt over the stored OCR, **one page a call**: T text only; T2 the same call again (the arm noise floor); I the same call with the page image attached. The stored English (S, mostly Flash-Lite) was judged too, for the write decision only. Judge: Opus, sealed `claude -p`, blind (opaque ids), the image opened on every call (511/511), severity-weighted defects per 1,000 words, misreads carried into the English, claims about the leaf. Rule (from #106): I is better when (a) the T−I gap in serious defects per 1,000 words exceeds the T−T2 gap, (b) the paired by-page 95% CI of T−I is above 0, (c) I makes no more false leaf claims. 360 arm calls + planted rows on agy (`AGY_HOME=/root/.agy-milo`), 511 judge calls.

**Controls — all pass, round valid.** Wrong-page: 12/12 rejected (fidelity 1). Judge plants (one wrong number or negation in an English output): 8/9 caught, read by hand (the heuristic matcher said 6/9; two were caught on the planted span and missed by the tail test; the Horace "will not" plant was graded cosmetic, a real miss) — `results/judge-plants-by-hand.json`. Repeats: 10 outputs judged twice, 0 accept flips, serious count off by 1 on one. paired-arm.mjs R1–R5 ok. German has no repeat pair of its own (the 10 fell on Latin and French); the judge noise floor is pooled.

**Result, serious defects per 1,000 English words (misleads + wrong text):**

| | T text | T2 text again | I image | S stored | T−I paired 95% CI | T−T2 | rule |
|---|---|---|---|---|---|---|---|
| Latin | 3.52 | 3.15 | 2.72 | 5.55 | 0.80 (−0.09–1.66) | 0.37 | a yes, b no → not shown |
| German | 3.57 | 3.83 | 2.77 | 6.39 | 0.80 (−0.17–1.91) | −0.27 | a yes, b no → not shown |
| French | 5.40 | 4.79 | 4.53 | 6.62 | 0.88 (0.06–1.77) | 0.62 | a, b, c yes → **I better** |
| all 120 | 4.10 | 3.86 | 3.28 | 6.19 | 0.81 (0.28–1.34) | 0.24 | a, b, c yes → **I better** |

Accepted pages T / T2 / I: Latin 26/29/29 of 40, German 27/26/30, French 24/26/29, all 77/81/88 of 120. Stored English accepted 45/96 (24 pages had none).

**The mechanism.** Planted OCR misreads (a word changed in the transcription, the image unchanged): I repaired 12/12, T 1/12 (10 carried). Real misread spots the judge found on the shared pages: T carried 119 of 188 into the English, I 76; of T's 119, I repaired 31, T2 3. By language, carried T→I: Latin 35→25, German 19→8, French 65→43. False claims about the leaf: 24 pages each for T and I (T2 28).

**Cost** (agy tokens; one call a page in every arm, so calls per usable page fall with acceptance):

| | tokens/page | calls/usable page | tokens/usable page |
|---|---|---|---|
| T | 13,350 | 1.56 | 20,805 |
| T2 | 13,431 | 1.48 | 19,898 |
| I | 15,659 (+17%) | 1.36 | 21,353 |

v2#8358 measured +58% tokens for the image arm on its pages; here, one ordinary page a call, it is +17%.

**By eye (step 8; `scripts/eval/image-translate-106/results/by-eye.md`).** Five pages where I and T differ, seeded: I as good or better on 5/5, strictly better on 3 (a concession "even though excommunicated" T lost; two Hebrew words the OCR dropped that I restored from the scan; "Sicambrians" where T wrote "the French"). On 2/5 the judge put a one-sided defect that belongs to both arms or neither: page-level judge noise of that size is why the rule is on rates over 40 pages.

**Pages written (step 9).** For each drawn page, the best judged read (accepted, fewest serious defects, ties to T first) replaced the stored English only where it beat it: 66 pages written through `cli-translate.mjs apply` with provenance, run `image-translate-106-20261114024226` (revision rows kept; undo `scripts/maintenance/revert-run.mjs --run-id image-translate-106-20261114024226`). By arm: T 28, T2 17, I 21. 22 of the 66 had no English before. 30 kept the stored English, 23 had no accepted fresh read, 1 was refused by the absorbs-neighbour door (69b51de7efd8df28f2dacee2 p.439). book_checks: 66 rows, method `image-translate-106` v1 (`scripts/eval/methods/image-translate-106.md`).

**What else this run showed.**
- The stored English is much worse than any fresh read (6.19 serious per 1,000 words against 3.3–4.1; accepted 45/96). On these pages re-reading at all is worth more than the image.
- Side finding: book 6a49241ea45b99e46af9762d p.6 carried an invented Acts 20 passage; fixed and closed as #328. Its sample page was not written here.
- Run notes: the default agy pool was blocked by a stale local stop file (`/root/.model-limits/agy-gemini-3.8-flash-low.json`), left in place; the milo pool was used. 11 judge calls first failed with exit 127 (the pace-guard wrapper found an empty claude path) and were retried; no verdict was lost.

**Limits.** One page a call; the live lane sends 4. Whether the gain holds at 4 a call (four images in one call) is untested. n=40 a language: the pre-registration said a per-language test could see only a large effect (about 0.7 serious defects a page); the observed per-language gains are 0.3–0.4 a page, so Latin and German not passing (b) is a power limit, not evidence of no effect. One judge (Opus, a different family from the Gemini arms); no second judge family.

### Replicated?

No. The pooled result is one draw, one judge. A held-out draw at 4 pages a call is the replication the lane change would need.

<details><summary>paired-arm.mjs skeleton tables (Opus)</summary>

**Latin, judge opus.**

| arm | accept | by-book 95% | wrong text | fidelity | control |
|---|---|---|---|---|---|
| agy-text | 26/40 | 0.5–0.8 | 7/40 | 3.98 | pass |
| agy-text-again | 29/40 | 0.575–0.85 | 3/40 | 4.13 | pass |
| agy-image | 29/40 | 0.6–0.85 | 5/40 | 4.03 | pass |
| stored | 15/27 | 0.37–0.741 | 5/27 | 3.56 | pass |

- agy-text -> agy-text-again: on 40 shared pages better 13/40, worse 7/40; accept gained 5, lost 2 (sign test p 0.45).
- agy-text -> agy-image: on 40 shared pages better 10/40, worse 7/40; accept gained 6, lost 3 (sign test p 0.51).
- agy-text -> stored: on 27 shared pages better 1/27, worse 13/27; accept gained 1, lost 5 (sign test p 0.22).
- Noise floor: the same arm judged twice flips accept on 0/4 pages.

**German, judge opus.**

| arm | accept | by-book 95% | wrong text | fidelity | control |
|---|---|---|---|---|---|
| agy-text | 27/40 | 0.525–0.825 | 5/40 | 3.92 | pass |
| agy-text-again | 26/40 | 0.5–0.8 | 3/40 | 3.92 | pass |
| agy-image | 30/40 | 0.6–0.875 | 3/40 | 4.08 | pass |
| stored | 9/30 | 0.133–0.467 | 9/30 | 3.43 | pass |

- agy-text -> agy-text-again: on 40 shared pages better 4/40, worse 4/40; accept gained 3, lost 4 (sign test p 1).
- agy-text -> agy-image: on 40 shared pages better 9/40, worse 3/40; accept gained 5, lost 2 (sign test p 0.45).
- agy-text -> stored: on 30 shared pages better 1/30, worse 12/30; accept gained 1, lost 11 (sign test p 0.01).
- Noise floor: NONE MEASURED.

**French, judge opus.**

| arm | accept | by-book 95% | wrong text | fidelity | control |
|---|---|---|---|---|---|
| agy-text | 24/40 | 0.45–0.75 | 8/40 | 4 | pass |
| agy-text-again | 26/40 | 0.5–0.8 | 7/40 | 4.05 | pass |
| agy-image | 29/40 | 0.575–0.85 | 5/40 | 4.2 | pass |
| stored | 21/39 | 0.385–0.692 | 11/39 | 3.72 | pass |

- agy-text -> agy-text-again: on 40 shared pages better 7/40, worse 5/40; accept gained 2, lost 0 (sign test p 0.5).
- agy-text -> agy-image: on 40 shared pages better 11/40, worse 4/40; accept gained 5, lost 0 (sign test p 0.06).
- agy-text -> stored: on 39 shared pages better 4/39, worse 13/39; accept gained 1, lost 4 (sign test p 0.38).
- Noise floor: the same arm judged twice flips accept on 0/6 pages.

</details>
