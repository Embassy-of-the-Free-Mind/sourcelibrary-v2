# The corpus dataset, and what measuring it taught about measuring — 2026-08-02/06

PR **#3656** (`worktree-feat+corpus-dataset`, 10 commits, all under `scripts/eval/`
plus one doc — no production code paths touched).

## What was built

| script | what it does | cost |
|---|---|---|
| `build-corpus-dataset.mjs` | books/pages/revisions/TF-IDF CSVs | free, resumable |
| `corpus-dataset-report.mjs` | reproduces every figure from the CSVs | free, offline |
| `corpus-signal-audit.mjs` | scores ten disagreement signals, emits a review queue | free, offline |
| `ocr-self-agreement.mjs` | cross-model containment, per language / per book | cents |
| `typeface-divergence-artifact.mjs` | 3 model tiers × 120 pages, with image URLs | ~$3 |
| `ocr-quality-screen.mjs` | corpus-wide screen + blinded stratified sampler + volunteer tasks | free |
| `tibetan-split-pilot.mjs` | bbox-split a composite, re-OCR each leaf | cents |

Data: `books.csv` 2,135 · `pages.csv` 779,409 · `revisions.csv` 191,221 ·
`book_terms.csv` 83,776 · `tfidf_vocab.csv` 715,194, in
`scripts/output/corpus-dataset/` (scratch, gitignored).

## Findings that survived scrutiny

**The corpus needs one filter before any use.** 29.5% of OCR revisions are
`source='shift-repair-erara-2026-07'` — #3357 moving text between pages, so the
"prior" side is the *neighbouring page's* transcription. Filter
`provenance_class='reocr' AND printed_page_shift != 1` → 131,965 clean pairs
(69%). Residual leaf-shift is then **4.2%**, not the ~40% measured on the raw
corpus. The shift test abstains on 49.9% of pairs (no readable printed number),
so 4.2% is a lower bound.

**Re-OCR is not uniformly an improvement, and the split is by failure class.**
Commentary-as-transcription: 589 fixed / 303 introduced. Repetition loops: 352 /
614 — net worse. Almost entirely Tibetan and CJK on `flash-lite-preview`
(Tibetan × lite = 25.1%, and 341 of all 614 newly-broken pages). Excluding
Tibetan the net is +45 across 99,223, i.e. negligible.

**The OCR failure axis is letterform familiarity, not language.** Within Hebrew,
identical model and prompt: printed square 96–98%, *Mikraot Gedolot* (square
text + Rashi commentary on the same page) 28%, cursive manuscript 9%, Zohar 0%.
Arabic 80%, Sanskrit 65%. This reproduces `/blog/rashi-ocr` from an independent
instrument — and covers the gap that post flagged as unsolved, since semantic
alignment passed it (OCR and translation were generated from the same
hallucination, so they agreed).

`gemini-3.1-pro-preview` fails too — not a routing fix. The tiers fail
*differently*: lite fabricates fluently, flash truncates, pro leaks its own
reasoning into the transcription ("Wait, Hebrew books ope…").

**Splitting multi-leaf Tibetan scans fixes the loops but not the reading.** 8 of
9 composites stopped looping after bbox-split + re-OCR with the same cheap
model. But cross-model agreement on the split leaves stays ~13–34%, so the text
is still not trustworthy. 62 of 68 measured Tibetan books are composite-shaped
with `needs_splitting=false`; 1,445 BL Tibetan books have no `split_geometry` at
all.

## Method lessons — the actual value of the session

Three of my own metrics produced confident wrong answers before data corrected
them. Each is documented in the commit that fixed it.

1. **Jaccard punishes extent, not just content.** It labelled German "NOT
   READING" at 31% when containment was 93% — one model had simply transcribed
   further down the page. Use the overlap coefficient.
2. **Whitespace tokenizing silently deletes space-less scripts.** Every Chinese
   page scored "thin" and Chinese reported `n=0` — missing data that was a bug.
   Character trigrams fix it. `revision-agreement-corpus.mjs` had already solved
   this; I didn't carry it over.
3. **A signal scored against a label it helped define will look excellent.**
   `|Δ words| > 100` scores 5.1× against a degeneracy label (which is itself a
   length-correlated quantity) and **1.1×** against an independent one. Always
   score against a target with no shared definition.
4. **The strongest signal was detecting repairs, not damage.** `body_emptied`
   (7.4× lift) fires on pages where a contaminated prior was replaced by correct
   text — Micrographia p289's prior was *Mersenne's Harmonicorum Libri*, a
   different book. 61 of 72 such queue pages have a clean live page.
5. **Instrument abstention is not random.** The printed-page-number test
   abstains on 49.9% of pairs corpus-wide but **97.3%** of the review queue,
   because a page that becomes a plate has no printed number. Signals concentrate
   where the adjudicating instrument cannot run.

## State / what's next

- **PR #3656 open.** No production paths touched.
- **Volunteer queue is armed but not fired.**
  `node scripts/maintenance/build-page-check-candidates.mjs --file scripts/output/ocr-screen/volunteer-tasks.json --apply`
  queues 68 blinded pages. Deliberately not run — that's a call for a human.
- **Blocked on a reader.** Hebrew and Tibetan verdicts need someone who reads
  them. No metric here substitutes, and this is the gate before any re-OCR spend.
- **Do not bulk re-OCR Tibetan/CJK** on current models: it replaces detectable
  garbage (loops) with undetectable garbage (fluent fabrication).
- **Possible overlap.** `#3475` landed mid-session doing an adjacent
  `page_revisions` audit, and worktree `feat-double-ocr-dataset` has an open PR.
  Reconcile before building further — two instruments measuring one corpus is
  worth more than a third.
- **Incidental:** `GEMINI_API_KEY` in the local `.env.production.local` is
  **invalid**; `_3` works. If that file mirrors Vercel, worth checking whether
  realtime OCR is affected. Also one mojibake author name (`Thomas, de Cantimpré`)
  is still wrong in Mongo — it surfaced by breaking an artifact deploy.

## Follow-up: an invariant doc needs this, and this branch can't carry it

`.claude/docs/invariants/page-revisions-corpus.md` landed on `main` on 2026-08-04,
*after* this worktree branched, so the file does not exist here and the edit
cannot ride this PR. Apply it on a fresh branch off current `main` — it corrects
a stat that is now materially misleading (that doc still says "~40% of the time
they did not [read the same image]", full stop).

Replace the bullet beginning **"Exclude pairs whose printed page numbers
disagree"** with:

> - **Filter on `source` FIRST — the contaminant is labelled, and the page-number test is only the fallback.** Re-measured 2026-08-06 over the full corpus (now **191,221** OCR revisions, not 109,953): 56,413 (29.5%) carry `source='shift-repair-erara-2026-07'`. Dropping those by their own label, then dropping confirmed shifts, leaves **131,965 clean same-image pairs (69%)** — and the residual leaf-shift rate falls to **4.2%**, not ~40%. The 40.2% figure is correct *for the raw corpus* and badly misleading once the label is used. Predicate: `provenance_class='reocr' AND printed_page_shift != 1` (`scripts/eval/corpus-dataset-report.mjs` prints the ladder).
> - **The page-number test abstains on half the corpus, and its abstention is not random.** A printed number is readable on both sides of only **50.1%** of candidate pairs, so 4.2% is a *lower bound* on image churn. Abstention concentrates exactly where disagreement signals fire: 97.3% of a high-signal review queue versus 49.9% corpus-wide, because a page that becomes a plate has no printed number. **Never read "no shift detected" as "same image."**

Also update the opening count: 109,953 pairs → 191,221 revisions as of 2026-08-06.
