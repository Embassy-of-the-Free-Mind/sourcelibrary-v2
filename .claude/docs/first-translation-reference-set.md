# The reference set, search efforts, and what a `none_found` is worth

*Living doc. Current as of **2026-08-01** (PRs #3462, #3463). This is the source of
truth for the evidence layer under first-translation claims — the reference set,
the `search_efforts` log, and the measured reliability of both.*

**Read `translation-works-architecture.md` first** for how this sits in the wider
works/identity stack. `first-translation-system.md` describes the verdict model
and the badge; **this doc describes the evidence those rest on**, and much of that
doc predates this layer.

Issues: **#3459** (the principle) · **#3455** (`bib_records`) · **#3428**
(resolver) · **#3522** (ESTC — the open blocker) · **#2567** (coordination).

---

## 1. The principle: publish the search, don't assert the negative

"First English translation" asserts an **unprovable universal negative**. No
catalogue can establish one; it returns only *nothing found*. Every attempt to
shore the claim up with better evidence has failed the same way, because the
claim's *shape* is wrong, not its evidence quality.

So we stopped asserting the negative and started recording the **search**: a
bounded, dated, reproducible act.

> "No prior English translation found. Searched 3 catalogues (133,276 records,
> snapshots 2016–2026); 31 candidates screened; 2026-08-01. [see the record]"

That is a claim about a specific act, verifiable by a third party forever, and
strictly more informative than the bare assertion because it shows its own edges.

Five things make an effort reproducible, and dropping any one breaks it: the
**proposition** stated exactly; the **reference set** with per-source snapshot
dates, record counts and declared gaps; every **query verbatim** with its result
count; every **candidate** with its screening decision *and the reason*; and the
**git SHA** that produced it. (A one-line change to a ratio's direction once moved
strong matches from 8 to 74 over identical data — an effort that does not pin its
code is an anecdote.)

**The rejects matter more than the accepts.** They are what shows the search was
real rather than a lookup that happened to miss. Fourteen defects were found in
this area in one session and *the recorded reason on each rejected candidate was
the only thing that caught any of them*. A system that logs only what it found
cannot be debugged.

---

## 2. THE GOVERNING NUMBER: catalogue recall is 27%

`scripts/eval/ft-reference-set-recall.mjs`. Measured over the 607 books an
independent classifier marks `previously_translated` that the search also examined:

| variant | surfaced | none_found | recall |
|---|---|---|---|
| catalogue-only, all bases | 162 | 439 | **27.0%** |
| catalogue-only, no 245 confirmation | 133 | 468 | 22.1% *(the pre-2026-08-01 ceiling)* |
| LoC alone | 155 | 446 | 25.8% |
| Wikidata alone | 46 | 555 | 7.7% |
| combined, incl. `translation_classification` | 607 | 0 | 100.0% **CIRCULAR — not recall** |

**Three of every four known prior English translations are invisible to the
catalogues.** Therefore:

- **`none_found` is WEAK evidence. Never quote a count built on it, in any cohort.**
- **Positive findings are unaffected.** Poor recall cannot manufacture a false
  positive, which is why the demote packet stands on its own.
- A null means different things in different traditions — see §6.

### 2a. And its positive predictive value is ~50%

Recall is not the number a reader of the queue feels. A systematic sample of 14
works from the visible translation queue (2026-08-01) found **roughly half have a
prior English translation the search missed** — Agrippa's *De incertitudine*
(Sanford 1569), Maier's *Lusus Serius* (Hall 1654), Böhme's *De Signatura Rerum*
(Ellistone 1651), the *Confessio Augustana*, *De secretis mulierum* (Lemay 1992),
*Rhetorica ad Herennium* (Caplan, Loeb), Gregory of Nazianzus.

So `none_found` is a **lead with a coin-flip hit rate**, not a finding. Caveats on
that figure, now three: n=14; it is biased, because only *famous* works can be
verified quickly and famous works are likelier to have priors; and per §2b the
Agrippa case does not belong in the sample at all — its efforts read `inconclusive`,
not `none_found`, so it is not evidence about what a null is worth. The other six
named works stand.

### 2b. The cause is mostly the CORPUS — but the first version of this table was wrong

*Re-verified 2026-08-02 against the live `reference_translations` collection,
querying `uniform_title`, `title` and `author`. Six of the seven works named in §2a
are confirmed absent. One is not, and the original row for it was wrong.*

