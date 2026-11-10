---
stage: metadata
measure: [judged]
languages: [zho, lat, deu, eng, nld, fas]
scripts: [Hani, Latn, Arab]
canons: []
n_books: 10
n_pages: 2042
verdict: "A book summary + chapters built from the stored per-page <summary>/<keywords> blocks (arm B) costs about a fifth of the live full-text lane (arm A): 11 agy requests against 24, 324K input tokens against 1.66M, 217 s against 870 s for 10 books. It is not as accurate. Blind Opus judge: 15 unsupported or wrong claims in B's summaries against 12 in A's (the rule allowed 13). Preference A 5, B 3, tie 2. Specificity 43 against 47 (sum of 1-5 scores), chapter completeness 39 against 40. One book did most of the damage: Hermetic Rosary, A 2 / B 6 (B misplaced who said what and moved details between chapters). On the 4 gap books (3 Siku Chinese, 1 Latin) B did better: 2 claims against 5, and the judge preferred B on 2 of them."
status: rejected
decision: "Keep full-text input for enrichment's summary + chapters step (enrich-worker.mjs --agy). The page summaries stay unused by enrichment."
superseded_by: null
issue: [8512, 7628]
---
PRIOR ART: `2026-10-28-enrich-agy-one-call-7628.md` (the live one-call lane this is compared against; its transport,
150K message cut and style check are reused unchanged) and `scripts/workers/lib/enrich-agy-lane.mjs`. Script:
`scripts/eval/enrich-from-page-summaries-8512.mjs` (select | armb | pack | write). Per-book outputs, judge packets and
verdicts are in the job's scratch (`/mnt/HC_Volume_105839809/jobs/enrich-summaries-8512/run/`), not committed.

## 2026-11-10 · Can the book summary + chapters come from the stored page summaries? (#8512)

**Why.** Every translation call ends with one `<summary>` and one `<keywords>` for its pages, and these are stored in
`translation.data`. Enrichment strips them and reads the whole English text again. The page summaries are 1-11% of
the text's size, so if a summary built from them were as good, the summary + chapters step would cost a fraction of
what it does now.

**Arms.**
- **A (live):** `enrich-worker.mjs --agy --compare-out=DIR --book-ids-file=…`, nothing written. agy 3.8 Flash-low,
  pool `/root/.agy-milo`, one conversation a book in ≤150K-character messages (Diophantus, read from OCR at 891K
  characters, went in 2 parts).
- **B (summaries):** one agy 3.8 Flash-low request per book (two for one book). Input: the page summaries + keywords
  in page order, with page numbers, plus the chapter headings found by the lane's own heading detector. Same JSON schema
  for summary/reading_summary and chapters, the same style check at the end, parsed by the lane's own parse functions.
  Same pool and quota floor.

**Selection (seed 8512).** Books ranked by `sha256(seed:id)` inside a length band. A book is taken when ≥70% of its
translated pages carry a `<summary>`, its English is ≤600K characters, ≥50% of its pages are translated,
`enrichmentSkip` passes with no withheld page, it has no row in the batch lane's state collection, and its language is
under the cap. Bands: 5 short (100-199 pages) and 5 long (400-600, then 250-399).
Stage 1 draws from the agy lane's own gap (`gapFilter`, language cap 3). **Only 4 gap books passed**: 63 of the 298 gap
books looked at had ≥70% summaries, and 40 of those were held as untranslated. No long gap book was ≤600K. Stage 2
filled the other 6 from live, unheld books that are already enriched (language cap 2). These 6 were judged and never
written.

**Judge.** One blind Opus Agent call per book, with X/Y order set by the seed. It got both outputs and the book's
English text with the wrappers stripped. Per summary it listed the unsupported or wrong claims with the pages it
checked, and scored specificity 1-5 and chapter completeness 1-5 against the headings. Then a preference.
**Instrument check:** 2 false claims planted in one output each for 2 books. Coclico Y: "dedicated to Charles V /
Vienna" and "appendix of twelve Senfl motets". Herder X: "dedicated to Mendelssohn" and "Theophron quotes Kant's CPR at
length". **Caught 4/4.** One caveat: on the planted Coclico run the judge listed only the 2 planted claims. It missed
the real one it had found in the clean run (*musica reservata*), so its recall of real errors varies from run to run.
Read the claim counts as ±1-2 a book.

**Cap override.** The `enrich-agy` daily ledger, which the cron shares, was already at 1,295 of its 600 calls when
arm A ran. Arm A ran with `--max-calls-day` raised to 1400/1500 for its 24 requests (logs `a.log`, `a2.log`).

## Results

| book | lang | pages | chars | req A/B | input tok A/B | s A/B | unsupported A/B | spec A/B | chapters A/B | pref |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Classic and Commentary of Ancient Music j.1 *(gap)* | zho | 100 | 192K | 1/1 | 30K/15K | 26/12 | 1/1 | 4/4 | 4/4 | tie |
| Fourfold Examinations of the Mountain Hall j.53-54 *(gap)* | zho | 100 | 178K | 1/1 | 35K/26K | 30/19 | 0/0 | 4/5 | 4/5 | B |
| Shijing Baishu j.4 *(gap)* | zho | 101 | 255K | 2/1 | 82K/18K | 36/15 | 2/0 | 5/5 | 4/3 | B |
| Coclico, Compendium musices *(gap)* | lat | 126 | 152K | 1/1 | 32K/28K | 39/17 | 2/1 | 5/4 | 4/3 | A |
| Hermetic Rosary | deu | 121 | 342K | 2/1 | 119K/26K | 112/32 | 2/6 | 5/4 | 5/4 | A |
| Diophantus of Alexandria (Heath) | eng | 404 | 891K | 7/1 | 702K/50K | 84/21 | 2/2 | 5/5 | 3/4 | B |
| Herder, God: Some Conversations | deu | 280 | 590K | 2/1 | 101K/32K | 38/13 | 0/0 | 5/5 | 5/5 | tie |
| God is the Purest Love | nld | 282 | 572K | 3/2 | 202K/74K | 406/57 | 0/2 | 5/4 | 4/4 | A |
| Steiner, The Way of Initiation | deu/eng | 260 | 565K | 2/1 | 141K/31K | 58/17 | 1/1 | 5/4 | 5/5 | A |
| Tuḥfat al-ʻIrāqayn | fas | 268 | 488K | 3/1 | 216K/25K | 41/14 | 2/2 | 4/3 | 2/2 | A |
| **total** | | **2,042** | **4.23M** | **24/11** | **1.66M/324K** | **870/217** | **12/15** | **47/43** | **40/39** | **A 5 · B 3 · tie 2** |

