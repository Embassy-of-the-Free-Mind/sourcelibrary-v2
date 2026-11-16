---
stage: ocr
measure: judged
languages: [la, grc]
scripts: [Latn, Grek]
canons: []
n_books: 170
n_pages: 170
verdict: "Latin and Greek pages read by 3 Flash (4 cells, 170 pages, one a book): neither agy arm (Flash-low correcting the stored text, or a fresh Flash-low read of 4 scans) separates from the stored 3 Flash text on accepts in any cell (best: Greek print correction +6/-1, p 0.13). Opus correction beats the stored text everywhere (accepts +6 to +15, lost 0, p ≤ 0.03). The table's hard floor blocks the agy read in latin-flash3/unknown and greek-flash3/print, and every Gemini arm in greek-flash3/unknown. All four cells stay held."
status: rejected
decision: "No route moved and current.json is not moved: per the pre-registration no agy arm met the adoption rule in any cell. Evidence added to rules.json, a scratch build committed as 2026-11-13-flash3-8632. 22 judged pages written under three run ids; 6 stored pages the judge found invented were contained (6 books held). v2#8632."
feeds: "route"
supersedes: []
superseded_by: null
issue: [8632]
router_evidence: ["latin-flash3", "greek-flash3"]
defect_rates: "scripts/eval/route-judge-6740/results/flash3-cell-tests-8632-2026-11-13/defect-rates.json"
---
PRIOR ART: `2026-11-12-latin-flash3-live-route-8632.md` (30 Latin 3 Flash pages: Opus correction 27/30, Flash-low
correction 26/29, stored 21/30; those 30 books are left out of this draw), `2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md`
(the earlier n = 3–4 router tests), and #6694 (greek-flash3 held untested since 2026-10-14). Template:
`2026-11-13-hebrew-mss-cell-8632.md`.

## 2026-11-13 · Does an agy route read Latin and Greek 3 Flash pages well enough to give these cells a route? (#8632)

**Why.** Of 2,646 flagged pages in the 2026-11-12 repair queue, 1,891 sit in cells where the router binds no route
(`2026-11-12-audit-policy-replay-8632.md`). The biggest are `latin-flash3/unknown` (522 flagged; part of 1.3M served
Latin pages, including the most-read books) and `greek-flash3/*` (484 + 104 flagged, 419K pages). A tested route would let
those findings be repaired on the subscription CLIs. Pre-registered before any model call: v2#8632 comment 6848364669.

**Design.** `judge.mjs draw`, seeded: one page per book, books in hash order, each page at a hash-chosen spot inside a
block of 4 consecutive scans. Frame: visible books, not held, stored OCR by `gemini-3-flash-preview`, interior,
300 or more characters, script type by `script-type.mjs`. n = 50 (Latin unknown) and 40 (each other cell).
Four arms on the same pages:
- `3flash`: the stored text (baseline).
- `3flash>agy-flash-low`: agy Gemini 3.8 Flash-low correcting the stored text, one page a call.
- `agy-flash-low@4`: a fresh agy Flash-low read of the 4-scan block, live prompt; only the drawn page is judged.
- `3flash>opus-correct`: the bar only, on the first 30 pages of each cell. Never a candidate, never written.

The judge was Opus through `claude -p`: blind, one output a call, image open. There were 2 wrong-page controls an arm
and cell, and 12 repeats. `paired-arm.mjs check` passed R1–R5 before the first judge call; 638 verdicts. The floor
was invented or wrong-leaf text (O1, O2, I1, I2, I6, T14). The adoption rule was the table's own (`build.py`):
I would propose a route only if the build picked an agy arm that cleared the floor and did not lose more accepts
than it gained against the stored text.

**latin-flash3/unknown** (n 50; Opus bar on 30):

| arm | accept | by-book 95% | wrong text | floor pages | misleads / wrong text per 1k words | control |
|---|---|---|---|---|---|---|
| 3flash (stored) | 33/50 | 0.52–0.78 | 15/50 | 5 | 3.73 / 2.73 | pass |
| 3flash>agy-flash-low | 37/50 | 0.62–0.86 | 12/50 | 4 | 2.09 / 2.43 | pass |
| agy-flash-low@4 | 34/50 | 0.54–0.80 | 12/50 | 3 | 2.51 / 2.05 | pass |
| 3flash>opus-correct | 28/30 | 0.83–1 | 1/30 | 0 | 1.26 / 0.32 | pass |

- Against the stored text: correction +7/−3 accepts (p 0.34); read@4 +6/−5 (p 1); Opus +6/−0 (p 0.03).
- Noise floor: 0 of 3 repeat pairs flip.

**latin-flash3/print** (n 40):

| arm | accept | by-book 95% | wrong text | floor pages | misleads / wrong text per 1k words | control |
|---|---|---|---|---|---|---|
| 3flash (stored) | 30/40 | 0.60–0.88 | 6/40 | 1 | 2.71 / 1.15 | pass |
| 3flash>agy-flash-low | 33/38 | 0.76–0.97 | 1/38 | 0 | 1.42 / 0.09 | pass |
| agy-flash-low@4 | 30/40 | 0.60–0.88 | 5/40 | 1 | 1.90 / 0.48 | pass |
| 3flash>opus-correct | 29/30 | 0.90–1 | 1/30 | 0 | 0.48 / 0.12 | pass |

- Against the stored text: correction +5/−2 (p 0.45); read@4 +5/−5 (p 1); Opus +6/−0 (p 0.03).
- Noise floor: 0 of 3.

**greek-flash3/print** (n 40):