| work | verified prior | in the extract? |
|---|---|---|
| Agrippa, *De incertitudine* | Sanford 1569 | ✅ **PRESENT.** LCCN 92246639 — *The vanity of arts and sciences*, 1694, `240 = De incertitudine et vanitate scientiarum.`, `eng` ← `lat`. |
| Maier, *Lusus Serius* | Hall 1654 | Absent (0 rows). |
| Böhme, *De Signatura Rerum* | Ellistone 1651 | Absent (0 rows). The only `Signatura rerum` row is **Agamben's** 2008 book, ← `ita`. |
| *Rhetorica ad Herennium* | Caplan, Loeb | Absent (0 rows). |
| ps-Albertus, *De secretis mulierum* | Lemay 1992 | Absent (0 rows). |
| *Confessio Augustana* | — | Absent (0 rows). |
| Gregory of Nazianzus | — | Absent (0 rows). |

**The Agrippa correction, and what it costs the argument.** A 1694 English
translation of exactly that uniform title is in the set. The matcher *did* surface
it — all four of our copies sit at `inconclusive` with 1–2 candidates, not
`none_found`. So this was never a corpus absence and never a matcher miss: **it is
an unscreened candidate**, and the answer has been sitting in the screening
backlog. The original row ("12 Agrippa rows, all *De occulta philosophia*") came
from an author-name search that missed the record; the uniform title finds it
immediately.

Two lessons, both the file's own doctrine turned on itself:
- **Query every field before writing "absent."** An author search and a uniform-title
  search are different questions. (The first re-check of this table also probed a
  field named `record_author`, which does not exist — the field is `author`. A
  query against a non-existent field returns 0 and reads exactly like a real
  absence. Same failure class as §7: *every bug in this area fails toward a
  confident clean negative.*)
- **§4 already says the 240 IS the join key.** The table was built by author.

### The "1.04% pre-1800" figure does not mean what it was used to mean

Imprint-year distribution of the 118,352 rows (measured 2026-08-02):

| 2000+ | 1950–99 | 1900–49 | 1800–99 | pre-1800 | no year |
|---|---|---|---|---|---|
| 55,441 | 51,835 | 6,722 | 2,684 | 1,230 | 440 |

**91% post-1950 — which is the correct shape for the question.** `year` here is
when the *translation* was printed, not when the original was written, and the
English translation of an early-modern Latin work is usually a modern imprint.
Reading 1.04% as "1% relevant" conflates the two dates. A modern-imprint catalogue
is the right instrument for defeating a first-translation claim; it is simply
missing part of its range.

The real, narrower gaps behind the six confirmed absences:
- **Early-modern English printing.** Sanford 1569, Ellistone 1651, Hall 1654 are
  all pre-1800 English imprints, and 1,230 rows cannot carry that period. This is
  exactly ESTC's range — which strengthens **#3522**, rather than resting it on the
  1% figure.
- **The `041$h` hard filter.** `ingest-loc-bulk.mjs` drops any record with no `041`
  field at all. Facing-page scholarly editions routinely carry none, which is why
  *Rhetorica ad Herennium* has zero rows despite Caplan's Loeb. Ours to fix, not the
  catalogue's.
- **Source-language depth against our holdings.** Latin is 3,878 rows against 6,506
  visible Latin books; Greek 2,333 against 1,096. French (21,982) and German
  (19,562) dominate a set our corpus does not.

> **Doctrine: a reference set's SIZE is not its COVERAGE — and a date column is not
> the date you think it is.** Before trusting a null, ask what fraction of the set
> falls in the period, language and population you are asking about, and check
> which event the date field records.

**Matcher/threshold work is *probably* finished — but that claim is no longer
evidenced by this table.** The MARC 240 fix (§4) was the last available gain from
matching. The Agrippa row shows the remaining loss in that case was screening, not
matching, which points at queue item 4 (screen the `inconclusive`) as much as at
adding sources. Do not re-cite §2b as proof that only sources remain.

---

## 3. What exists

