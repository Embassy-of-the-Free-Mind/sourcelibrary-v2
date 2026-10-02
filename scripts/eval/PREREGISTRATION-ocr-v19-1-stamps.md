# Pre-registration: OCR prompt v19.1 (v19 + "a stamp on a show-through leaf is text")

PRIOR ART: scripts/eval/ocr-v19-ab.mjs and PREREGISTRATION-ocr-v19-showthrough.md (#4195). This reuses the v19 run's labelled pages and its arm outputs, adding one arm and a contemporaneous v16 control. It is not a new runner.

Written 2026-10-02, **before any v19.1 call**. Derek asked for it ("try 19.1") in session ocr-prompt-v17.

## Why
v19 cut invented pages on blank and show-through leaves the most, but it failed the over-decline guard by 0.009: on S3, false blank was 0.381 against a limit of 0.372. Nearly all of that came from 20 pages where a real stamp or shelfmark sits on an otherwise show-through leaf. v19 correctly refused the mirror-reversed print and then dropped the stamp, or put it only in `<meta>`/`<image-desc>`.

v19.1 changes ONE bullet of v19's Show-through section. A right-reading mark (stamp, shelfmark, pencil note, accession number, signature) is TEXT. Transcribe its words in the body, and a leaf carrying one is not blank. The candidate is `prompts/ocr/standard-ocr-v19-1-candidate.md`.

## Arms (production Batch request, Flash-Lite, k = 3; pages and labels exactly as in the v19 run)
| arm | prompt | runs |
|---|---|---|
| `D`  | v19.1 | new |
| `A3` | v16 | new: a **contemporaneous control**, so D is not compared only with outputs from an earlier batch |
| `A`, `A2`, `B`, `C` | v16, v16, v18, v19 | **reused** from `results/ocr-v19-ab-2026-10.json`; not re-run |

Strata are the v19 run's exactly: W 31, T 38, S3 88, S5 38. That is 195 pages, so 2 new arms × 3 runs × 195 = 1,170 requests.

## Drift check (before scoring D)
If A3's per-stratum outcome differs from A's by more than the A-vs-A2 p90 floor (minimum 1/3 per page) on more than 10% of pages, report the drift. In that case D is scored against **A3** rather than A. Otherwise D is scored against A, so that it shares A's floor.

## Decision rule
The same five clauses as v19, with D in place of C:
1. **W ∪ T:** fabricated falls, with sign p < 0.05.
2. **T:** better on more pages than worse.
3. **S3:** false blank ≤ v16 + 0.05.
4. **S5:** median windowed CER diff ≤ max(floor, 0.01).
5. **Loop guard:** D's Wilson lower bound ≤ A's upper bound.

Also reported:
- **D vs B (v18)** and **D vs C (v19)** on W ∪ T and on S3, with sign tests.
- **Stamp capture:** on the 20 "real mark on a show-through leaf" S3 pages, the share of runs whose BODY contains a right-reading word from that page's label note. Diagnostic.

**Recommendation logic:**
- If D passes 1–5 AND is not worse than v18 on W ∪ T (sign test, worse-on-more-pages counts against D), recommend **v19.1**.
- If D fails, the recommendation stays **v18**.

The promote is Derek's call. The run writes no `prompts` row and nothing to `pages`.

## Budget
1,170 Flash-Lite Batch requests is about $1.4. **Cap $3.**

## Amendments
None yet.
