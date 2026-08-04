# A taxonomy of OCR difficulty, with concrete examples

Built 2026-08-01 (#3473). Rebuild: `node scripts/eval/ocr-difficulty-taxonomy.mjs <corpus.jsonl>`.
Data: `scripts/eval/results/ocr-difficulty-taxonomy-2026-08-01.json`.

## What "difficult" means here

Not opinion, and not scan quality. A page is difficult when **the same model,
running the same prompt, over the same leaf, twice, produced different text.**

That population already exists and cost nothing: **63,572 true-repeat pairs** in
`page_revisions` — same image, same model, same prompt. Isolating it required
first removing pairs whose two passes read *different leaves* (40% of the
corpus, and not re-reading — mostly the #3357 repair moving text between page
docs, see #3473) and pairs where either side is degenerate, a refusal, or
commentary.

**6,420 pages are unstable** (agreement < 0.85), and 93% of them carry none of
the known model-failure flags. They are ordinary pages the model cannot read the
same way twice.

## The headline: it is not the scan

Sampled arms of n=867 each.

| | unstable | stable |
|---|---:|---:|
| carries an OCR `<warning>` | **30.3%** | 4.7% |
| carries a `<scan-quality>` tag at all | 57.3% (497) | 40.8% (354) |
| …and of those, reads *good* | **491 of 497** | 354 of 354 |
| `<page-type>` reads *text* | 810 | 813 |

Among pages the model rated at all, it rated almost every unstable page a **good
scan**, and page types are identical across arms. Whatever makes these pages hard
is **on the page, not in the digitisation** — which kills the intuitive "bad OCR
means bad scan" model for this population.

**Read the denominator, which an earlier draft of this table hid.** "491 of 497"
is 491 of the *tagged* pages, not of the arm: **43% of unstable pages carry no
`<scan-quality>` tag at all** and are silent, not good. And tag *presence* is
itself arm-correlated — 57.3% unstable against 40.8% stable — so the model is
measurably more likely to comment on a scan it will go on to read inconsistently.
That is a real signal the table above discards; it is not evidence those pages
are fine.

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

### A category the first pass mislabelled: the blank leaf read as text

Found by spot-checking the examples against their images — the check every claim
in this document needs and most published taxonomies never get.

*De Dysenteria* (Pincier) p2 was filed here under **faded ink**. It is not faded.
**It is blank.** Every mark on it is mirrored show-through from the title page on
the other side of the leaf: "DE DYSENT…" reversed, the ornamental border
reversed, a library stamp. The OCR's own warning was accurate — "only faint
outlines of the title are visible" — and my category label was wrong.

What makes it a category rather than an error — read all three passes in order:

| pass | `scan-quality` | what it produced |
|---|---|---|
| Apr 14 2026 | **good** | the full title transcribed off the mirror — "DE DYSEN-TERIA THESES, Ad quas, Deo Opt. Max. auxiliante… IOHANNES PINCIERVS" |
| Jul 25 2026 | **good** | the same, again |
| live | **poor** | a `<warning>` naming the show-through, `<unclear>` tags, and "almost entirely illegible" |

Twice the model read ghost text as page content and rated the scan *good*. The
third pass caught it and rated the same scan *poor*. Pilot pair 11 (*Prince
Starbeam*) is the same shape — a near-blank opening whose only marks are verso
ghost text — and was correctly picked as the unstable arm.

**An earlier draft of this section claimed that text "renders to readers as the
transcription of a page it is not on." That was wrong, and the correction
matters more than the claim.** The ghost transcription lives in the *revision
history*; the live pass handles the page correctly. Reading the stored pair and
asserting a reader-facing harm, without checking what the live text actually
says, is the same error as reading an aggregate without opening the artifact.

→ https://sourcelibrary.org/book/de-dysenteria-theses-pincier/page/69b65ce8b3f4fc044151568a

**Measured prevalence in the live corpus: 0.08%.** A page whose live OCR
duplicates a neighbour's is the scalable signature of both ghost transcription
and duplicate scans; across **9,067 adjacent page pairs in 120 visible books**,
7 exceeded Jaccard 0.75. Most of those are legitimate repetition — Tibetan
liturgy, Torah formulae, commentary. So the class is real, is caught by
re-reading, and is **not** a live reader-facing problem at any scale worth a
sweep.

One flag is unresolved rather than cleared: Darwin, *Origin of Species* 6th ed,
p12~p13 and p21~p22 at Jaccard 1.000 with matching word counts. The page records
and images are distinct, so it is not duplicated rows; whether it is a repeated
leaf needs an image comparison that has not been done.

A near-blank screen still belongs upstream of eligibility, and must gate on ink
coverage rather than word count — ghost text produces real words, and 50 of them
cleared the ≥40-word floor here.

Real printed examples that did get flagged:

- *Harmonia Reuchlini et Lutheri* — "fold-out plate with Hebrew characters within a diagram" (0.72); "paper overlays or flaps covering the primary illustration" (0.81)
  → https://sourcelibrary.org/book/harmonia-reuchlini-et-lutheri-a-mdxvii-hardt/page/69c7fa4d6c6f3cc53c842a1c
- *Catalogus Librorum* (Khunrath) p174 — "extremely faded, low contrast, significant bleed-through" (0.63)
  → https://sourcelibrary.org/book/catalogus-librorum-per-quinquennium-a-commissione-aulica-khunrath/page/69b51df5261c58d63664d528
- *De Dysenteria* (Pincier) p2 — "extremely faded… only faint outlines of the title are visible" (0.67)
  → https://sourcelibrary.org/book/de-dysenteria-theses-pincier/page/69b65ce8b3f4fc044151568a

## Spot check (2026-08-01) — what was verified, and against what

Claims in a taxonomy are worth what their examples are worth, so the examples
were checked against the images rather than assumed.

- **All 7 reader URLs resolve**, verified by grepping the response body for a
  not-found marker rather than trusting the status code — every Next.js dynamic
  route returns 200 on a soft-404.
- **Homer, MS Rouse 358 p524** — confirmed Greek minuscule cursive, heavily
  ligatured, ruled in red, with a Latin marginal note in a second hand and the
  facing page intruding at the right edge. Agreement 0.15 is credible.
- **Harmonia Reuchlini p11** — confirmed exactly as warned: a fold-out plate
  where Hebrew runs along a serpentine meander path, Tetragrammaton in the cloud
  above, facing a printed Latin page. The clearest exemplar in the corpus of
  reading-ORDER ambiguity as distinct from legibility.
- **De Dysenteria p2** — warning accurate, **my category label wrong**. See above.

Three of three warnings were accurate; one of three category labels was not. The
error was mine, in the layer that groups warnings, not the model's.

## Signals that direct attention — what to spot-check, and why

Agreement is one number and a mediocre triage signal on its own: 67% of
"instability" is mild glyph variance. These are free, already in the data, and
several separate the arms far more sharply. Sampled arms n=774 / n=741.

| signal | unstable | stable | lift |
|---|---:|---:|---:|
| mean `<unclear>` spans per page | **3.97** | 0.02 | **198×** |
| length asymmetry (shorter side < 80% of longer) | 11.8% | 0.7% | **17×** |
| a `<columns>` tag present on one side only | 5.9% | 0.7% | 8.4× |
| any `<unclear>` at all | 7.1% | 1.1% | 6.5× |
| passes disagree on **page-type** | 1.8% | 0.4% | 4.5× |
| passes disagree on **language tag** | 5.0% | 1.3% | 3.8× |
| page carries an `<image-desc>` | 32.2% | 9.3% | 3.5× |
| marginalia gained or lost between passes | 9.0% | 3.1% | 2.9× |
| page carries a `<margin>` mark | 37.3% | 14.6% | 2.6× |

Three groups, and they are **not** measuring the same thing — which is what makes
them worth combining rather than picking a winner:

1. **The model's own uncertainty.** `<unclear>` is a per-span "I could not read
   this," and it is the sharpest signal available: 3.97 marks per unstable page
   against 0.02 per stable one. It fires on few pages (7.1%) but when it fires it
   fires hard, so it is a high-precision, low-recall flag — exactly what a
   spot-check queue wants at the top.
2. **Structural disagreement, which needs no text comparison at all.** When two
   passes report different page types or languages for one leaf, they disagreed
   about what the page *is*. Reading the envelope tags is enough — no diff, no
   Levenshtein.

   **Correction:** an earlier draft read the `columns_changed` flag as "the passes
   counted columns differently" and claimed it corroborated the reordering class.
   It does not. Decomposed, **588 of 600** flagged pairs are one side emitting a
   `<columns>` tag while the other omits it; only **12 pairs — 0.15%** name
   genuinely different counts. The signal is real but it measures *annotation
   emission*, not layout disagreement. Reading a boolean's name as a claim about
   its contents is the same error as reading a rate without its denominator, and
   it is the third instance in this document.
3. **Content that invites judgement.** Illustrations (3.5×) and marginalia (2.6×)
   mark pages where "what counts as the text" is a decision, and two passes need
   not decide alike.

**On embeddings** — the honest answer is that we do not have them for this, and
they would buy something real. `page_translations` holds embeddings of
*translations*, not of each OCR pass, so pass-vs-pass semantic distance would
need new (paid) embedding calls. What it would add is the one thing every metric
here lacks: Levenshtein cannot distinguish `nūc → nunc` (no meaning change) from
`hunc → hanc` (meaning change), and both score as one substitution. Embedding
distance separates orthographic-policy variance from semantic error — the
difference between a page that is *differently written* and one that is *wrong*.
Scope it to the ~8% of pairs already classed as omission, divergent, or
reordering, not to all 63,572.

## The triage queue, run — and a class it surfaced

`node scripts/eval/ocr-triage.mjs <corpus.jsonl>` ranks the clean unstable pool
into buckets and emits a worked example set with reader and image URLs:
`scripts/eval/results/ocr-triage-2026-08-01.json`. Buckets are kept separate
rather than blended into one score, because a blended rank cannot say *why* a
page surfaced, and the reason is the whole point.

On 2,398 hydrated unstable pages:

| bucket | n | share |
|---|---:|---:|
| illustration on the page | 728 | 30.4% |
| one pass produced far more text | 232 | 9.7% |
| marginalia gained or lost | 204 | 8.5% |
| model flagged spans it could not read | 162 | 6.8% |
| passes disagreed on language | 107 | 4.5% |
| passes disagreed on page type | 58 | 2.4% |
| passes genuinely disagreed on column count | 1 | 0.04% |

**The `<unclear>` bucket works as designed.** Its top three are manuscript hands
and nothing else — Avicenna's *Canon*, 13th-c. Gothic textualis, **657** unclear
marks; Bodleian MS Barocci 241, Greek minuscule, 531; a German Kurrent freemasonry
history, 397. Ranking by that count puts pages the model itself says it failed on
at the head of the queue, with no text comparison at all.

### New class found by the queue: the plate/text classification flip

Dozens of pairs read `words = [0, 269]` or `[231, 0]` — **one pass produced no
body text whatever**, and agreement lands near 0.00. They concentrate in one
place: Schott's illustrated mechanical treatises.

*Mechanica Hydraulico-Pneumatica* p513, agreement **0.004**, words 231 vs 0 —
a full-page engraving of a hydraulic organ automaton, captioned "Iconismus
XXXIX. pag: 408", with label letters (V, X, Y, T, S, R, M, N, O, Q, L, P, H, A,
F, Z) and the numbers 1–8 scattered across the figure. No prose anywhere.

→ https://sourcelibrary.org/book/p-gasparis-schotti-mechanica-hydraulico-pneumatica-qua-schott/page/69b6a4f5080b19f98fd2164f

One pass transcribed the caption and the scattered labels as page text. The other
emitted an `<image-desc>` and stopped. **Neither is wrong.** Are the label letters
on an engraving "text on the page" or part of the illustration? Nothing in the
prompt decides it, so the two passes decided differently and the transcription
went from 231 words to zero.

This is the cleanest case in the corpus of the pattern the printed-page section
predicted: **a specification gap, not a reading failure.** It also explains why
"illustration on the page" is the largest bucket at 30.4% — where text meets
image, the boundary of "the text" is undefined, and an undefined boundary is
re-decided on every run. Unlike legibility, this one is fixable in the prompt.

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