| arm | accept | by-book 95% | wrong text | floor pages | misleads / wrong text per 1k words | control |
|---|---|---|---|---|---|---|
| 3flash (stored) | 19/40 | 0.33–0.63 | 17/40 | 1 | 5.04 / 4.84 | pass |
| 3flash>agy-flash-low | 24/40 | 0.45–0.75 | 14/40 | 1 | 4.44 / 4.64 | pass |
| agy-flash-low@4 | 24/40 | 0.45–0.75 | 12/40 | 2 | 4.23 / 3.95 | pass |
| 3flash>opus-correct | 29/30 | 0.90–1 | 0/30 | 0 | 0.62 / 0 | pass |

- Against the stored text: correction +6/−1 (p 0.13); read@4 +8/−3 (p 0.23); Opus +15/−0 (p < 0.001).
- Noise floor: 0 of 3. The common wrong-text class in every Gemini arm is O6 (misread words, 12–13 of 40 pages): accents, breathings and ligatures.

**greek-flash3/unknown** (n 40; mostly abbreviated Greek manuscript hands that carry no manuscript tag):

| arm | accept | by-book 95% | wrong text | floor pages | misleads / wrong text per 1k words | control |
|---|---|---|---|---|---|---|
| 3flash (stored) | 16/40 | 0.25–0.55 | 20/40 | 8 | 6.15 / 5.55 | pass |
| 3flash>agy-flash-low | 13/40 | 0.18–0.48 | 21/40 | 7 | 4.79 / 5.45 | pass |
| agy-flash-low@4 | 19/39 | 0.33–0.64 | 16/39 | 7 | 5.29 / 4.89 | pass |
| 3flash>opus-correct | 25/28 | 0.75–1 | 1/28 | 1 | 0.92 / 0.25 | pass |

- Against the stored text: correction +1/−4 (p 0.38); read@4 +4/−1 (p 0.38); Opus +13/−0 (p < 0.001).
- Noise floor: 1 of 3 repeat pairs flips.
- On manuscripts the Opus judge fails its self-preference check (rules.json `judge_validity`; the Hebrew test's second judge cut Opus accepts by more than half), so the Opus bar here is an upper bound. The judge is valid on the Gemini arms.

**As served.** A correction that refuses or fails leaves the stored text in place. Counted that way, accepts are
33/50 for the Latin unknown correction and 32/40 for the print one, and 29/40 for the Latin print read@4
(`as-served.json`).

**Decision, by the table's own rule.** `rules.json` gained this evidence (keyed by the draw cells), and `greek-flash3`
gained the `3flash>opus` and `3flash>agy-flash-low` routes. `build.py` was run on the committed `defect-rates.json`
(2026-11-06); the result is committed as `2026-11-13-flash3-8632` (current.json not moved).
- latin-flash3/unknown: HOLD. The hard floor blocks `agy-flash-low@4-read`, `3flash` and `3flash>agy-flash-low`. On main today the cell switches to the unmeasured agy default; this evidence removes that.
- latin-flash3/print: the build switches to `pero>agy-flash-low@4`. That rests on 43/46 lane defect verdicts, NOT on this test, and the live `3flash>opus` has no defect verdicts. No tested arm was picked, so I propose nothing. Regenerating the defect rates (scratch build b) keeps `3flash>opus` instead: only the Opus bar passes once it is rated.
- greek-flash3/print and /unknown: held by a person (#6694). The floor blocks the read@4 in print and all three Gemini arms in unknown. Opus correction is the only arm that reads Greek well; whether to pay for it on 419K pages is Derek's question on #6694, not this test's.
- **What n can show.** n = 40 detects a net 20-point difference on the discordant pages; the gates are 5 points. No agy arm comes close to separating, and the Greek gaps to the Opus bar (29/30 against 24/40) are large enough that more n would not change the answer.

**What was written (useful pages).** 22 judged pages, each from an arm that cleared the floor in its cell, accepted with
no invented or wrong-leaf defect, fidelity above the stored text's, and best among the agy arms. They went through
`cli-ocr.mjs apply` with by-eye rows and `--mark-stale`, so their English is re-translated by the agy lane.
- `ct-flash3-8632-latin-flash3-agy-flash-low-4-ocr`: 13 pages.
- `ct-flash3-8632-latin-flash3-3flash-agy-flash-low-ocr`: 3 pages.
- `ct-flash3-8632-greek-flash3-3flash-agy-flash-low-ocr`: 6 pages; a seventh was refused by the change-size guard.

The before-snapshot (`before-snapshot.json`) and selection were committed first. Undo: `revert-run.mjs --run-id <run>`.

**Containment.** The judge flagged 17 stored pages with wrong-text classes that may mean another text. One (Latin print,
a wrong-leaf page) was already replaced by a write above. On six, the judge's note says most of the page is not the
leaf's text: guessed or filler Latin and Greek over abbreviated hands. Those six were contained (`contained.tsv`).
- Held: 6 books, reason `flash3-invented-8632`, released when v2#8632 closes.
- Withheld: the English on those 6 pages only (`--by-eye-pages`, `page_revisions` snapshots).

The other ten have a few invented spans (marginal headings, one added line, metrical schemes) on an otherwise right page.
That is a finding, not a containment. The repair the six still need is an Opus read, which no route binds today.

### Replicated?

No. One judge family. For the agy arms that is enough: they are judged by a model of another family, and none
separates from the stored text. The Opus bar on Greek manuscripts would need a second judge (Gemini, as in the Hebrew test)
before it could be adopted.