| thing | what it is |
|---|---|
| `reference_translations` (Mongo) | 118,352 English translations from the LoC bulk MARC dump, 100% LCCN'd |
| `scripts/output/loc-bulk/` | the 43-part extract, re-derivable in ~15 min, free |
| `scripts/output/wikidata/` | 14,924 rows, 105 languages, 44.7% with native-script titles |
| `search_efforts` (Mongo) | one doc per book per generation: proposition, dated reference set with declared gaps, queries, every candidate with its screening reason, git SHA |
| `screening_decisions` (Mongo) | durable human judgements, re-applied to every future generation |
| `translation_catalogs` (Mongo) | 24,061 asserted prior English translations (UNESCO Index Translationum, LoC MARC, OpenLibrary, HathiTrust, Loeb, publishers). ⚠️ **carries no resolvable identifier** — see below |
| `translation_classification` (Mongo) | 9,908 model verdicts; 2,755 assert a prior. Prose citation only, no identifier. A lead, never a prior — see §3's third source |
| `bib_records` (Mongo) | raw MARC kept whole, keyed `source:identifier` |

Pipeline order:

```
ingest-loc-bulk.mjs  →  ingest-wikidata-translations.mjs
      → ft-reference-set-search.mjs --cohort badged|inverse|untranslated
      → ft-screening-triage.mjs
      → ft-verify-demote-packet.mjs        (live LoC re-fetch, sign-off packet)
      → ft-translation-queue.mjs           (prioritisation, --visible)
measurement: ft-reference-set-recall.mjs
```

All free: bulk downloads, local indexes, free endpoints. Zero API spend.

### Only one layer can produce a citation

Measured 2026-08-02. Three collections assert that a prior English translation
exists, and they are not interchangeable:

| layer | rows | book/work link | resolvable identifier | can it be cited? |
|---|---|---|---|---|
| `reference_translations` | 118,352 | via the matcher, per effort | **LCCN on 100%** → `catalog.loc.gov` | **yes** |
| `translation_catalogs` | 24,061 | **0 rows carry `book_id` or `work_id`** | **0 rows carry LCCN / OCLC / ISBN / URL** | no |
| `translation_classification` | 2,755 asserting a prior | `book_id` | **0 rows carry a URL**; 2,563 carry a prose sentence | no |

`translation_catalogs` is joined to books by **normalised title and author strings
at query time** (`english_title_normalized`, `canonical_author_normalized`) — it is
a matching table, not a set of records. A reader asking "which prior translation?"
cannot be answered from it, and neither can a reviewer.

This is the gap under the whole evidence layer: **where we assert a prior, we can
usually name it but rarely link it.** #3455 (`bib_records` — keep the whole
bibliographic record) and #3428 (resolve every claim to an authority record) are
the fix; until they land, only `reference_translations` findings belong in
reader-facing evidence.

⚠️ **Live contradiction, 2026-08-02:** 158 books are badged
`is_first_translation: true` while `translation_classification` names a prior
translation for them (883 of those 2,755 books are live and visible). The
classifier is a lead and not authority — but 158 unreviewed contradictions of our
own public claim is a screening queue, not a rounding error.

### The three sources, and why the third is not a catalogue

1. **LoC MDSConnect** (snapshot 2016-12-31) — the bulk of the set. Gaps in §6.
2. **Wikidata** P629 — thin outside Western literature (Tibetan 0, Classical
   Chinese 0, Syriac 0), but carries a native-script work title on 44.7% of rows
   against LoC's 2.3%, which is the one place it materially extends reach.
3. **`translation_classification`** (2,755 attributed priors, model-generated) —
   **a lead, never a confirmed prior.** Every candidate from it is screened
   `unresolved`. Letting it assert `prior_found` would let an unverified model
   claim drive a public verdict; letting it assert `only_partial_found` would let
   it drive *"no prior COMPLETE translation exists"*, an absence claim it cannot
   support either.

> **It raised COVERAGE, not recall, and structurally cannot raise recall.** It is
> a join on our own `book_id`/`work_id`, so it resolves the 607 books we already
> had an answer for and reaches nothing beyond them. Real value — those books now
> carry their prior instead of a false clean negative — but do not call it recall.

---

## 4. Work identity: MARC 240, and the 245 fallback

`scripts/lib/work-identity-match.mjs`, pinned by
`tests/unit/reference-set-work-identity.test.ts` (46 cases).

**MARC 240 exists precisely to name a work independently of how an edition titles
itself, so it IS the join key.** The test is set **containment** of the uniform
title in ours — not a coverage ratio on the 245 display title, which is the
edition's marketing line and carries apparatus our title never has. Generic
one/two-token uniform titles ("Annales.", "Journal.") additionally require
**author corroboration**.

