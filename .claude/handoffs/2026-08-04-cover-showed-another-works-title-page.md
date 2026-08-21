# A cover showed another work's title page — 2026-08-04

Started from one reader-visible oddity on
[Magia Adamica](https://sourcelibrary.org/book/magia-adamica-or-the-antiquitie-of-magic-vaughan):
the header said **1749** while the summary three inches below said **1650**, and the
cover was the title page of **a different book**. Two unrelated defects on one record,
plus a third in the detector written to find more of them.

Issues **#3584** (the cover class + the year evidence) and **#3594** (surface the works
inside a bound volume). PR **#3585** (`scripts/audit/sammelband-cover.mjs`) — open,
`test` + DCO green.

---

## 1. The invented year (fixed)

`year: 1749`, `published: "1749"`, `year_source: 'regex'`. IA's `date`,
`catalog_metadata.date_iso`, the BPH catalogue match, OpenLibrary and our own AI summary
**all** say 1650. The value matched no source.

Written at import time (campaign "Natural Magic & Ritual", 2026-01-03) straight into
`published`; a later pass regexed `year` out of `published` and propagated it faithfully.
The real IA date landed in `catalog_metadata.date_iso` afterwards and nothing compared them.

**`field_provenance` is not evidence of origin.** It read
`source: import, provider: internet_archive` for a value IA never supplied — the stamp is
applied wholesale at import. (Consistent with the "provenance is TWO layers" note.)

Two siblings from the same wave: *Anima Magica Abscondita* (1888) and *Anthroposophia
Theomagica* (1735), both actually 1650. All three corrected → Mongo + `books_catalog` +
ISR + Cloudflare. Backup: `scripts/output/vaughan-year-fix-backup-2026-08-03.json`.

**Corpus scale, and why it is not a sweep.** 1,193 of 6,647 comparable visible books
disagree with `date_iso` (17.9%) — but most legitimately: a 9th-century composition
scanned from an 1864 printing, or IA storing a hijri year (1254 AH = our 1838, where *we*
are right). The suspicious direction is **ours LATER than the catalogue**, since a first
edition cannot postdate its own record: **590 books (8.9%)**, 349 off by >5 years
(202 no `year_source`, 106 `gemini`, 41 `regex`). A visible artifact: a run all stamped
`1803` against catalogue years spanning 1562–1669.

Where IA *and* BPH independently agree and we disagree: only 8 books, 3 being the
Vaughans. The other 5 show why judgment is required — *Fama Fraternitatis* 1614 vs the
1615 Danzig copy we hold; Ficino 1492 vs 1493. **Composition year, first-edition year and
this-copy year are three different facts sharing one field.** Left open in #3584.

## 2. The cover (fixed)

The Getty copy is a *Sammelband*: a fragment of Vaughan's *The Man-Mouse Taken in a Trap*
is bound in front, and this copy of *Magia Adamica* is imperfect — **its own title leaf
(A1) is wanting**, which IA's notes state outright. Cover selection took the first page
classified `page_type: 'title-page'` and got the Man-Mouse one at scan p.7. There was no
*Magia Adamica* title page to find.

Structure: pp.1–6 flyleaves · pp.7–32 Man-Mouse · pp.33–54 *Magia Adamica* front matter
(opening mid-way at signature A3) · p.55+ main text. Signature F is bound twice, so scans
117–132 repeat 101–116 — also original to the binding, also in IA's notes.

**The same root cause corrupted the description.** Enrichment read the opening ~25 leaves
and wrote *"This book, titled 'The Man-Mouse Taken in a Trap'…"* into
`dublin_core.dc_description` and `ai_metadata.description`. Never rendered on the page —
but it is what the book API serves to MCP clients and AI agents.

Cover → scan 55; description rewritten. Backups:
`scripts/output/magia-adamica-{cover,desc}-backup-2026-08-03.json`.

**Everything needed to prevent this was already in our own data.** The chapter index
recorded level-1 *The Man-Mouse* pp.17–34 and level-1 *Magia Adamica: The Antiquitie of
Magic* pp.55–130 — naming both works and giving p.55, the page chosen by hand.
`chapters_extracted_at` **2026-04-12**; `cover_selected_at` **2026-05-31**. Six weeks, same
document, never consulted.

