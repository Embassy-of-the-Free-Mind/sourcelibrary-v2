# 2026-08-08 — Acquiring five Greek authors, and the identity machinery it exposed

Started as "acquire Epicurus, Longinus, Sappho, Sextus Empiricus, Polybius." The
acquisition was the easy half; assigning `work_id` to what arrived surfaced two wrong
author anchors in production, a non-deterministic resolver, and a scope filter that had
been quietly excluding the entire import backlog from author identity.

**Merged:** #3742, #3766, #3769. **Filed:** #3770, #3780.

---

## 1. The acquisition (#3742)

40 editions, 15,722 pages, imported hidden. Followed the canonical loop in
`.claude/docs/import-workflow.md`: enumerate from IA with `enumerate-dedupe-source.ts`
per author, dedupe on `source_fingerprint`, subject-filter by hand.

The hand filter was load-bearing. "Sappho" returned Daudet's novel, Bret Harte's short
stories and four printings of Grillparzer's tragedy; "Epicurus" returned Anatole France
and a shelf of garden essays. All 40 probed against `archive.org/metadata` first — none
lending-restricted. Nothing after 1929.

Notable: Charleton's 1656 first English Epicurus; Rosini's 1818 *De Natura* from the
Herculaneum papyri; Hervet's 1569 Latin Sextus (ancient scepticism as Montaigne and
Descartes met it); Casaubon's 1609 Polybius; Polybius VI on the mixed constitution
printed alone in 1539. Completed the Shuckburgh Polybius — we held only vol. 2.

**Bug I introduced and fixed the same session.** The import script passed each book's
*edition* language as the route's `original_language`. `resolveLanguage()` nulls that
field when it equals `language` (FRBR work == manifestation), which leaves
`is_translation` false, and `classifyTextRole()` returns `'original'` for **any**
non-English scan without that flag. Boileau's French Longinus, Gori's Italian Longinus,
Hervet's Latin Sextus and Huart's French Sextus were filed as original-language sources.
Repaired by `scripts/maintenance/fix-greek-five-language-roles.mjs` (24/24).
English translations were unharmed — the classifier has separate title/author
heuristics for those — so **the damage is invisible unless you look at the non-English
rows specifically**.

## 2. Work identity (#3742, second commit)

63 books clustered, 6 author docs. Two anchors were **wrong in production**:

| | was | now | |
|---|---|---|---|
| `authors/sextus` | `Q1270100` | `Q236594` | the *Sentences of Sextus*, a collection of maxims — a **text** used as a person. Four visible books. |
| `authors/longinus` | `Q436634` | `Q744540` | Cassius Longinus, the Neoplatonist to whom *On the Sublime* was wrongly ascribed. Wikidata carries both on the work (`P50 = Q744540, Q436634`) — a real scholarly conflation, not a typo. |

There was **no Epicurus at all** in a 4,825-author thesaurus. Also added Sappho,
Metrodorus, Anacreon; tombstoned the editor-as-author doc
`sappho-ed-henry-thornton-wharton` into `sappho`.

Hand-adjudicated rather than resolved, for two reasons that are worth keeping: no book
had an `author_id` (IA imports never set one), and Wikidata models Sappho as ~208
individual numbered fragments while every book we hold is the whole corpus.

Verified with `scripts/analysis/work-coverage.mjs`, which immediately surfaced a real
gap: `local:a:epicurus:morals` reports `hasOriginal: false` — two English renderings of
the ethical remains, no Greek original held. The fragmented local-mint ids could not
express that.

## 3. Resolver correctness (#3766)

`resolve-work-ids-wikidata.mjs` **decided by SPARQL row order**. Three items share the
label "The Histories": `Q250816` (the work), `Q16038921` and `Q53748127` (editions of
it). No `P31` filter, containment ties at 1.00, tie-break is strict `>` so it keeps
whichever arrived first. Replayed offline in two orders → `Q250816` one way,
`Q53748127` the other, for the same book, **at HIGH confidence, auto-applied**.

Fixed: edition-class items excluded at source; genuine ties demote to LOW with the tied
QIDs recorded; anchors validated before matching; SPARQL failures no longer print
`HIGH 0` (a 502 and a 429 both did that during this session).

New standing audit `scripts/audit/author-anchor-validity.mjs` — **20 bad anchors**,
worst `mao-yuanyi-compiler` (105 books pointed at the *Wubei Zhi* itself).

