# The Translation Card — method

*The target state of the first-translation system (#3881, superseding the
book-grain machinery). This page is deliberately short: if the method stops
fitting on it, the method has failed its own test.*

## The card

Every work gets one card: the list of known English translations, cited.

> **De architectura** — English: Newton 1771; Morgan 1914.
> **Pymander** — English: Everard 1650.
> **Colliget** — English: *none known to us* (searched LoC, ESTC, the web — Aug 2026).

Store: `work_translation_history` (Mongo, one doc per `work_id`). An entry is a
year, a translator, a title, a citation URL, and any qualifier written in plain
words ("partial, chs. 1–3"). An empty list carries a note saying where we
looked. That's the whole schema that matters.

## The three rules

1. **One list per work.** Editions inherit; containers decompose into their
   constituent works' cards.
2. **One sentence on the site.** List empty + we hold an English rendering →
   *"No earlier English translation is known to us — here's where we looked."*
   That sentence IS the label; it links to the card.
3. **One process.** Anyone — instrument or human — proposes an entry **with a
   citation**. A reviewer merges it. Nothing lands unreviewed on a card that
   changes what readers see.

The search instruments (catalogue sweeps, grounded search, Claude
verification) are entry *suggesters*. The attempts ledger is the evidence
archive behind cards. Neither is part of the concept a reader needs.

## Sharpening: pilot rounds + spot checks

The method improves by measurement, not by adding machinery. Each round:

1. **Sample cards** — stratified: cards with entries vs empty cards, Western vs
   catalogue-blind traditions. Empty cards are the risk (an absence claim);
   entry cards fail differently (fabricated or mis-attributed citations).
2. **Verify independently** — one subagent per card, UNPRIMED (it gets the work,
   not our card), different model family than what wrote the entries:
   - entry cards: does the cited translation actually exist as described
     (open the citation; check translator/year/completeness)?
   - empty cards: try to REFUTE — find any English translation the card missed.
3. **Score** — card error rate per stratum with Wilson CIs; every error
   classified: `fabricated_entry` / `wrong_attribution` / `missed_prior` /
   `wrong_work_identity` / `stale_search_note`.
4. **Fix what the round found** (cards are cheap to correct — that's the point),
   and fix the *suggester* that produced the error class.
5. **Record** the round in `scripts/eval/results/card-round-<N>.md` and append
   to the running error-rate table below.

Invariants per round (inherited from the #2880 pilot discipline):
- The verifier is **unprimed** — never fed our card.
- **No reader-visible change from a round** — corrections to cards are ordinary
  reviewed edits, not bulk writes.
- The **random slice is mandatory** — spot checks include cards nobody suspects,
  or correlated error hides.

## Running error rate

| Round | Date | Cards | Entry-card errors | Empty-card errors | Notes |
|---|---|---|---|---|---|
| 1 | 2026-08-11 | 12 | 1 wrong_attribution + 3 filler entries (0 fabricated) | 1 category error (0 missed priors) | `scripts/eval/results/card-round-1.md`; two suggester rules adopted (no citation → no entry; no gloss-matched attribution); card defect ≈17% [5–45%], all fixed same-day |

## State

- Seeded: 919 verified-layer works, 1,730 cited entries, 62 sibling-disagreement
  sets exposed (PRs #3890, #3891). Canary: Q1232238 caught wrong at seed —
  `under_review`.
- Readers of the collection: **none yet.** The label rule (rule 2) ships as its
  own reviewed PR — that is the moment the registry becomes actuating.
- The book-grain machinery (verdicts, derive, valve) remains in place and
  untouched until the card replaces it; then it is deleted, not migrated
  (#3881 passes 3–6).