## 3. The detector, and the two bugs in it

`scripts/audit/sammelband-cover.mjs` — read-only. Sibling of `scan-title-mismatch.mjs`
(that one asks whether the **scan** is the right book; this asks whether the **cover** is
the right work inside a correct scan).

A conjunction: the cover names **none** of the title's distinctive tokens or the author's
surname, **and** another title page in the same volume names them with **≥2** signals.

- **Condition 2 is load-bearing.** Condition 1 alone reported 8.6% and was measuring the
  *alphabet* — it flagged every Tibetan/Chinese/Japanese/Arabic/Korean/Tamil book whose
  romanised title shares no characters with its own cover.
- **≥2 signals on the replacement side** killed the pilot's false positive: *Book Four —
  Magick* yields one usable token (`book`/`four` are under the length floor).
- **18,759 books carry ≥2 title pages**, so "multiple title pages" is *not* the signal —
  half-titles, frontispieces and series pages are normal.

### Bug A — no diacritic folding

First corpus run: 181 suspects. Reading them found *Ikhwan al-Safa*, whose printed title
page reads **IKHWÁNU-S SAFÁ** against a record reading **Ikhwan al-Safa**. Byte-wise prefix
matching saw nothing on the correct cover while p.7 carried `purity` + `dowson`, so a good
cover was proposed for replacement. Folding added to `normalise()`, `titleTokens()` **and**
`authorSurname()` — all three, since "Ikhwán" tokenises to the sub-floor "ikhw" otherwise.

181 → 175. The nine dropped skew almost entirely to transliterated titles (Rodwell's Koran,
Sahih al-Bukhari, Mahavamsa, Das Buch Henoch…), which is the confirmation that the fix
removed the class rather than trimming a count. Three added, because folding also
strengthens the replacement side.

### Bug B — the regression control could not fail

**Recorded in `CLAUDE.md` this session** (commit `5a96cfe2`), because the existing "a test
that greps source is not a guard" section did not cover it.

The control for the folding fix hand-wrote a title page including *"Translated from the
Hindustani"*, which matched the title's own `translation` token through the six-character
prefix rule (`transl`). It **passed with the fold deliberately removed** — real code path,
exercised, asserting nothing. The actual page in Mongo holds only `# IKHWÁNU-S SAFÁ.`

Two details kept it invisible: the stopword list screens `translated` but not
`translation`; and the fixture was written *after* the wanted verdict was known, which is
how invented evidence acquires the properties it needs.

> **A fixture you invented is evidence about you, not about the system.** Capture fixture
> text from the real source *before* writing the assertion, never after. Caught only by
> running the negative control rather than reasoning that the fold "obviously" mattered.

## 4. Sweep results

**13,829 checked · 3,451 clear · 175 suspects.** Skips counted by reason: 8,791 fewer than
2 title pages · 643 no distinctive token · 419 cover not a title page · 203 cross-script ·
122 `scan-title-mismatch` territory · 25 too little cover text.

Four causes, only the first being true Sammelbände:

1. **Bound-with volumes** — Llull's *Arbor scientiae* wears p.4, *"RITUS ET CAEREMONIAE
   quibus in ecclesia cathedrali Argentoratensi"*, while its own title page sits at p.9.
   Bacon's *Sylva Sylvarum* wears a dissertation title page.
2. **Series/publisher title pages** — Henry Bradshaw Society over the *Martyrology of
   Oengus*; "English and Foreign Philosophical Library" over Spinoza's *Ethic*.
3. **Library digital-surrogate covers / bookplates** — Cornell over *Confucian Cosmogony*;
   a Persian Radcliffe bookplate over *Kepler Opera Omnia Vol. I*.
4. **Faded or illegible leaves** — Hegel's *Encyklopaedie*, Wolff's *Philosophia moralis*.

