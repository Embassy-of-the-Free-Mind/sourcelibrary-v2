---
stage: translation
measure: [judged, judged_vs_reference]
languages: []
scripts: []
canons: []
n_books: 500
n_pages: 1000
verdict: "Opus via the CLI repaired 227 of 500 high-precision tranche joins in production (348 pages), each preferred by a blind Opus judge in both orders; the image-grounded judge agreed on 30/30. Sonnet found fewer defects (45 vs 61 verified per 100). Quota, not wall clock, limits the ~330K scale-up."
status: undecided
decision: null
superseded_by: null
issue: 6742
---
## 2026-10-15 · Seam repair pilot, $0: Opus fixes bad page joins on the subscription (#6742)

PRIOR ART: `2026-10-15-seams-scale-opus-flashlite-6742.md` measured the defect (31% of prose joins, 11% major) and
found the deterministic tranche (catchword echo, `dup8`, `carried`, `ocrNext`, bracketed bridge) 29/30 precise. This
entry repairs that tranche in production. The prompts, the placement check and the blind judge are that entry's, unchanged.

**Method.**
- Draw: frame `break-frame.mjs` (2026-10-15). Books in a seeded shuffle. Per book, a window of 24 eligible pages,
  and the first tranche join in it. 923 books scanned, 500 joins (one per book). Books are live and not held. Pages
  are machine-translated, not human-edited, withheld or same-language.
- Repair: Opus (`claude-opus-5-5`, Claude CLI, subscription) gets both pages' source and English at the join, with
  10 joins per call. It labels each join and writes a minimal edge edit.
- Placement: the old spans must be verbatim at the excerpt edges. Each changed side may touch at most 3 sentences.
  The span must occur exactly once in the STORED text, with only tags or whitespace between it and the page edge.
- Verify: a second, blind Opus judge sees current and repaired versions as P/Q, both orders, in different calls,
  10 pairs per call, plus 20 A/A pairs. A repair is written only if the judge prefers it in BOTH orders.
- Image check: 30 random accepted repairs, the same judge reading both page images (Read tool), both orders.
- Write: `writePageTranslation`, one write per changed page, `refuseUnhealthy`. Note and job id are `seam-repair-6742`.
  The engine block is api `cli`, call site `seam-repair-6742`. Each page keeps its model and prompt identity.
  After each write, the job re-reads the page and asserts a changed `content_hash` and a `page_revisions` row
  holding the prior text.

**Results.**

| step | Opus (500) | Sonnet (first 100) | Opus on the same 100 |
|---|---:|---:|---:|
| labelled defective | 397 | 67 | 79 |
| placed (excerpt checks) | 318 | 47 | 64 |
| judge prefers repair, both orders | 304 | 45 | 61 |
| judge prefers current, both orders | 0 | 0 | 0 |
| A/A pairs called tie | 20/20 | 10/10 | — |

- Refused at placement (Opus): 102 labelled ok, 45 touch more than 3 sentences, 13 old span not at the edge,
  11 no repair, 10 edit too large, 1 unparsed.
- Written: **227 joins, 348 pages**, 348 revision rows. Re-read from Mongo, all 348 hashes match the manifest.
- Refused at the write (77 of 304): 61 spans not verbatim in the stored text (they cross an inline `<note>`/`<term>`,
  or copy tag residue), 12 not at the stored edge, 3 not unique, and 1 door refusal. That page already failed the echo
  health check before any edit.
- Image check: the judge with the page images preferred the repair in both orders on **30/30** (Wilson 95% 89–100%).
- Sonnet vs Opus: Sonnet called 31 of the 100 tranche joins "ok", where Opus called 20 ok. The tranche is ~97%
  precise, so Sonnet misses defects. Placement and judge win rates are about equal (Sonnet 45/47, Opus 61/64).
  Sonnet is cheaper per call (list $0.18 vs $0.34) but yields fewer repairs: 45 vs 61 per 100 joins. **Opus kept.**
- Calls: 50 repair calls (500 joins), 70 verify calls (676 pairs), 60 image calls; 0 failures.
  List-price equivalent (not billed; subscription) $3.4 repair + $4.2 verify per 100 joins.
- Throughput, one box, 4 concurrent: 400 joins repaired in 11.5 min, and verified in 4.3 min. That is about
  **1,500 joins/hour**, or about 680 written joins/hour at this pilot's 45% write yield.
- Quota: the account meter went from session 7% / weekly 76% (18:48Z) to 25% / 79% (19:06Z). The account was
  shared with two other Opus jobs, so this is an upper bound: ≈ 0.6 weekly points per 100 joins.
- Jev (source-grounded form) was NOT run. The Vercel AI Gateway returned 401: the box's `VERCEL_OIDC_TOKEN` has
  expired, and this box has no Vercel login to pull a new one. The script is `jev-grounded.mjs`. It needs one
  `vercel env pull` on a logged-in box, and costs < $0.01 for the 300 items.

**What it means.**
- The repair loop is clean at pilot scale. The judge and the image-grounded judge agree 30/30, A/A floors are 30/30
  ties, and there were no unexplained refusals.
- The binding constraint for the ~330K tranche is subscription quota, not time. At ≈ 0.6 weekly points per 100 joins,
  330K joins is ~2,000 weekly points: about 20 account-weeks.
  - Cheaper verification would cut that, e.g. one order only, with the second order run only on a P/Q-position
    disagreement.
  - Writing the 61 refused-at-store repairs needs tag-aware mapping.
- Undo: `seam-repair.mjs undo --out=DIR --apply` restores every page from its revision row. The dry run on
  2026-10-15 found all 348 restorable. Manifest: `scripts/eval/results/seam-repair-6742/manifest.jsonl.gz`.

Data: `scripts/eval/results/seam-repair-6742/` (candidates without excerpts, repairs, verdicts, image check,
refusals, calls, manifest, report.json, examples.md). Script: `scripts/maintenance/seam-repair-6742/seam-repair.mjs`.
