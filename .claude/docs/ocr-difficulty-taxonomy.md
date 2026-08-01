# A taxonomy of OCR difficulty, with concrete examples

Built 2026-08-01 (#3473). Rebuild: `node scripts/eval/ocr-difficulty-taxonomy.mjs <corpus.jsonl>`.
Data: `scripts/eval/results/ocr-difficulty-taxonomy-2026-08-01.json`.

## What "difficult" means here

Not opinion, and not scan quality. A page is difficult when **the same model,
running the same prompt, over the same leaf, twice, produced different text.**

That population already exists and cost nothing: **63,572 true-repeat pairs** in
`page_revisions` — same image, same model, same prompt. Isolating it required
first removing pairs whose two passes read *different leaves* (40% of the
corpus; re-archiving, not re-reading — see #3473) and pairs where either side is
degenerate, a refusal, or commentary.

**6,420 pages are unstable** (agreement < 0.85), and 93% of them carry none of
the known model-failure flags. They are ordinary pages the model cannot read the
same way twice.

## The headline: it is not the scan

| | unstable | stable |
|---|---:|---:|
| carries an OCR `<warning>` | **30.3%** | 4.7% |
| `<scan-quality>` reads *good* | **491 of 497** | 354 of 354 |
| `<page-type>` reads *text* | 810 | 813 |

The model rates almost every unstable page a **good scan**, and page types are
identical across arms. Whatever makes these pages hard is **on the page, not in
the digitisation**. That kills the intuitive model — "bad OCR means bad scan" —
for this population.

## Primary axis: manuscript hand

**28.7% of unstable pages vs 2.6% of stable — an 11× lift, and 95% of every
warning-bearing unstable page.**

This one category swamps everything. A hand has no fixed letterforms, so two
passes segment the same strokes differently.

- *Ortus Sanitatis* p823, agreement 0.75 — "Handwritten marginalia in Latin cursive script"
  → https://sourcelibrary.org/book/ortus-sanitatis-meydenbach/page/6958e850538549809db822cb
- *Vat. lat. 5953* (Ficino) p827, agreement 0.69 — "Handwritten humanistic cursive script"
  → https://sourcelibrary.org/book/vat-lat-5953-ficino/page/6990660aef12272ffdc9522b
- Homer, Christ's College MS Rouse 358, p524, agreement **0.15** — "Handwritten Greek minuscule"
  → https://sourcelibrary.org/book/homer-cambridge-christ-s-college-ms-rouse-358-homer/page/699382dd84cf5845c644b583
- Korndörffer/Grossschedel alchemical collection — "Kurrent script, ink bleed-through and marginal symbols", agreement 0.69 and 0.43
  → https://sourcelibrary.org/book/alchemical-collection-korndorffer-grossschedel-post-1627-aicha/page/69b41884f1200e2ab53cfcf5

**A correction worth keeping.** The first cut of this taxonomy reported fifteen
independent categories. It was running fifteen regexes over the *same warning
sentence*: "Handwritten Greek minuscule script" scored as handwriting AND
mixed-script AND abbreviation, and "mixed script or language" came out at 64×
lift on pages that contain exactly one script. A taxonomy assembled that way
manufactures structure out of one clause. Manuscript-vs-print is the split;
everything else must be read *within* print.

## Secondary, on printed pages only — and here the instrument goes dark

Printed unstable pages n=618, printed stable n=809.

| feature | unstable | stable | lift | n |
|---|---:|---:|---:|---:|
| bleed-through from the verso | 0.81% | 0.25% | 2.5× | 5 |
| mixed script or language | 0.49% | 0.12% | 3× | 3 |
| faded or faint ink | 0.49% | 0.25% | 1.5× | 3 |
| stain, foxing, damage | 0.49% | 1.24% | **0.3×** | 3 |
| complex layout | 0.32% | 0% | — | 2 |
| cropped or cut off | 0.32% | 0.12% | 2× | 2 |
| dark / glare, blur | 0.16% each | 0% | — | 1 each |
| marginalia, abbreviation, symbols, skew, microfilm | 0% | ~0% | — | 0 |

**This is a negative result and it matters more than the positive one.**
Printed pages are **69% of the unstable population**, and on them the warning
channel explains essentially nothing — the biggest category is five pages.
Damage is *negatively* associated. So:

> The model can tell you why a manuscript page is hard. It cannot tell you why a
> printed page it read two different ways is hard.

The blind pilot (`scripts/eval/results/repeat-instability-2026-07-31/`) points at
what the warning tag is missing. Where a human-style judgement correctly picked
the unstable page, the difference was **categorical and structural**, never a
scan defect: text clipped at the page edge, a title page against running prose,
six levels of nested braces against three, a near-blank leaf whose only visible
marks are show-through. Those are **reading-order and transcription-policy**
ambiguities — what to include, in what sequence — not legibility.

Real printed examples that did get flagged:

- *Harmonia Reuchlini et Lutheri* — "fold-out plate with Hebrew characters within a diagram" (0.72); "paper overlays or flaps covering the primary illustration" (0.81)
  → https://sourcelibrary.org/book/harmonia-reuchlini-et-lutheri-a-mdxvii-hardt/page/69c7fa4d6c6f3cc53c842a1c
- *Catalogus Librorum* (Khunrath) p174 — "extremely faded, low contrast, significant bleed-through" (0.63)
  → https://sourcelibrary.org/book/catalogus-librorum-per-quinquennium-a-commissione-aulica-khunrath/page/69b51df5261c58d63664d528
- *De Dysenteria* (Pincier) p2 — "extremely faded… only faint outlines of the title are visible" (0.67)
  → https://sourcelibrary.org/book/de-dysenteria-theses-pincier/page/69b65ce8b3f4fc044151568a

## Caveats

1. **The channels are not independent.** The `<warning>` tag is written by the
   same model whose run-to-run disagreement defines the arms. A model having
   trouble may be likelier to say so. Read the lifts as corroboration across two
   channels, not as external validation.
2. **Blind to fabrication.** Two passes that both recite the same memorised
   canonical text agree perfectly and never enter the unstable arm. This finds
   unstable pages, not wrong ones — on canonical material those differ
   (`/blog/reciting-not-reading`).
3. **"Stable" is not "correct."** Consistency is the thing under test, so the
   control arm cannot be assumed accurate.
4. Rates are per sampled arm (n=900 each), stratified by even stride over a
   page_id-ordered file, not by book.

## Next

The printed 69% is the open question, and the warning tag cannot answer it.
Extending the blind pilot with **categorical feature labels** — clipped edge,
display typography, braced outline, table, near-blank, marginal hand on printed
text — is the way to populate that half of the taxonomy. The draw script and
manifest format already support it: `scripts/eval/repeat-instability-draw.mjs`.
