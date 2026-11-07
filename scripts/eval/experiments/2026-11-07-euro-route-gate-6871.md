---
stage: ocr
measure: [judged]
languages: [es, fr]
scripts: [Latn]
canons: []
n_books: null
n_pages: null
verdict: "PENDING: the gate on new pages runs after this rule is committed."
status: undecided
decision: "PENDING"
feeds: route
superseded_by: null
issue: [6871]
router_evidence: "none — the router table is not edited (brief); results under scripts/eval/route-judge-6740/results/euro-route-gate-6871/"
---
## 2026-11-07 · Spanish, then French, 1800-1929: the GPU draft > agy route turned on, gated on new pages (#6871)

Part of #6871.

PRIOR ART: `2026-11-07-euro-gpu-agy-cells-6871.md` (the cell test whose passing scores came from the #8296 parser
fix made after the first results; this file re-tests on pages that fix has run on), and its harness
`scripts/eval/route-judge-6740/jcb-1600-8049/run.mjs` (`packet`, `plant`, `score`) with `judge.mjs judge`, reused
unchanged. The lane is the existing arm-c lane, generalised: `cli-ocr-lane.mjs armc --frame=euro --cell=es19|fr19`.

### Route (one per cell)
LightOnOCR-3-1B draft on gex45 (`scripts/gpu/euro-draft-task.sh`, an ocr-filler `euro-draft` chunk), then agy
`gemini-3.8-flash-low` correcting with the page image, one page a call, template `agy-0601ef30e816f7a7`, #7695
put-back against the draft, printed only, unread pages only, written by `cli-ocr.mjs apply --diff-guard=gpu-draft
--print-only` and stamped `gpu-agy-first-read-euro-6871`. With #8296 merged (a reply with a second marker inside the
block is refused). One agy pool for both cells.

### Frame (the cell test's book rule, `armcEuroSkip`)
- The book's first language is the cell's (`firstReadLanguage`: spa / fra); parsed `year` 1800-1929 (no year, no book).
- Page records exist: `pages_state` not `manifest_only` / `materializing` (no manifest-only book, nothing materialized).
- Not an unsplit spread (`needs_splitting` and not `split_completed`); not a manuscript (`manuscriptReason`); and, as
  every arm-c frame, a book with no page crop data that is not `split_checked` waits (`spreadReason`).
- Not `pipeline_auto.held`; not held, or held only `scans-only-publish-7270`. Every containment or quality hold
  (wrong-leaf, invented, recitation, …) and every lane, campaign or person's hold keeps the book out. No hold is released.
- French only: not a book the gex45 `run --cohort=visible-unread --languages=deu,fra` cron reads (that lane's
  `firstReadSkip` is null for it: visible, held scans-only). That lane reads French at 4 a call; this one does not
  touch its books, so no page is paid for twice.
- Pages: no text (`UNREAD`) and no human edit.

### Gate (fixed before judging; the #8049 rule, unchanged)
1. **Pilot** through the real lane (`armc --apply`): about 300 Spanish pages, planned as about 22 a book over every
   book in frame (`armc-plan --per-book`).
2. **Draw**: 30 WRITTEN pilot pages, at random (seeded, salt `6871-gate-<cell>`), one per book where books allow, then a
   second page from books already drawn, in the same seeded order. Pages judged in the cell test are excluded (they
   are no longer unread, or were rejected and are not planned). Spanish 1800-1929 has about 17 books the lane can
   plan, the same books as the cell test: **same books, new pages** is expected.
3. **Judge**: blind Opus against the image (`judge.mjs judge`), with 2 wrong-page controls a cell (`run.mjs packet`).
   **Spanish has no planted control** (the planter knows la/fr/de). French gets 2 planted errors (`run.mjs plant`).
4. **Rule** per cell: at least 10 judged; wrong text ≤ 4%; P(acc ≥ 0.8) ≥ 0.9 under Beta(1+k, 1+n−k) over the judged
   written pages; every wrong-page control rejected (fidelity ≤ 2); planted errors not both missed.
5. **Also counted**, not part of the rule: marker residue (`<<<BEGIN>>>` / `<<<END>>>`) in written text, which must be
   0; the share of pilot pages refused (unwritten), against about 11% in the cell test (Spanish 3/27); agy calls a
   written page (1.5 in the cell test); GPU pages an hour.
6. **Spanish passes**: its route stays on. **Spanish fails**: route off; the pilot's written pages stay only if judged
   acceptable, else they are reverted (`revert-run.mjs`); French is not tried.
7. **French**, only if Spanish passes: the same gate on about 300 pages from books NOT judged in the cell test
   (both draws' sample files). French passes: its route turns on, ranked after Spanish (`--after-lane`). French fails:
   it stays off. If most unwritten French pages are ones agy tags handwritten, a few are opened by eye.

### Results
PENDING.
