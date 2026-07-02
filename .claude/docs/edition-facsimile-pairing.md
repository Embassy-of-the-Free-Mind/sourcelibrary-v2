# Edition-of-record ↔ facsimile-of-record — the manuscript/edition pairing

**Read this first** before adding a text layer to any manuscript whose script is
hard to OCR (Greek minuscule, cuneiform, hieroglyphic, dense/abbreviated hands),
or before "fixing" the OCR on such a book. The short version:

> **For hard scripts, the published critical edition carries the *text*; the
> manuscript carries the *facsimile* and everything that is only true of *this
> physical object*.** Don't try to make raw OCR of the manuscript into the
> authoritative transcription — pair it with the edition instead.

Worked reference case: **Marcianus graecus Z. 299** (the *Codex Marcianus*, book
`6a45298cc6d95bc278fbc8c3`) paired with **Berthelot & Ruelle,
*Collection des anciens alchimistes grecs*** (1887–88; the Greek text volume is
`6994383a6879ff0184cb803a`). Cross-linked via the shared work
`corpus-of-the-greek-alchemists` (see [[work-identity-coverage]]).

## The precedent this generalizes

We already do this, implicitly, for the shelves where the ancient script is
effectively un-OCR-able: the **Akkadian (~390)** and **Egyptian (~154)**
holdings are carried by *printed scholarly editions* — King's *Seven Tablets of
Creation* (Enuma Elish), Budge's *Book of the Dead* — whose transliteration +
translation OCR cleanly, with the wedges/glyphs shown as plates/facsimile. We do
not OCR cuneiform or hieroglyphs directly. This doc makes that pattern explicit
and extends it to difficult **Greek minuscule**, where the same failure mode
appears.

## Why: the OCR on a 10th-c. minuscule hand cannot be trusted verbatim

