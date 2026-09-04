# Harkhuf, Yam, and a fabrication class — 2026-09-02/03

Started as "what do we have on Yam and Harkhuf?", became a session about the
translation phase inventing text where OCR honestly declined. Written for a cold
reader picking this up.

## Where it stands

**Live harm: withdrawn.** Urkunden IV p.24 was serving 20 invented lines of
Egyptian funerary formulae, and one of them was a *featured quote* on a visible
book. Removed 2026-09-03, prior text preserved to `page_revisions`
(`source: withdraw-fabricated-translation-4584`), Cloudflare purged, verified 0
hits on the live URLs. Script: `scripts/maintenance/withdraw-fabricated-translation-4584.mjs`
(PR #4629).

**The original request: half done.**
- Breasted, *Ancient Records of Egypt* I (`6a989f98ba191f96aa9bab9c`) — the book
  that actually carries Harkhuf §§325–336 and Pepi II's dwarf letter, in English.
  **398/398 pages archived to R2, 62 OCR'd, hidden.** Verified ELIGIBLE for the
  full OCR pass; blocked only by the $5/day dial being spent. It finishes on its
  own when the dial resets — no action needed. Then QA and flip visible.
- Sethe, *Urkunden des Alten Reichs* (`6a989fa2ba191f96aa9bad2d`) — the
  hieroglyphic text edition. **Deliberately NOT processed.** Its glyph plates are
  exactly the material that fabricates. Keep as a facsimile.

## Merged today

| PR | what |
|---|---|
| #4587 | standing "unverified transcription" notice on hieroglyphic pages |
| #4610 | paired k-run prompt A/B instrument + retraction of my own numbers |
| #4618 | prior-art guard (PreToolUse/Write), `scripts/eval/INDEX.md`, `EXPERIMENTS.md` |
| #4605 | `<lacuna>` tag — stripped from every quotable/countable/exportable surface |

Open: #4629 (withdrawal script), #4623 (research-agenda amendment).

## Do NOT redo

- **Do not promote OCR prompt v17 / translation v14.** They exist as
  non-default rows and `--promote` refuses without `--ab-rerun-clean`. At k=5
  v17 **over-declines** — it turned a legible Latin note into a `<lacuna>`.
  Live defaults remain ocr v16 / translation v13.
- **Do not trust a single-run prompt comparison.** Two identical k=5 runs gave
  opposite headline results; the ~16.2k-char figure is the output-token cap, a
  repetition loop that lands on either arm. See `scripts/eval/EXPERIMENTS.md`.
- **Do not build a new eval harness.** `scripts/eval/` has 105 scripts, 7 lib
  modules, and two preregistration documents. Read `INDEX.md` first — the `lib/`
  table is where duplication starts. I rebuilt four existing things before
  finding them.

## Corpus-wide fabrication scan — done, and hand-reviewed (2026-09-03)

Step 2 below is complete. `scripts/audit/detect-fabricated-translation.mjs` (v3,
9 controls: 3 positive from confirmed withdrawals, 6 negative encoding every
false-positive family found across v0-v2) found **122 candidates** across
5,576 non-Latin-script books with translations. Precision on a 3-page sample
was estimated at ~1/3 — nowhere near trustworthy — so every one of the 122 was
read **by hand** (OCR + full translation, not just the flagged snippet;
several needed the raw un-collapsed `translation.data` to see the exact
invented span). Full reasoning per page lives in the session transcript; the
short version:

- **6 confirmed genuine fabrications, withdrawn** (same script, second
  `LITERAL_TARGETS` batch, applied + CDN-purged 2026-09-03):
  Book of the Dead II pp.19, 54; Book of the Dead III pp.220, 288; Sefer
  ha-Zohar p.415; Babylonian Liturgies p.333. p.220 was the worst of the six —
  15 fully invented numbered "verses" (28-42) for a page where OCR declined
  every single line. The Zohar page is notable because the translation's own
  `<meta>` tag **admitted** it: "this translation reconstructs the likely
  thematic content based on the provided vocabulary" — a self-confessed
  invention, not a subtle one.
- **~91 confirmed false positives.** Two dominant genuine shapes the detector
  can't tell apart from fabrication without reading both fields in full: (a) a
  trivial decline (one illegible word/seal) sitting inside an otherwise fully
  and correctly transcribed page — Bencao Gangmu, Homeric Batrachomyomachia,
  Korean chronicles, Sanskrit philosophy all fell in this bucket; (b) a
  correctly-hedged full decline with no invented specifics — the Herculaneum
  papyri cluster (7 pages) and most of the Zohar cluster (5 of 7 pages) are
  exemplary here, consistently describing *physical* damage rather than
  claiming content.
- **2 left unwithdrawn as low-confidence**: Maḥzor pp.192, 251 — one recites
  the Shema (near-universal fixed liturgy, plausibly genuine even under a
  10-line decline), the other is a garbled but plausibly-real attempt at a
  difficult acrostic piyyut, not clean invention.
- **A ~25-book Tibetan tantric cluster was deliberately left out of this
  batch.** It's consistent with — and corroborates — the already-tracked,
  differently-scoped #4523 finding (Gemini cannot reliably read cursive
  dbu-med; 31-35% cross-run agreement vs 87-93% for print). Several pages
  quote famous, identifiable canonical works (Atiśa's *Lamp for the Path*,
  Ramanuja/Vedanta Deśika Śrīvaiṣṇava theology) fluently enough that pattern-
  matching to well-known training-data content vs. genuinely reading a hurried
  cursive folio can't be told apart without Tibetological expertise I don't
  have. #4523 already recommends withdraw-not-re-OCR for this script class at
  the corpus level — fold this cluster into that remediation rather than
  treating it as 25 more one-off `#4584` withdrawals.

