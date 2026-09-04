# First-translation claims: the repair, the hedge, and the pipeline check — 2026-09-04/05

**Read this if you are picking up #4617 (card drain), #4634, #4639, #4654, or PR
`worktree-fix+possible-first-translation`.**

The session started as "drain tranche 4 of the card queue" and became something
more useful: the queue exists because nothing ever asked the question at pipeline
time, and the claim it was defending was the wrong shape.

---

## The one thing to understand first

**"The first English translation of this work" is a claim about the world; the
world can always produce a counterexample.** Every failure below is a consequence
of asserting it from AI-assembled evidence across 11,530 works.

Derek's reframe (already in `scripts/lib/search-effort.mjs` since #3459, and in
his own memory note): make a POSITIVE, bounded claim about *our search* instead.
The card now says **"Possibly the first English translation — no earlier one is
known to us"** with the search record beneath it. A later-found prior becomes a
card edit, not a falsehood.

This is why new FT machinery is usually the wrong instinct. Three times in one
day the honest answer was *"the machinery exists, it is not wired"*, and each
time the first move was to build something new. See
`lesson_ft_sprawls_because_absence_never_terminates`.

---

## LANDED (in production)

- **74 cards holding false claims.** Live pages asserting a first translation
  over contradicting evidence on the same page. All set to `under_review`
  (renders nothing). `no_prior_known` 939 → 865. Verified on 10 live pages after
  revalidate + purge. Script: `.claude/drain-4617/fix-ft-contradictions.mjs`.
  Five classes: card cites its own verified prior (22) · English original the
  guard's wording missed (3) · English book in the same work cluster (3) · book
  renders an "Earlier English translation" in Book history (30) · every book on
  the work is English (24).
- **PR #4636 merged** (`2f814f8b`): the Book-history timeline lists EVERY earlier
  translation, oldest first, instead of `picks[0]`. It was hiding 2,212
  translations across 1,339 books, and in 35% of multi-prior books the one shown
  was a LATER one — Pico's *Opera Omnia* credited Copenhaver (2022) while hiding
  Sir Thomas More (1510). Pico now renders 9 priors, More first.
- **29 Conscience cards** written by the new phase, each with a real search
  record. One (Aquinas) held after it was caught contradicting itself.

## ON A BRANCH, NOT MERGED — `worktree-fix+possible-first-translation`

Pushed, **no PR opened yet.**

1. The hedge (`63b43a9a`). `cardLabel()` sentence + the gold pill
   ("Possible first translation") + `TranslationCardPanel` no longer keeps its
   own copy of the sentence. Test pins it and forbids an unqualified superlative.
2. Phase 7.7 — `scripts/workers/prior-translation-check.mjs` +
   `scripts/lib/prior-translation-search.mjs`.
3. The three guards the first `--apply` proved were missing (below).

**Next:** open the PR; wire the `RUN_PHASE_7_7` block already added to
`enrich-worker.mjs` (it calls `runPriorTranslationCheck`); `npx tsc --noEmit`.

---

## Phase 7.7 — what it is

Nothing asked "has this been Englished before?" when a book finished
translating. **13 of the 15 most recently translated Forum-of-Conscience books
had no card at all.** That is why a retroactive 11,530-work drain exists.

Two tiers, no model ever asked to assert an absence:

- **Tier 0** — `scripts/eval/ft-catalog-match.mjs`, IMPORTED not reimplemented.
  24,130-row `translation_catalogs`, five guards (ANTHOLOGY/study, COMPLETENESS,
  SOURCE_LANG, VOLUME, NAMESAKE). Free. But 98.9% Latin classics, so its silence
  on 16th-c casuistry is a miss, not an answer.
- **Tier 1** — actually go and look. OpenLibrary, archive.org, K10plus all filter
  on language and can support "no English edition here". **Crossref cannot** (no
  language filter; it answered the *Summa Angelica* with OED headwords and the
  Latin 1542 edition) so it is advisory only, recorded but never deciding.

Outcomes: `SET_prior_exists` · `HOLD_guard_fired` · `HOLD_candidate_found` ·
`HOLD_source_down` · `SET_no_prior_known`.

**Measured** over 4,000 translated books: 3,717 no match · 262 needs_review ·
21 clean matches (Chapman's *Iliad*, Telang's *Gita*, Rowland & Howe's
*Vitruvius*, Blackwell's Huygens, Green's *Boethius*). Dominant near-miss guard
is COMPLETENESS (239 of 338) — real matches discarded because the CATALOGUE does
not record completeness. **The binding constraint is catalogue metadata, not the
matcher.**

## The three bugs the first --apply produced (all found by spot-checking, none by exit code)

1. **Crashed at card 31 of 40** — several books share one `work_id`; first write
   settles the card, second collides on `_id`. Now one decision per WORK.
   *I then checked the wrong stamp and nearly reported the run clean.*
2. **It re-created the morning's bug** — wrote `no_prior_known` onto the Aquinas
   card while it cited the Dominican Fathers (1911, `relationship: same_text`).
   `merge-tranche-review.mjs` already refused this; now ported as
   `SKIP_has_prior`.