**Review queue, NOT an auto-fix list.** Precision on "this cover is wrong" is high;
precision on "use this page instead" is materially lower — Kepler *Vol. I* proposes the
title page of *Volumen Octavum*, itself a `scan-title-mismatch` finding. And the detector
cannot see the case that motivated it: where the correct title leaf is missing there is
nothing to propose, and the answer was a section head.

## 5. Multi-work volumes — measured (#3594)

Of 700 visible books sampled from the 18,759: 143 unjudgeable; of 557 judgeable, **367
name one work (65.9%)**, 138 two, 34 three, 7 four, 11 five-plus. → **2+ works 34.1%, 3+
works 9.3%**, i.e. roughly **1,200 visible books with 2+ works and ~325 with 3+**.

**Upper bounds — three observed over-count modes.** Part-titles within one work
(Godelmann's *Tractatus de Magis* scores 4 on "Liber Secundus"/"Liber Tertius"; true count
2 — likely the largest source, since early modern *libri* are titled); publisher
advertisements (a Dover catalogue in Legge's *I Ching*); editorial apparatus (Bentley's
letter to Mill in Malalas). Sample is first-N-in-aggregation-order, not random.

**Prediction I got wrong, recorded deliberately.** I expected 17th-century English
pamphlets, Tibetan *gsung 'bum* and alchemical *recueils*. The dominant category is
**collected and scholarly editions** — Spinoza's *Opera Posthuma* (6), Bruno's *Opera
Latine Conscripta III* (7), Wallis's *Opera Mathematica III* (4, with Ptolemy and
Bryennius bound in), Heuterus's *Batavia* (6). Not one Tibetan collected-works volume
appeared.

That inverts the design: **where the record names the collection, the constituents are
peers, the volume has its own real title page, and there is no cover conflict at all** —
that is the *common* case. The *Magia Adamica* shape (record names one constituent) is the
minority.

### Do NOT mint book records for constituents

- `work_id` is **≤ books**; the contents layer is **≥ books**. The architecture doc calls
  keeping them apart "the load-bearing distinction of the entire layer."
- Every book-denominated statistic would double-count.
- **Two live proofs it would duplicate real books:** we already hold a complete 136-page
  [Man-Mouse](https://sourcelibrary.org/book/the-man-mouse-taken-in-a-trap-vaughan)
  (`work_id: local:a:thomas-vaughan:man-mouse-taken-trap`), so the bound-in fragment would
  be a worse duplicate; and the *Ethics* exists as two standalone records (1915 Latin, 1883
  White translation).

The right move is `contents_works[].work_id`, which the schema already reserves.

### The real prize is discovery, not covers

**The 1677 first printing of Spinoza's *Ethics* is inside `B.D.S. Opera Posthuma` (p.41)
and nothing on the site says so.** A reader searching "Ethica" gets the 1915 edition.
Cheapest fix by far: index `contents_works[].title` into search.

Note the asymmetry — sometimes the standalone is better (Man-Mouse: complete vs. a 25-page
fragment), sometimes the constituent is (Spinoza: 1677 vs. 1915). **Link the cluster and
show both; do not rank.** A rule built from either example alone is wrong for the other.

`contents_works[]` exists on only **441 books** (439 visible, all with page spans) and
**`git grep contents_works -- src` returns nothing** — a counting layer with no read
surface. It is seeded only from FT-badged containers, which is why *Magia Adamica* has none
despite a perfectly good chapter index. 14,146 visible books have a chapter index; 10,298
have ≥2 level-1 chapters.

---

## Files

- `scripts/audit/sammelband-cover.mjs` — new, read-only (PR #3585)
- `CLAUDE.md` — the invented-fixture invariant (commit `5a96cfe2`)
- Data fixes live in prod, backups in `scripts/output/` (untracked)

## Next

1. Triage the 175 — one at a time, never batch-applied
2. Fix cover selection at source: constrain to the book's own page span. **Two traps:** the
   chapter index puts Man-Mouse at 17–34 while its title page is p.7, so a span rule must
   extend back to the nearest preceding title page; and a missing span must mean
   *unconstrained*, never *empty*, or it refuses to cover ~13K books. Fail open.
3. Reconcile the 590 later-than-catalogue years, excluding hijri records
4. Contents panel + search indexing (#3594)