**Detector precision, now measured properly: 6/122 ≈ 5%** (the 2 low-confidence
Maḥzor pages and the Tibetan cluster counted as not-confirmed). That's a work
list, not close to an authority — consistent with the ~8% estimated earlier
from the 3-page sample. Any future run of this detector needs the same
hand-review step; do not withdraw off its output directly.

## Next, in order

1. **Loop classifier** — prerequisite for A3, E2 and any honest B1 rate. Body-length
   means are the wrong estimator; loop rate is a Bernoulli quantity needing an
   interval, and cross-run agreement cannot detect a *deterministic* loop.
   Then re-run `scripts/eval/prompt-ab.mjs` and revisit v17.
2. ~~Corpus-wide fabrication scan~~ — done, see above.
3. **Breasted QA → visible.** Check the Harkhuf pages (~201–213) read correctly,
   then flip. That completes the original ask.
4. **#4582** — 6 Latin books labelled Kyrgyz; 141 books took their language from
   `ocr_detected_lang` against a disagreeing cataloguer.
5. **#4624** — `--book` always takes the 25-page preview path, never the full pass.
6. **Tibetan cluster → #4523.** Fold the 25-book list above into that issue's
   corpus-level remediation instead of one-off withdrawals.

## Worth knowing

- **The cuneiform precedent is the model for Egyptian.** 373 books came from
  ETCSL as scholarly transliteration + Oxford's own English, with
  `scripts/etcsl/fetch-cdli-witnesses.mjs` linking CDLI tablet photographs. No
  model reads a glyph, so this fabrication class is structurally impossible.
  The Egyptian analogue is **TLA** (Berlin-Brandenburg + Saxon Academy) — but its
  licence forbids bulk sub-corpus reuse, so that is a conversation with the
  project, not a script. My memory file previously recorded TLA as flat
  CC BY-SA 4.0; that was wrong and is corrected.
- **PR #4612** (another session) adds an "honest not-reliably-legible state" in
  `reader-v2/` — conceptually the same thing #4587 shipped in `reader/`. Worth
  reconciling before there are two dialects.