**The most valuable thing here came from getting it wrong first.** My initial rule was
`P31 = Q5`. It flagged 38 anchors including **Homer**, **Hermes Trismegistus**,
**Orpheus**, Enoch, Vyāsa and the Sibyl. Those aren't errors — attributed and legendary
authorship is what a library of Hermetica and Orphica is *made of*, and shipping that
would have gated the resolver against the collection's core. Now a denylist of things
that cannot be authors (works, reference books, disambiguation pages), in a shared lib
so audit and resolver can't drift, validated with a positive control before trusting it.

## 4. The real bottleneck (#3769)

Both halves of the author layer were scoped live-only —
`backfill-author-canonical-links.mjs` **and** `build-authors-collection.mjs:71` share
`{visible:{$ne:false}, pages_count:{$gt:0}}`. Imports land hidden by invariant, so every
acquisition is born outside the identity system.

- 63,568 books with an author string and no `author_id`
- **43,858 excluded purely for being hidden**
- the backfill was scanning 19,712 and reporting a tidy result

`author_id` gates both work resolvers, so the backlog could not acquire `work_id` at all
— backwards, since `work_id` answers "do we already hold this?" and that pays off while
a book is still in the backlog. `--include-backlog` linked **10,101** books
(`modifiedCount` 10,101/10,101); coverage 83.7% → 74.8% missing. Own `RUN_ID`, so
`--undo --include-backlog` reverts it without touching earlier live linkage.

## 5. Open

- **#3780 — the thesaurus half.** 56,420 books / 18,973 distinct strings still unmatched.
  Pareto-shaped: **1,640 strings ≥5 books cover 32,545 books (58%)**; 13,030 are
  singletons. Three populations need opposite treatment — CJK personal names (12,658
  books) want docs, institutional headings (`Drametse Monastery Collection`, `Thadrak
  Temple`) want `is_person: false` and would otherwise render as schema.org `Person`,
  and 7,013 placeholder books want nothing. **Not a filter deletion**: the backlog is
  exactly where junk strings live (#3434, #3770), and a rebuild can reshape existing
  clusters and relink live books.
- **#3770 — `[object Object]`.** 3,297 books, all hidden, zero visible.
- **LLM merge pass unfinished.** `llm-verify-work-merges.mjs` was at ~800/1387 authors
  when the session ended (proposals only, no writes, ~$1 of `gemini-3.1-flash-lite`).
  It writes `scripts/output/llm-work-merge-proposals.json` **only at the end**, so a
  killed run leaves nothing — **re-run from scratch**, don't look for partial output.
  1,387 candidate authors; the 10,101 newly-linked books are what make more of them
  eligible.

## 6. Downstream effects to expect

Checked per the new "writing to a store an automated job reads is ACTUATION" rule:

- **05:30 `reconcile-first-translation-flag --only-demotions`** reads
  `first_translation_attempts`. **Zero rows written this session** — it cannot demote a
  badge because of this work. One badged book changed cluster (Usener's *Epicurea*,
  hidden, alone in its cluster, so no "who is first" contest was created).
- **02:30 `mint-local-work-ids --apply --include-parts --include-hidden`** now sees
  10,101 more author-linked books and will mint local `work_id`s for the ~751 that lack
  one. Designed behaviour, additive.
- **Preview OCR is not free.** `/api/import/ia` calls `queuePreviewOcr` (`route.ts:362`),
  OCRing the first 25 pages of every import — it fired on all 40 automatically,
  ~1,000 pages, ~$2.73 computed. I had told Derek "no OCR, nothing spends on these
  pages" before checking; that was wrong. It did earn its keep once: IA titled
  `gri_33125008560068` with a generic series name and the OCR'd title page read
  **TOMUS II**, which is how that volume got filed correctly.

## 7. Doc changes made

- `.claude/docs/invariants/author-identity.md` — the live-only scope that capped the
  subsystem, and why #3780 can't be a filter deletion.
- `.claude/docs/invariants/work-identity.md` — new section on verifying Wikidata QIDs:
  edition-vs-work `P31`, the author denylist and why `P31 = Q5` is wrong *here*, silent
  failure modes, and that the resolver is near-exhausted so leverage is upstream.

`CLAUDE.md` untouched (222 lines, under budget) — both lessons are subsystem-triggered.