**The 245 fallback** covers the 35.2% of rows with no 240. It was capped below the
confirmation threshold, so a third of the set could *never* confirm. The fix was
not a higher cap: on a 245 the overlap is frequently carried by **the author's own
name** — "Poetics" scores well against "The Rhetoric of Aristotle" while sharing
no work content. So: discount personal-name tokens, then require containment in
either direction, plus author agreement. That separates Euclid's *Elementa* from
"The thirteen books of Euclid's Elements" (min-coverage 0.50, same work) from
*Historia animalium* vs *De partibus animalium* (also 0.50, different works). A
ratio cannot; containment can.

> **Threshold tuning does not converge — find the right instrument.** The matcher
> was tuned five times. Pass 4 lost verified true positives (Cicero's *De
> Officiis*, Grimald 1556) *while making the corpus look cleaner*, and nothing
> would have caught it. **Write gold cases before touching the matcher.**

**CJK** is matched on original-script (MARC 880) containment only. Romanized
matching is unusable — mixed pinyin/Wade-Giles, differing syllable segmentation —
and was measured at ~2 real matches in 38.

---

## 5. The three cohorts — the same verdict means different things

Never pool them. Every effort records its cohort.

| cohort | population | what `none_found` means |
|---|---|---|
| `badged` | books we already claim | our public claim survived the search |
| `inverse` | visible, translated, unbadged | a claim we may have and never made |
| `untranslated` | everything we HOLD, non-English, no English translation (~57,600) | **a work queue** — nobody in this set has done it |

### Why 27% recall is acceptable for `untranslated` and not for badging

Prioritisation **publishes nothing**, and the error directions cost differently:

- a **missed** prior → the book sits too high in the queue; worst case we
  translate something that exists, caught on reading, harms nobody
- a **false** prior → we silently drop a genuinely untranslated work and never
  revisit it

So prioritisation needs **precision on "already done"**, which is this
instrument's strong direction: 32/32 live identity confirmations on the demote
packet, and **zero contradictions** across 399 books an independent classifier
calls `never_translated`. Same evidence, same recall, a job it fits.

⚠️ **`prior_found` is small for a mechanical reason, not because the holdings are
untranslated.** The mechanical screen never asserts PRIOR on its own — it defers
anything needing bibliographic judgement to `unresolved`. So `prior_found` counts
only works a human already ruled on. The real "already done" pile is the
`inconclusive` column, and screening it is what shortens the queue.

---

## 6. Declared gaps — what a null cannot mean

Every source's gaps are inherited onto every effort's `limitations`, because *a
gap named once in a manifest and never surfaced on the claim it undermines is not
a disclosure*.

- **Snapshot ends 2016** — later translations absent by construction.
- **1.04% pre-1800** — §2b. The dominant gap.
- **`041$h` required at extraction** — scholarly editions printing a text *with*
  its translation frequently carry no 041 and are excluded entirely. This is how
  *Rhetorica ad Herennium* has zero rows.
- **35.2% carry no 240** — now reachable via 245 containment, but only under
  author corroboration, so an **anonymous** work remains unconfirmable.
- **CJK reachable only via MARC 880**, present on 2.3% of CJK rows.
- **Romanized traditions** (Wylie variants) hide real matches; the generic-term
  stoplist was assembled without a specialist reader.

### Depth is not reachability

Reference-set **depth** per source language (French 23,217; German 21,271; Latin
4,717; Syriac 119) bounds what a null can mean, and `ft-translation-queue.mjs`
**refuses to emit one ranked list across languages** for that reason.

But depth alone is not enough: **Chinese looks perfectly deep at 3,868 rows and is
unanswerable anyway**, because CJK is reachable only via MARC 880. Ranking on
depth put the least trustworthy evidence at the top of the queue. Languages are
now gated on depth **and** reachability, and the unmeasured ones are reported as
*unmeasured*, never ranked low.

> **Keep "we could not ask" separate from "we asked and found nothing."**
> Conflating them turns an unasked question into a confident negative — the single
> most common way this system lies.

---

## 7. Invariants — the traps, each of which cost real work

- **A yardstick inside the set it measures reads 100%.** `translation_classification`
  is both a source and the recall test set; the combined figure is *exactly*
  100.0% and is meaningless. Report **catalogue-only** recall. (A metric's name is
  a claim about its denominator.)
