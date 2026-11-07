---
stage: ocr
measure: [judged]
languages: [es, fr]
scripts: [Latn]
canons: []
n_books: 44
n_pages: 60
verdict: "Both cells pass on new pages: Spanish 28/30 accepted, 1 wrong text (3.3%), P 0.962; French 29/30, 0 wrong text, P 0.992, plants 2/2. 0 marker residue."
status: adopted
decision: "Spanish route on (cron :45); French route on, ranked after Spanish (cron :15). One pool, .agy-milo."
feeds: route
superseded_by: null
defect_rates: scripts/eval/route-judge-6740/results/euro-route-gate-6871/defect-rates.json
landed: scripts/gpu/ocr-filler-routes.tsv
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

### Results (2026-11-07, pilot through the real lane, `armc --apply`, pilot checkout with #8296)

| | Spanish 1800-1929 (es19) | French 1800-1929 (fr19) |
|---|---|---|
| pilot pages tried | 290 (15 books, ~22 a book) | 210 (70 books, 3 a book; the 60 cell-test books skipped, `--skip-books`) |
| written | 201 (69%) | 86 (41%) |
| gate draw | 30 pages, **14 books: same books as the cell test, new pages** | 30 pages, 30 books, none judged before |
| accepted (Opus, blind, vs image) | 28/30 | 29/30 |
| wrong text | 1 (3.3%): old-style 1 read as 4 (`4503` for 1503, `47` for 17) | 0 |
| other rejection | 1 misleads: a people's name misspelt (`itzceaqueños`) | 1 misleads: an index page number `28*` for `287*` (faint 7) |
| P(acc ≥ 0.8), Beta(1+k, 1+n−k) | 0.962 | 0.992 |
| wrong-page controls rejected | 2/2 | 2/2 |
| planted errors caught | none (no Spanish planter) | 2/2 |
| **gate** | **PASS** | **PASS** |
| marker residue in written text | 0 | 0 |
| defects per 1,000 words (all Opus verdict defects; `defect-rates.json`) | wrong text 0.23, misleads 0.58, cosmetic 1.63 (8,579 words) | wrong text 0, misleads 0.10, cosmetic 2.20 (10,022 words) |
| agy calls / written page | 1.43 (288/201); 1.10 without the 67 calls lost to exit -9 | 2.24 (193/86) |
| GPU drafts | 290 in 8 min incl. vLLM start (~2,200 pages/h) | 210 in 10 min incl. image fetch (~1,260 pages/h) |
| correction throughput | ~165 pages/h (1 book at a time, 2 reads) | ~400 pages/h (3 books at a time) |

**Spanish unwritten (89 of 290).** 67 `cli exit -9`: agy printed a whole SUCCESS reply and hung, and the pilot checkout
predated #8110 (`cliExitCode`), so apply refused them; main's own comment keeps pre-#8110 metas refused, so they stay
unwritten (ledgered; not re-read by this lane). Model-side refusals 22 of 223 not killed = **9.9%**, against ~11% in the
cell test: never opened the image 6, UNCHANGED 5, GPU draft under 30 characters 4, diff-guard splice 3, wrapper 2,
handwritten 1, exit 1.

**French unwritten (124 of 210).** Handwritten 41 + mixed 6 (22%); GPU draft under 30 characters 26 (blank / plate
pages); letters outside the book's scripts 19; never opened the image 10; wrapper cut or second marker 8; diff-guard
splice 6; UNCHANGED 5; exit 3 2; CONTAIN 1. Of the printable pages (no hand tag, a draft), 86/137 = 63% were written,
against ~53% overall in the cell test. **The handwritten tag is right**: 6 of the 41, drawn at random, opened by eye
are all manuscripts (Masonic rituals and catechisms, a manuscript notebook, a framed charter: cmc_kloss and similar
books catalogued as French print). 14 of the 70 books had 2-3 of their 3 pages tagged and none written. So the lane now
probes a book it has not read with 4 pages and skips it when half or more are tagged handwritten or mixed
(`armcHandSkip`, `<lane>/armc-books-skipped.jsonl`), and the 14 pilot books are seeded into that file.

**Not counted by the rule:** the two misleads defects are digit / name misreads the #7695 put-back does not touch
(it guards numbers the corrector *changed* against the draft; here the draft had them wrong too).

Results files: `scripts/eval/route-judge-6740/results/euro-route-gate-6871/{es19,fr19}/` (sample, key, score, verdicts).
