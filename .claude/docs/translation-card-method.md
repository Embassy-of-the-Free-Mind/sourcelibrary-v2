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

## The defeater policy (Derek, 2026-08-11)

An entry **defeats** a first-translation claim only when it is formally
published with a **durable identifier** — a DOI, an ISBN, or a formal
press/journal imprint. Web-only translations (including AI-assisted ones) are
**listed** on the card with their nature stated — the card records what
exists — but they do not defeat: a claim of firstness needs an opponent that
is itself citable. Decided on the Clavius case (round 4): a 2026 AI-assisted
"reading grade" web translation, no DOI/ISBN — listed, labeled, non-defeating;
and Source Library's own translation predated it by two months anyway.
Corollary: our own claims earn the same standard — a card-backed first is
fully defensible once the edition carries its DOI (the Zenodo scholarly-
edition path).

## Running error rate

| Round | Date | Cards | Entry-card errors | Empty-card errors | Notes |
|---|---|---|---|---|---|
| 1 | 2026-08-11 | 12 | 1 wrong_attribution + 3 filler entries (0 fabricated) | 1 category error (0 missed priors) | `scripts/eval/results/card-round-1.md`; two suggester rules adopted (no citation → no entry; no gloss-matched attribution); card defect ≈17% [5–45%], all fixed same-day |
| 2 | 2026-08-11 | 22 | 3 FABRICATED (real-author/invented-title, all hygiene-proof) + 4 wrong-text + 3 date fixes + 2 dedupe | 8/8 testable held; 1 category error; 1 untestable (unidentifiable text) | `scripts/eval/results/card-round-2.md`; 6 rules adopted incl. not_applicable→under_review (Dioscorides bug), work-node modeling, 2 new card states; **cumulative missed priors 0/14**; layering demonstrated: rules kill noise, verification kills fabrications |
| 3 | 2026-08-11 | 28 | 2 FABRICATED (cum. 5) + **13 wrong-content pins** (unverified tail ~35% entry defect vs ~10% verified head) + Duckwitz misdescription | 0 clean misses (1 GRAIN refutation at cycle level); 5 unidentifiable; 2 more English originals (cum. 5) | `scripts/eval/results/card-round-3.md`; **4/5 QID cards MIS-KEYED** (Pymander card = Asclepius node!) → QID P31 audit rule; "…sogs" containers excluded as a class; per-work scholarly bibliographies (ETCSL) beat open-web search for entry verification |
| 4 | 2026-08-11 | 24 + 4 render | 3 FABRICATED (cum. 8; recent-date/hyper-specific signature) + 3 MISSED real translations found + 6 wrong-text + ~30 dupes collapsed | **FIRST REFUTATION**: Clavius via a 2026 AI-assisted 'reading-grade' web translation (POLICY: do AI translations defeat?); 2 more English originals (cum. 7; Westcott class ≈17 cards); 5 bundles | `scripts/eval/results/card-round-4.md`; pre-finding: reseed clobbered reviewed cards → guard shipped (#3928), post-write verification now standing; live-render bucket caught a category error IN PRODUCTION + raw-URL line (#3930); English-original screen now blocking; event-level dedupe rule |

## State

- Seeded: 919 verified-layer works, 1,730 cited entries, 62 sibling-disagreement
  sets exposed (PRs #3890, #3891). Canary: Q1232238 caught wrong at seed —
  `under_review`.
- Readers of the collection: **LIVE since #3910/#3916** — `/book/[id]` renders
  the card (hero + bibliographic panel) wherever `cardLabel()` is non-null.
  Every `--apply` against a rendering status is reader-visible actuation.
- The book-grain machinery's nightly actuators were **retired 2026-09-01**
  (#4536): the 05:30 derive+reconcile cron and the 09:30 census cron are off
  (`#RETIRED-3881` in `scripts/workers/crontab.production`). The badge boolean
  `books.is_first_translation` is frozen except through reviewed card work.
  Deletion of the machinery itself (verdicts, derive, valve) is #3881 passes
  3–6 — deleted, not migrated.
- Citation harvest: `scripts/audit/harvest-priors-to-card-proposals.mjs`
  (#4536) moves ledger `priors[]` citations toward cards — new cards land as
  silent `under_review`, existing cards get proposals only.
- **Review is delegated to Claude (Derek, 2026-09-01)** — no waiting human
  pass; the adversarial bar (unprimed verifiers, opened-source rule) stays.
  First drain executed same evening: the 191-card verified-method tranche
  fully adjudicated (154 prior_exists / 19 no_prior_known / 2 not_a_single_work
  / 16 identity holds) — record: `scripts/eval/results/card-drain-2026-09-01.md`.
  Open policy call from the holds: whether a scripture witness (lectionary,
  polyglot Psalter) earns the first-translation sentence.