3. **The claim rendered without its evidence** — `searchRecordLine()` reads
   STRUCTURED fields (`attempt_count`, `sources`, `last_searched`) and returns
   null otherwise. The phase wrote only prose, so the live page showed a
   first-translation sentence with NO search record beneath it. Fixed; 29 cards
   backfilled.

**Lesson: run it, then read the written rows AND the rendered page.** All three
passed every automated signal.

---

## Open issues filed

- **#4634** — 1,351 books (1,306 live) whose `translation_verification` says
  `translation_found` while its own `reasoning` says nothing was found; 194 from
  a `gemini_grounding_audit_alternative` (the likely-fabricated class, e.g. the
  "Marina Rivas García / Hexen Press" credit on Nynauld). BOOK side, still renders.
- **#4635** — Book History shows readers 2.57M internal `pipeline_status_changed`
  rows as provenance (581 of 583 events on one book; 98% corpus-wide).
- **#4639** — translation vs study. Godwin's Kircher MONOGRAPH is credited as an
  "excerpts translation" of 14+ Kircher works. **See the correction in the
  comments:** `src/lib/ft-prior-guard.ts` already HAS an ANTHOLOGY/study guard
  (its comment names "The Kircher Reader"); the defect is that the lane writing
  `translation_verification` never passes through it. My schema addition is
  withdrawn. 290 works carry a ≥4-works spread credit — a review queue, NOT a
  sweep (the same shape covers legitimate anthologies: Ante-Nicene Fathers,
  *The Literature of Ancient Sumer*).
- **#4654** — `books.language` is not trustworthy enough to gate behaviour.

## #4654 — the answer, and the pattern to generalise

Two Conscience books are filed **Spanish** and **Russian** for Latin texts. One
is ours (importer preferred `ia_ocr_detected` over the `ia_metadata` claim that
said Latin), one is upstream (single wrong IA claim).

**79,982 books have a language with no provenance at all**; 3,649 have
disagreeing claims. Two repair rules were tried and BOTH corrupt data:
prefer-the-catalogue breaks Theophrastus; majority-vote turns the *Demotic
Magical Papyrus* and the Mixtec *Codex Nuttall* into English and flattens
*De Vita Pythagorica (Graece et Latine)* to Greek. **Any rule that rewards
agreement destroys the specific value**, because the wrong claim is the common
one. Only 45 are unambiguous (stored value is not a language: "An", "Ne", "Books").

**Derek's answer, validated: read the text.** Every OCR'd page carries
`<language>X</language>` in `ocr.data`.

| book | catalogue | OCR declares |
|---|---|---|
| Summa Pisanella | Spanish | **Latin 12/12** |
| Vitoria *Relectio* | Russian | **Latin 9/12** |

**63,042 books have OCR.** `scripts/maintenance/backfill-language-from-ocr.mjs`
already does this read — but only where the catalogue says "Unknown". It fills
blanks and never contradicts. Widening it from "fill the empty" to "flag the
contradicted" is the fix. Flag, don't overwrite: bilingual editions and
translation editions disagree legitimately (`language` is the EDITION's language).

**The generalisable rule:** for any field imported from upstream metadata, ask
whether we hold an independent content signal (OCR text, title-page read) that
can adjudicate it. Where we do, the content wins and the metadata is a claim, not
a fact. See the companion audit of other affected fields in the same issue.

---

## Drain state (#4617)

- Registry: `no_prior_known` 865 · `prior_exists` 665 · `not_a_single_work` 69 ·
  `under_review` ~11,750.
- **T4: 130 of 400 works verified**, merged only as a dry run. Remaining 240
  rebuilt into batches 41–80 in `.claude/drain-4617/t4-batches/`, with three cost
  fixes: English-original pre-filter (1,103 works skippable corpus-wide, ~12.9M
  tokens), dossier dedupe (**51.7% of entries were duplicates**), 6-work batches.
- Verifier agents cost **~11,660 tokens/work**. Full queue ≈ **134M tokens** —
  price that decision deliberately. The estimator has converged (32% at n=130 vs
  34.5% ±5.0pp at n=348), so the remaining drain buys *rendered cards*, not
  knowledge.
- Untracked working dir: `.claude/drain-4617/`. `node drain-status.mjs` prints
  registry + ramp + verdict mix in one command.
- `merge-tranche-review.mjs` now reconciles verifier-rewritten work ids (two were
  silently dropped as `SKIP_no_card`) and HARD-FAILS rather than guessing.

## Standing traps confirmed this session

- **`?cb=` does NOT bypass ISR on `/book/*`** (`revalidate = 86400`). It read as
  "the write never landed" when the write was fine. Use
  `POST /api/admin/revalidate` then a Cloudflare purge. `deploy-and-caching.md`
  says otherwise and should be corrected.
- Verifier agents **rewrite the work_id they are given** (one changed
  `manuzio-aldo` → `manuzio-paolo` to match its own judgement).
- Source Library's own AI translations are indexed and surface in search as
  "priors". Two agents caught it unaided; the prompt now warns explicitly.
