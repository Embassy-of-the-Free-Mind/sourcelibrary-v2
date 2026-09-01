# An absence claim is only as strong as the set it was asserted against

**Read this when:** Asserting, badging, or counting "first translation" — or working on `search_efforts` / `reference_translations` / the FT reference set.

> **DEMOLITION 2026-09-01 (#4536):** the book-grain machinery this doc's incidents
> came from (derive → reconcile valve, both FT crons, Phase 1.6's public-boolean
> write) is retired and deleted. `books.is_first_translation` is FROZEN except
> through Translation Card review (`translation-card-method.md`). The evidence
> layer below (attempts ledger, search_efforts, transcripts) is unchanged and
> still binding; references to the derive/valve mechanics are history.

> **FIRST, read `.claude/docs/ft-eval-runs-ledger.md`** — one row per measurement
> ever run on this system, with what it concluded and where the artifact is. A
> 2026-09-01 session re-derived four things the project already knew (a 13-month-old
> duplicate issue, a verified re-OCR fix, a pilot that had already converged, and
> the evidence-store map) because it read the code before reading the record. The
> first question on FT work is *what has already been tried*, not *what does the
> code do*. Why this keeps happening: `.claude/docs/ft-organization-assessment.md`.
>
> **The evidence layer is 13 stores, and the obvious one is usually the wrong one.**
> `books.prior_translation` (676 books) is a narrow reader-facing CREDIT field. The
> actual evidence store is `priors[]` on the attempt ledger — **11,323 books**, 6,608
> with a named translator, 3,227 with a URL. `books.first_translation.priors` is
> empty (0); `translation_verification` carries its own 16 sub-keys including
> `translations` and `search_evidence` on 13,865 books. Measuring one store and
> reporting it as the total produced a wrong number for Derek on 2026-09-01.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

"First English translation" asserts an **unprovable universal negative**. No search establishes one; a catalogue returns only *nothing found*. The fix (#3459) is to stop asserting the negative and publish the **search**: a bounded, dated, reproducible act recorded in `search_efforts` — proposition, reference set with per-source snapshot dates and declared gaps, every query verbatim, every candidate **with its screening reason**, and the git SHA that produced it.

**ONE LEDGER (#3881): `first_translation_attempts` is the canonical evidence ledger.** Every search by every instrument lands there as one row; `search_efforts` is the tier-1 **detail archive** behind it (same relationship `first_translation_transcripts` has to rung-2 rows — ledger row lean, deep artifact behind `transcript_ref`). The sweep dual-writes via `effortToAttempt()` in `scripts/lib/search-effort.mjs`; `not_searchable` efforts deliberately never enter the ledger ("we could not ask" must not read as "we asked"). Read `search_efforts` only through `latestEffortPerBook()`; do not add a second ledger, and a new instrument writes attempts, not a new collection.

**Full doc: `.claude/docs/first-translation-reference-set.md`** — the evidence
layer, its measured reliability, and the invariants below in detail.

That machinery is only honest if you know the set's **recall**, and ours is **32.1%**
(22% → 27% with MARC 240 containment → 32.1% on 2026-08-07 with ESTC added;
`scripts/eval/ft-reference-set-recall.mjs`, measured against the attributed priors in
`translation_classification`) — **two of every three** known prior translations are
still invisible to it. A sampled check of the queue puts `none_found`'s **positive
predictive value at ~50%**: a coin flip.

**Do not read the improvement as the problem receding.** ESTC covers imprints
1473–1800 while 80.8% of this corpus's known Latin/Greek priors are post-1950
imprints, so the remaining loss sits in modern scholarly publishing that no
early-modern catalogue can reach. Adding sources of the same kind will not close
it. So:

- **`none_found` is WEAK evidence.** Never quote a count built on it. Poor *catalogue* recall cannot manufacture a false positive — but an **LLM verifier can**, and ours did. See the next bullet; the old unqualified form of this line ("positive findings are unaffected") was falsified on 2026-09-01 and must not be relied on.
- **A `found` from `gemini_verifier` over-claims — by about 20% (#4525, measured 2026-09-01).** Re-running grounded search over a broad, unselected set of verifier-`found` books, grounded search **contradicts it on 19.8%** (833 of 4,215 adjudicated) and confirms the rest.
  - **A first pass put this at 53% and that number was WRONG.** It came from pairing the two methods on the 5,534 books both had judged — which removes the confound *between* methods and leaves the one *inside* the shared set, because grounded search had only ever run on a ladder queue enriched for contested cases. Selecting on disagreement then measuring disagreement. If you cite an agreement statistic from this system, establish how the shared population was chosen first. Its rows *do* carry queries (95.2%) and sources; they are **recorded, not necessarily executed**, and a written query string looks like retrieval while behaving like recall. It produced ~57K of the ledger's rows, so most of the corpus's prior evidence has this bias baked in.
  - **Why this is easy to miss: a false `found` produces no visible error — it silently SUPPRESSES a first.** The book simply stops being claimed. So the bias depresses the badge count invisibly, and is the leading explanation for the gap between the sampled corpus estimate (~8,565, round 5) and what we badge (~5,000).
  - **Never compare two instruments on their own populations.** A method that ran corpus-wide and a method that ran on a curated queue have different base rates *by construction*, and that difference will read as accuracy. Pair them on shared items or measure nothing. Instrument: `scripts/audit/ft-method-agreement.mjs`.
- **A null means different things in different traditions.** French has 23,035 English translations in the set, Syriac 119, and CJK is reachable only via MARC 880 (present on 2.3% of rows). Read reference-set *depth* beside every verdict; a flat badge cannot be honest across all of them.
- **Keep "we could not ask" separate from "we asked and found nothing."** Conflating them turns an unasked question into a confident negative — the single most common way this system lies.

**That distinction breaks at the PAYLOAD layer too, not just the evidence layer** (#3686,
2026-08-07). Book surfaces are served from two sources for the same object: the Supabase
`books_catalog` mirror (a projection, ~50ms) and the Atlas doc (complete, 1–5s). A pure
classifier cannot tell which it received. `classifyFirstTranslationClaim` run inside
`generateMetadata` — which resolves through `getCachedBookLookup`, i.e. the catalog row —
returned `candidate` for **every** book, because the row carries `is_first_translation`
but not `first_translation.evidence_strength`, and the classifier's "field absent" branch
*was* its "evidence weak" branch. The assertive claim silently vanished from the meta
description of the 627 books that had earned it. **Before classifying, assert the payload
can answer** (`book.first_translation !== undefined`), fetch when it cannot, and fail
toward the weaker claim. Check what `BOOK_SELECT` / `BOOK_DETAIL_SELECT` in
`src/lib/books-catalog.ts` *omit*, not just what they carry.

Two corollaries that cost real work here:

- **A default is indistinguishable from a measurement**, so pick the direction that cannot lie. `firstTranslationBadge` and `firstTranslationDescription` default to `candidate`: every card surface renders from the catalog and none can evidence a first, so an assertive default would let all of them assert a universal negative by omission.
- **A one-sided check on a two-sided change is a coin flip you will read as a pass.** The bug above and a successful fix produced identical output on the candidate direction. It surfaced only on the positive control — the book that should *still* assert. Test both registers.

**And a state's name is a claim about its gate.** `classifyFirstTranslationClaim` gated
`confirmed` on `isFirstTranslation()` — the *render* rule (first-family verdict, visible,
some translated pages), which says nothing about evidence. That made 5,684 of 5,932 badged
books (95.8%) `confirmed` while only 689 carried strong or moderate evidence, so the state
resolved to "we badged it": the very claim it existed to qualify. Same family as a metric's
name being a claim about its denominator. When a state promises "earned by evidence", the
gate must read evidence.

**A prior only defeats a claim if it is COMPLETE and of the SAME text — and the grader
checked neither** (2026-08-08, #3753). `deriveVerdictFromEvidence` graded the defeat
branch on a found sighting and the priors' *years alone*. So an `excerpt` defeated a
claim exactly as a complete edition did, and `prior_relationship` — documented in
`types.ts` as the field that "determines whether the candidate defeats first" — was
**hardcoded to `same_text`**, the value that always defeats, while the ingest dropped the
verifier's actual judgement. Of 429 books graded `not_first`, **31 had no complete prior
anywhere** (7 already demoted) and **44 had priors of unknown completeness** (36 already
demoted). Three books verified hours earlier as *badge stands* were demoted overnight.

Two rules follow, and both are about registers, not facts:

- **Judgement must be a field or it does not exist.** Forty verification rounds concluded
  "this prior does not defeat the claim" — in `notes`, as prose, where no grader can read
  it. Record the *relationship* (`different_source_language`, `related_distinct_work`),
  not just the citation. Absent relationship still defaults to defeating, deliberately:
  most rows predate the field and reversing them silently would be its own mass rewrite.
- **"All fragments" and "we could not tell" are different verdicts.** Every prior known
  partial → `first_complete`, a *badgeable* first-family claim (ours may be the first
  complete edition). Any completeness unknown → `needs_review`. Collapsing them repeats
  the error one level up.

**A verification queue built from "obvious" over-claims is mostly correct badges.** 39 of
59 verified by independent subagents, each chosen *because* it looked like a certain
demote: **25 badges stood, 6 demotes held.** Not one failure was a search failure — every
one was *which text is this exactly*: Boethius **plus Waleys**, Coornhert's **Dutch**
Odyssey, Traversari's **Latin** Diogenes, volume 2 **of** the Hagakure, one juan **of** a
106-juan encyclopedia, *usuras* vs *cambios*, *Shaʿarei Ẓedek* vs *Orah* (and a third
unrelated text of the same title). Screen before verifying —
`scripts/audit/ft-demote-queue-screen.mjs` cut 59 to 2 for free, and both its "no signal"
cases were genuine badge-removals.

**Fabricated priors are the norm here, and the hardest shape is well-formed.** Six
observed: no named translator; an amalgam ("Hadock **(or** Gibbons)" — two real
translators of two different works); a *study* counted as a translation (the NLM's own
catalogue files Savage-Smith as a work *about* the treatise); a wrong date (Read
1946→"1936"); **a real scholar attached to a nonexistent work** ("Deitz and Monfasani
1997", "Del Soldato 2010" — absent from their own bibliographies), which defeats every
structural detector; and a fabrication sitting *beside* a genuine defeater, so finding
one fabrication does not clear a book.

**Every bug in this area fails toward a confident clean negative.** Fourteen defects in one session, not one of which produced a false positive. A null is the cheap answer at every layer: an inverted year comparison, a capped fallback threshold, a throttled endpoint returning HTTP 200 with HTML, a schema mismatch between two extractors. The only thing that caught them was the **recorded reason on each rejected candidate** — a system that logs only what it found cannot be debugged.


**A reference set's SIZE is not its COVERAGE — but measure the coverage that answers YOUR question, not a proxy for it.** Six of the seven misses checked in the 2026-08-01 sample are **absent from the set, not mis-matched** (Hall's 1654 Maier, Ellistone's 1651 Böhme, Caplan's Loeb *Rhetorica ad Herennium* and Lemay's *De secretis mulierum* at zero rows, the *Confessio Augustana*, Gregory of Nazianzus) — so the limit is the corpus, not the matcher. The seventh, Agrippa, is **present**; see the correction below, and note that it weakens "threshold work is finished" from proven to merely likely.

**The first explanation offered for that was wrong, and the way it was wrong is the lesson.** "The extract is 1.04% pre-1800 while our corpus is early-modern" is a true statistic and a false diagnosis: **a prior English translation of a 1531 Latin work is normally a MODERN imprint.** Checked properly, that class is well covered — of 6,947 rows translating from Latin/Greek, **80.8% are post-1950**. The set's overall date skew was never evidence of anything.

A second explanation was then offered and **also measured wrong**: an ordering bug in the item-language filter (`041$a[0].startsWith('eng')`, which rejects a facing-page `$a lat $a eng`). Real bug, fixed in #3556, purely additive — and worth **+5 Latin/Greek rows in 250,000 records**. Negligible for the question.

**The actual cause is that `041$h` was required at all.** Confirmed-absent priors are *in* LoC and thrown away by that one condition, while carrying the exact MARC 240 the matcher is built around — Caplan's Loeb *Ad Herennium* (LCCN 55004252, `240 Rhetorica ad Herennium.`, **no 041 at all**) and Böhme's *Signature of All Things* (`36037588`, no 041). MARC's *other* explicit translation marker is **`240$l`** — the cataloguer stating this item is the English version of the named work — and the ingest never read it. Measured on one part: 3,918 accepted vs **255 with an explicit `240$l` English** (~11,000 corpus-wide), **100% of them carrying a 240** against 64.8% of the current set. See #3599.

**The meta-lesson, after THREE swings: stop theorising about a set's coverage and go read one known-missing record.** Two plausible causal stories were derived from what the extract *contained* (its date skew, then a filter-ordering bug) and both were measured to be non-causes. What settled it in four API calls was fetching the actual MARC for a prior we knew was missing and asking *which condition rejected this row*. **A single known-absent item, looked up in the source, outranks any amount of reasoning about aggregates** — and it is nearly free. Do that first.

Corollary, and the reason two rounds were wasted: **a filter's discards are the only place its blind spot is visible, so make it report them.** `ingest-loc-bulk.mjs` now tallies rejections by reason; before that, the extract could only be read for what it kept, and the raw dump is deleted after extraction so the rejects could not be recovered afterwards either. Same shape as the section this sits in — an absence claim is only as strong as the set it was asserted against, and that applies to claims about the set itself.

Related but genuinely separate: **depth is not reachability** — Chinese looks deep at 3,868 rows and is unanswerable anyway, because CJK is reachable only via MARC 880 (2.3% of rows).

**And a correction is not exempt from the standard it enforces.** The same 2026-08-01 sample was re-verified 2026-08-02 by querying `uniform_title`, `title` AND `author` rather than author alone: six of the seven works are confirmed absent, but **Agrippa's *De incertitudine* is PRESENT** (LCCN 92246639, 1694, matched on its MARC 240) and its books read `inconclusive`, not `none_found` — so it was never a miss, it is an unscreened candidate, and it does not belong in the PPV sample. Two rounds of correction missed it because the re-check inherited the original's search strategy. **Query every field before writing "absent"** — a query against a non-existent field (`record_author`; the field is `author`) returns 0 and reads exactly like a real absence.

**Naming a prior is not linking one, and only one layer can do it.** `reference_translations` carries an **LCCN on 100%** of rows and is the only citable layer. `translation_catalogs` (24,061 asserted priors from UNESCO/LoC/OpenLibrary/HathiTrust/Loeb/publishers) carries **zero** `book_id`, `work_id`, LCCN, OCLC, ISBN or URL — it joins to books by normalised title/author strings at query time, so "which prior?" is unanswerable from it. `translation_classification` (2,755 asserting a prior) carries a model-written prose sentence and **zero** URLs. Only `reference_translations` findings belong in reader-facing evidence until #3455/#3428 land. **Standing check:** 158 books are badged `is_first_translation: true` while `translation_classification` names a prior for them (measured 2026-08-02) — a lead is not authority, but an unreviewed contradiction of our own public claim is a screening queue.

**A yardstick inside the set it measures reads 100%.** `translation_classification` became both a *source* and the recall test set, and the combined figure came out at exactly 100.0%. Quote **catalogue-only** recall. Adding it raised *coverage*, not recall, and structurally could not raise recall — it is a join on our own ids, so it resolves the books we already had an answer for and reaches nothing beyond them. (Same family as a metric's name being a claim about its denominator.)

Three specific traps, each of which cost real work:
- **Threshold tuning does not converge — find the right instrument.** The work-identity matcher was tuned five times; pass four lost verified true positives (Cicero's *De Officiis*, Grimald 1556) while making the corpus look *cleaner*. The answer was not a threshold but MARC **240 uniform-title containment**, because 240 exists to name a work independently of how an edition titles it. The same move fixed the 245 fallback that left 35.2% of rows unconfirmable: the overlap there is usually carried by **the author's own name** ("Poetics" vs "The Rhetoric of Aristotle"), so discount personal-name tokens and require containment plus author agreement — never a higher cap. Pinned by a gold set (`tests/unit/reference-set-work-identity.test.ts`) holding both the verified positives and the false-positive class each tuning pass produced.
- **An immutable log is a history, not a state.** Efforts are immutable so a stale negative re-opens when the set improves — but adding a source mints a new generation and silently orphans prior judgement. Screening lives in `screening_decisions`, keyed on (work, prior), and is re-applied to every generation. Read `search_efforts` through `latestEffortPerBook()`.
- **Provenance cannot tell you what you translated.** Re-hosted scholarly editions (Budge, Langdon) carry `translation.model` and `source:"ai"` exactly like our own work, because our pipeline OCR'd their printed *English* and re-rendered it. The signal that works is the OCR model's own declaration inside `ocr.data` (`<language>English</language>`) — `scripts/lib/english-source-detect.mjs`. The `pages.ocr.language` column is null on exactly the older ingests where it matters. And strip editorial wrappers before measuring any page text, or you measure our own annotations (that bug shipped here and inflated a count 6×).

- **UNKNOWN must never read as MISMATCH.** The source-language screen compared MARC codes against Wikidata **Q-numbers** (`['gre','grc'].includes('Q35497')` is false), so it rejected every Wikidata row whose language it knew — 228 real priors, including Xenophon's *Symposium* and all six *Rubáiyát*. Reject only when **both** sides resolve to a known value and disagree; an unreadable identifier is unknown (`scripts/lib/source-language-match.mjs`). Deliberately no QID table — a hand-written list of unverifiable assertions reproduces the bug on its first wrong entry.
- **`books.language` is not reliable evidence of what is printed on the pages we hold.** Ganguli's *Mahābhārata* and Avalon's *Serpent Power* are catalogued Sanskrit and are already English — no translation applies. Screen with `english-source-detect.mjs`, sampling from **mid-book**: front matter is routinely English even in a Latin edition. *(Corrected 2026-08-12, #3942: this bullet used to read "`books.language` is the language of the WORK, not of the pages we hold", which inverted the actual contract and read as licence for the mislabel. `resolveLanguage()` in `src/lib/resolve-language.ts` (#2185) defines `language` as the MANIFESTATION language — the leaves in this scan — with `original_language` carrying the work when the two differ. The observation behind the old wording is real and unchanged: plenty of records violate that contract, which is exactly why you screen the pages instead of trusting either field. Where the record is right, `languageApparatus()` in `src/lib/edition-language.ts` is what serves the distinction.)*

Full postmortem: private ops repo, `~/sourcelibrary-ops/handoffs/2026-08-01-reference-set-and-first-translation-audit.md`.
