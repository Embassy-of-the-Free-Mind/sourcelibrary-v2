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

## Next, in order

1. **Loop classifier** — prerequisite for A3, E2 and any honest B1 rate. Body-length
   means are the wrong estimator; loop rate is a Bernoulli quantity needing an
   interval, and cross-run agreement cannot detect a *deterministic* loop.
   Then re-run `scripts/eval/prompt-ab.mjs` and revisit v17.
2. **Corpus-wide fabrication scan.** p.24's signature (OCR bracket placeholder +
   ≥5 enumerated translation lines) found 1 hit in 310 pages of that book. Run it
   across the corpus — that is the unmeasured B1 rate, and the agenda's #1
   priority (A5, quote integrity) depends on it.
3. **Breasted QA → visible.** Check the Harkhuf pages (~201–213) read correctly,
   then flip. That completes the original ask.
4. **#4582** — 6 Latin books labelled Kyrgyz; 141 books took their language from
   `ocr_detected_lang` against a disagreeing cataloguer.
5. **#4624** — `--book` always takes the 25-page preview path, never the full pass.

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