- **`search_efforts` is a HISTORY, not a state.** Read it through
  `latestEffortPerBook()`. A naive `find({verdict:'inconclusive'})` once returned
  265 rows against a current generation of 75 — 190 rows of superseded, buggier
  judgement.
- **Screening judgements are about a (work, prior) pair, not a run.** Adding a
  source mints a new generation; the first time that happened it silently
  discarded all 45 screening decisions. They live in `screening_decisions` and are
  re-applied to every generation.
- **A demote presupposes a badge.** Gate on `books.is_first_translation`, not on
  `effort.cohort` — the cohort is what the search believed when it ran, the flag
  is the claim on the site now.
- **Unknown must never read as mismatch.** The language screen compared MARC codes
  against Wikidata Q-numbers and rejected 228 real priors (Xenophon's *Symposium*,
  all six *Rubáiyát*). Reject only when *both* sides resolve and disagree.
  Deliberately no QID table — labels are present on 100% of rows and are checkable.
- **`books.language` is the language of the WORK, not of the pages we hold.**
  Ganguli's *Mahābhārata* and Avalon's *Serpent Power* are catalogued Sanskrit and
  are already English. Screen with `english-source-detect.mjs`, sampling from
  **mid-book** — front matter is English even in a Latin edition.
- **Strip editorial wrappers before measuring any page text**, or you measure our
  own AI annotations. That bug shipped here and inflated a count 6×.
- **Long paced runs need `noTimeout`.** The demote packet died at 300s having
  completed 31 of 33 works and written *nothing*.
- **Rights-class `hidden_reason` is an absolute exclusion** from any translation
  queue. A work we cannot publish must never be queued, however untranslated.

**Every bug in this area fails toward a confident clean negative.** Fourteen
defects in one session, not one of which produced a false positive. A null is the
cheap answer at every layer — an inverted year comparison, a capped threshold, a
throttled endpoint returning HTTP 200 with HTML, a schema mismatch between two
extractors. **When something looks clean, suspect the instrument.**

---

## 8. Current state and what is open

**Verdicts** (2026-08-01, both cohorts applied; **no badge was changed** —
`is_first_translation` moves only through the sign-off-gated reconcile, #2933):

- badged (5,947): `none_found` 5,568 · `inconclusive` 301 · `prior_found` 47 ·
  `only_partial_found` 16 · `not_searchable` 15
- inverse (10,126): `none_found` 7,843 · `inconclusive` 2,114 · `prior_found` 115
- untranslated (57,599): `none_found` 55,197 · `inconclusive` 1,864 ·
  `not_searchable` 523 · `prior_found` 12

**What renders today:** 5,839 books show a first-translation claim (the book-page
stat line has no verdict gate; the evidence panel requires one). Of those, **285
render the full evidence panel while their own effort says `inconclusive`**, 46
while it says `prior_found`, and 15 while it says `not_searchable` — all 15
Tibetan monastery items where no access point exists at all.

**Open, in priority order:**

1. **Badge copy.** ~5,839 live claims rest on evidence with ~50% PPV from a set
   that is 1% early-modern. This is not a badge needing better evidence; it is a
   claim whose shape is wrong, and **no achievable recall fixes it**. Swapping to
   the search statement makes all of them true immediately and is gated on nothing.
2. **Sign off the demote packet** — 46 badges, 32 works, identity confirmed 32/32
   (`scripts/output/ft-demote-packet-*.json`). Includes duplicate cleanup: *De
   formula honestae vitae* is badged on 10 records.
3. **#3522 — add ESTC.** Free JSON API at CERL, 487,406 records, carries MARC 240
   + `$l English` (the key the matcher already uses). ⚠️ deep paging dies at
   `from=10000` with **HTTP 200 and no rows**. Pair with relaxing the `041$h`
   filter.
4. **Screen the ~2,415 `inconclusive`** — cheaper once the set covers our period,
   and no longer only a tail task: the Agrippa case (§2b) shows a verified prior
   already sitting in this queue, unread. Start with the **158 books badged while
   `translation_classification` names a prior** (§3) — those contradict a live
   public claim and the lead is already written down.
5. **Tibetan/Chinese reference sets** — 84000/BDRC, CBETA/ctext. 795 + 450 badges
   rest on catalogues that structurally cannot answer.
6. **A Tibetanist** should review the romanized generic-term stoplist.

Full session postmortem: private ops repo,
`handoffs/2026-08-01-reference-set-and-first-translation-audit.md`.