Output tokens: A 139K, B 40K.

**Rule (#8512).** Switch if B has no more unsupported claims than A over the 10 books (+1 allowed) and the judge does not
prefer A on ≥7/10. The preference half passes (A 5). **The claim half fails: B 15 > 13.** Without Hermetic Rosary it
would be B 9 against A 10, so one book decides the result, and the judge's run-to-run variance (above) is about the
same size as the margin. The rule was set in advance and is applied as written: keep the full text.

**What went wrong in B.** Most of B's errors are about where something is. An author or detail is placed in the wrong
part of the book (Basilius in the "preface" when he is in the verse before it; the Emerald Tablet given "in Latin"
inside Ch. XXI; Tuḥfat's coin and spider images placed "at the opening"). Some are adjectives a page summary added
("gentle Fire of the Nuts" for an *inextinguishable* one; a toad "allegory" that Hortulanus tells as an experiment he
saw). This is the known risk in #8512: a block summary that paraphrases or slips to a neighbouring page carries its
error straight into the book summary, and B never sees the text that would correct it. A's errors are more often
wrong counts and framings made from the whole text (Coclico's seven requirements counted wrong; "double-choir";
seasons of the work invented in both arms on Hermetic Rosary). Both arms said "43 problems" in Diophantus Book I, which
has 39.

**Unsupported claims (judge's wording, shortened).**
- Ancient Music — B: Master Dou called a Han-dynasty musician (p.7: Marquis Wen of Wei's musician, received by the Han). A: "music was not originally an entertainment for rulers" (p.12 does not say this).
- Shijing Baishu — A: the Mao text collated against Qi, Lu and Han readings (only Han readings are collated); A: the ox-shaped vessels called "Shang presentation vessels" (p.28 says neither Shang nor Zhou).
- Coclico — A: the seven requirements enumerated wrongly (text expression and syllable quantity are both the 6th; the 7th is imitation); A: "double-choir polyphony" (p.120 is an 8-voice canon). B: a source "for the term *musica reservata*" (the term is not in the book).
- Hermetic Rosary — A: winter grinding and spring luting (only a "Work of Autumn", p.99-100); A: Bernard says the work takes a year (not in the text). B: Basilius and the list of authorities placed in the preface (they are in the H.R.C. verse, p.7); B: Winter and Spring phases; B: the Emerald Tablet in Latin inside Ch. XXI (it is in German and under its own heading, p.90); B: the "marital union of mercury and arsenic in one day" (gold and silver dissolved in one day; the union on p.80 is body and spirit); B: the toad as allegory; B: the "gentle" Fire of the Nuts.
- Diophantus — A and B: Book I has "43 problems" (39); B: Book II opens with dividing a square into two squares (that is II.8); A: Euler's "redundant indeterminate equations".
- God is the Purest Love — B: earlier French *and Dutch* printings (French only); B: a seed analogy (it is a worm that wakes as a "summer bird").
- Way of Initiation — A: the articles "first appeared" in *The Theosophist* (first published in German); B: Steiner's youth "in Upper Austria" (the text: a town on the Hungarian border).
- Tuḥfat — A and B: a priority claim ("earliest surviving Persian masnavi / verse travelogue") the text does not make; A: "a voyage down the Tigris" (not narrated); B: the coin and spider images placed at the opening (pp.111, 142).

## Writes (the 4 gap books only)

The judged-better summary + chapters went through the lane's own write path (`finishEnrichBook` /
`applyChapterExtraction`) with an engine provenance block (`summary.engine`, `field_provenance.chapters` source
`enrich-8512-arm-A|B`). The index came from arm A's extractions, which the lane would have written anyway. Embeddings and
entities were synced by `finishEnrichBook`. Verified after the write: summary engine, chapter provenance, and the state
row set to `done`.

| book | written from | chapters |
|---|---|---:|
| `6a3cb95d3d799518cd71d6cc` Ancient Music j.1 | A (tie → live arm) | 4 |
| `6a3c680caf3c49b59c5d5e71` Mountain Hall j.53-54 | B | 16 |
| `6a3c6dfd01fe4f593c1beb42` Shijing Baishu j.4 | B | 15 |
| `6a4dfcb83deb696ae98430ac` Coclico | A | 32 |

The 6 fill books kept their existing enrichment.

**Out of scope / not tried.** A hybrid that sends page summaries as a map and full text for verification. Using page
summaries only for books whose full text is over the lane's 600K cap; the cost case there is strongest (Diophantus:
702K against 50K input tokens, the same 2 claims each), but n=1 here. The index step. Re-judging to measure the judge's
variance. The 4 gap books are 3 Siku Chinese volumes and one Latin treatise, so "B is better on the gap" is not
evidence about the gap as a whole.