Measured on Marcianus 299 (full-quality `gemini-3-flash-preview`, ~1400px scans —
Internet Culturale's public ceiling):

- **Run-to-run self-agreement ≈ 0.62** (word-level Dice, accent-normalized, 393
  text pages). The same model on the same images disagrees with itself on ~38%
  of word-tokens. A faithful reader is deterministic; a model that *interpolates*
  diverges. (We hold two independent passes — see "confidence layer" below.)
- **Image-adjudicated hallucination.** On Carta 93r the manuscript plainly reads
  `τῶν μετάλλων· καὶ τὰ ὑγρόδρυα τῶν βοτανῶν` (= Berthelot); our OCR *dropped the
  legible words* and substituted invented text, and garbled the famous line
  `ὁ Ἴων ὁ ἱερεὺς τῶν ἀδύτων` ("Ion, priest of the sanctuaries") into
  non-Greek. The output *reads fluently* — that is the danger.
- **Strongly content-dependent.** Display text / inscriptions / diagram labels
  are near-perfect (the Chrysopoeia ring `ἓν τὸ πᾶν…` matched verbatim); recipe /
  apparatus prose is largely reliable; dense allegorical/narrative folios
  (Zosimos's *Visions*) are where it fabricates.

**Consequence for scholars:** the facsimile is sound; reading/translation-for-
sense is fine with care; **quoting the Greek verbatim from the OCR is not safe**
without collation. The translation inherits OCR errors (garbled Greek →
confidently wrong English — the [[lesson_meta_annotation_quote_leak]] failure
mode, one layer down). Berthelot (whose base manuscript *is* M) remains the
scholarly authority for the text.

## The layer stack (per folio)

| Layer | Source of record | Notes |
|---|---|---|
| **Facsimile image** | Marcianus manuscript | primary evidence; the reason to hold the object |
| **Transcription (Greek)** | **Berthelot**, via concordance | our OCR body demoted to a *flagged* rough aid |
| **Translation (EN / FR)** | **Berthelot** | AI-from-clean-Greek (EN) + Berthelot's human French (PD) |
| **Diagrams / gallery** | Marcianus **image extraction** | Chrysopoeia, kerotakis, alembics — cropped from the real folios |
| **Annotations** (`<image-desc>`, `<page-type>`, `<margin>`, `<note>`, `<vocab>`, `<scan-quality>`) | Marcianus **OCR annotation layer** | manuscript-native; the *reliable* part of our OCR |
| **Confidence / provenance** | two-pass OCR agreement + Berthelot coverage | research/QA signal, not shown as authority |

The governing split: **edition carries the words; manuscript carries everything
that is only true of *this object*.**

## The OCR splits in two — keep vs demote

"Demoting the OCR" is **not** deleting it. Our OCR output is two different things
welded together:

- **KEEP — the annotation/metadata layer.** `<image-desc>` (drove image
  extraction; the Chrysopoeia description checked out against the image),
  `<page-type>` (classification that selects illustration candidates),
  `<margin>` / `<note>` / `<gloss>` (physical marginalia of *this* folio),
  `<vocab>` (search terms), `<scan-quality>`. These describe the object, are
  vision/classification work the model does *well*, and have no equivalent in a
  printed edition. Keep them live.
- **DEMOTE — the verbatim Greek transcription body.** Unreliable on hard folios.
  Replace as text-of-record with Berthelot (via concordance); keep the OCR body
  as a clearly-flagged aid plus the confidence layer, never presented as the
  authoritative transcription.

## The concordance (the join table)

Berthelot prints **M-folio marks** throughout ("f. 93 r.", inline `(f. 171 r.)`,
headnote *"Transcrit sur M, f. 92 v."*), and the digitization's page labels carry
the **same foliation** ("Carta: 93r"). They lock together directly on M's
foliation — verified against independent anchors (Zosimos *On Virtue* headnote
f.92v→Marc p207/Bert p13; the *ἀφροσέληνον* inline mark f.171r→Marc p364/Bert
p30). Artifact: **`scripts/output/marcianus-berthelot-concordance.json`** —
195 folios locked page-for-page; the running sequence is monotonic (consecutive
folios → consecutive pages on both sides), the signature of a correct alignment.

**Gotcha — M-only extraction.** A naive `f. NN r/v` regex over-counts badly: it
sweeps in Berthelot's *apparatus references to other manuscripts* ("collated
with A, f. 85r; with K, f. 1r"). Restrict to **M signals only** — the base-
manuscript inline parentheticals `(f. NNr)` plus explicit `M, f. NN` headnotes —
and exclude other-siglum refs. (First pass wrongly claimed 74%; M-only gave a
trustworthy 195 and the anchors then landed.)

**Open refinements:** ~79 referenced folios don't yet resolve to a Carta label
(edge folios, the `M²` duplicate f.115r, a few mislabeled tags); multi-page rows
(`f.112v → 44,52`) need "primary transcription page" disambiguation (the running-
sequence page, not the lowest number — the lowest is often an apparatus/intro/
translation page); extend the join to the French-translation volume.

## Translation — from the Greek, not a relay

We already hold both options:
- Berthelot's **Greek** volume is fully AI-translated to English (518/518 pp) —
  from clean printed Greek, not from the manuscript OCR.
- Berthelot's own **human French** translation (Vol 3 + the *livraisons*), PD.

For a *definitive* English layer, re-translate from Berthelot's **Greek** at full
model (source-language, no relay through French — the *ad fontes* rule,
[[feedback_go_to_original_sources]]), with the French as a human cross-check.
Never translate from the demoted manuscript OCR body.

## Versioning — prior OCR is preserved automatically

Content changes to `ocr`/`translation` are versioned in the **`page_revisions`**
collection: both the realtime route (`createRevision`, `src/lib/page-revisions.ts`)
and the batch collector (`saveRevisionBeforeOverwrite`,
`scripts/workers/batch-collector.mjs`) snapshot current content *before*
overwriting. Marcianus 299 already carries 432 prior-OCR snapshots (a redundant
double-submission — see [[lesson_ocr_double_submit_check_too_early]] — left one
pass live and one in revisions; harmless, and a free second opinion).

**Invariant:** any custom writer (an import/overlay script) that touches
`pages.ocr.data`/`translation.data` **must** call `createRevision` first, or it
silently bypasses versioning. **Preferred design avoids the issue entirely:**
surface Berthelot as an *additive* aligned layer keyed by the concordance —
**do not overwrite `pages.ocr.data`.** Then nothing is destroyed and every folio
offers a three-way comparison: facsimile ↔ AI-OCR ↔ critical edition.

## Confidence layer — honest about what it measures

Two signals, saved in **`scripts/output/marcianus-ocr-confidence.json`**:

- **OCR self-agreement** (pass-1 vs pass-2 Dice): clean, fully computable, ranks
  the least-stable folios (re-OCR/collation candidates). Blind spot: two passes
  can share a *correlated* misreading.
- **OCR vs Berthelot coverage** (fraction of our Greek tokens found in Berthelot's
  folio): a **noisy lower bound, NOT an accuracy rate.** Berthelot is a *critical*
  edition (normalized spelling, emendations, other-ms readings), so even a perfect
  diplomatic transcription scores well under 1.0; best folios cap ~0.60. Use the
  *ranking*, not the absolute number. Self-agreement predicts coverage only weakly
  (Pearson r ≈ 0.27) — soft triage, not a substitute for collation.

To turn coverage into a *publishable* accuracy figure, make a small **hand
diplomatic gold set** (~3–5 folios transcribed directly from the image) to
calibrate the ceiling.

## Implementation plan

1. **Non-destructive overlay (do first).** Store the concordance as a join table;
   on the Marcianus reader, surface Berthelot's aligned Greek + translation as the
   reading text, with the OCR body flagged as a rough aid. Keep image extraction +
   annotations from the manuscript side. No overwrite of `pages.ocr.data`.
2. **Provenance/quality note on the record** — "AI-assisted transcription; verify
   quotations against the facsimile / critical edition." Gate any "quote the Greek"
   affordance behind it.
3. **Confidence surfacing** — per-folio badge from the two signals (green on
   clean display/recipe folios, flag on dense narrative folios).
4. **Definitive translation** — re-run EN from Berthelot's Greek at full model.
5. **Coverage/calibration** — lift the concordance past 195; build the gold set.

## The generalized rule

> **Where a public-domain critical edition of a work exists — especially one whose
> base manuscript we're digitizing — prefer the edition's text over OCR for hard
> hands/scripts.** OCR the *edition* (clean print), not the manuscript's ancient
> script; keep the manuscript for facsimile, image extraction, and object-native
> annotation. This already governs the Akkadian/Egyptian shelves; apply it to any
> comparable case.

## Pointers

- Concordance: `scripts/output/marcianus-berthelot-concordance.json`
- Confidence data: `scripts/output/marcianus-ocr-confidence.json`
- Work cluster / cross-reference: `/work/corpus-of-the-greek-alchemists`;
  work-field backup `scripts/output/marc299-berthelot-workid-backup-2026-07-01.json`
- Related: [[work-identity-coverage]] · [[lesson_meta_annotation_quote_leak]] ·
  [[feedback_go_to_original_sources]] · [[lesson_tibetan_lite_ocr_fails]]
  (same OCR-trust failure mode on another script) · quote-integrity rules in `CLAUDE.md`
