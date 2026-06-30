# Tier-0 first-translation catalog — extending beyond Latin (#2899)

**Status:** infrastructure shipped + Sanskrit/Chinese seed live (9 rows); audit
proves the mechanism. The big open canon catalogs (84000, Sefaria, GRETIL/CBETA)
do NOT survive the matcher's join as-is — see "Why naive ingest fails" below.

## What Tier-0 is
`translation_catalogs` (Mongo, `bookstore`) is the deterministic registry the
first-translation matcher (`scripts/eval/ft-catalog-match.mjs`) consults to
answer "does a complete prior English translation of this work already exist?"
before the expensive Tier-2 Claude oracle runs. A guard-passing match = a
demote *candidate* (Tier-0 only nominates; Tier-2 confirms — nothing auto-flips).

It was built entirely from Latin sources (USTC + Latin harvests): all 24,040
original rows were `source_language: 'la'`.

## The matcher's join (why coverage ≠ "just add rows")
For a catalog row to ever match a book, the matcher requires ALL of:
1. **Author surname** — rows are indexed by `author_surname`; an anonymous row
   (no resolvable surname) is never even a candidate.
2. **Title-token coverage ≥ 0.60** — ≥60% of the book-title's significant
   (≥4-char, non-stopword) tokens must appear in the catalog row's
   `english_title`/`canonical_work`.
3. **Four guards all pass**: ANTHOLOGY (not a collection/study of this work),
   COMPLETENESS (`completeness === 'complete'`), **SOURCE_LANG** (catalog
   `source_language` ISO === the book's source ISO), NAMESAKE (author overlap,
   not a bare-surname collision).

The SOURCE_LANG guard is the safety rail: a Latin→English row can only ever
defeat a Latin-source book. That is why a Latin-only catalog gives **zero**
coverage outside Latin — correctly (no false merges), but the cheap path never
helps non-Western traditions.

## Why naive ingest of the big canon catalogs fails
Measured against our corpus (`scripts/_tmp_*` probes, 2026-06-30):

- **84000 (Tibetan, CC0 RDF — `github.com/84000/data-rdf`)**: 727 published
  translations, but **every `bdo:creator` carries role R0ER0017 (translator)** —
  there is **no ancient-author field at all**. So every 84000 row is anonymous
  to the surname index. Its titles are Tibetan script (`@bo`) and Sanskrit IAST
  (`@sa-x-iast`); our Tibetan books' titles are Wylie/English, so they don't
  token-match either. → 0 usable rows.
- **Sefaria (Hebrew/Aramaic, CC0 API)**: the canonical Kabbalah works are
  **pseudepigraphic** (`authors: []` — Zohar, Bahir, Sefer Yetzirah), i.e.
  anonymous to the matcher; and few have a *complete* published English, so they
  shouldn't carry `completeness:'complete'` anyway. Named-author works
  (Maimonides, Cordovero…) exist but are a thin slice.
- **work_id can't bridge it**: our books carry internal `local:<author>-<slug>`
  ids (a few have Wikidata QIDs), not the BDRC/Wikidata ids the external
  catalogs key on. There is no deterministic join.

**Conclusion:** the surname+title join only works where a NAMED author appears
in **Latin script in both** the catalog and our book record. That holds for the
famous named-author works of Sanskrit and Chinese (and some Hebrew), which is
exactly where well-known **complete public-domain English translations** exist.

## What shipped (#2899)
1. **`scripts/lib/translation-catalog-record.mjs`** — shared record builder
   (same normalization as `import-translation-catalogs.mjs`) + a
   `KNOWN_SOURCE_LANGUAGES` ISO whitelist. `buildCatalogDoc()` throws on a
   missing/invalid `source_language` so a guard-defeating row fails loud at
   ingest (the #2892/#2893 false-demote failure class).
2. **`scripts/enrichment/ingest-translation-catalog-records.mjs`** — reusable,
   idempotent, dry-run-default writer. Drops anonymous rows (can't match) and
   upserts on (source, author_surname, english_title, translator, year).
3. **`scripts/import/build-nonlatin-catalog-seed.mjs`** — a curated, provenance-
   cited seed of named-author **complete** translations:
   - Sanskrit (`sa`): Manu (Bühler/SBE25), Bhagavad Gītā (Telang/SBE8),
     Yoga-Sūtra (Woods/HOS17), Vedānta-Sūtras+Śaṅkara (Thibaut/SBE34-38),
     Abhidharmakośa (Pruden), Mūlamadhyamakakārikā (Inada).
   - Chinese (`zh`): Dao De Jing (Legge/SBE39), Zhuangzi (Legge/SBE39-40),
     Analects (Legge, Chinese Classics I).
   Output: `scripts/data/nonlatin-translation-catalog-seed.jsonl`.
4. **Matcher robustness** (`scripts/eval/ft-catalog-match.mjs`):
   - `LANG_TO_ISO` extended to the non-Latin buckets (he/arc, sa/pli, bo, zh
     incl. classical/literary, sux, akk, fa, ja/ko, …) + self-mapping ISO codes.
   - `extractSurname()` now strips parenthetical role markers (`(comm.)`,
     `(ed.)`, `(attr.)`) and handles `"Primary; Commentator"` multi-author forms
     (takes the primary) — ubiquitous in non-Latin attributions. Aligns the book
     side with the catalog importer's logic; no Latin demote regression (verified
     0 demotes in badged mode, same as before).
   - `--audit [--lang a,b,c]` report-only mode: scans all visible/translated/
     non-English books (not just FT-badged) and reports per-tradition match
     precision (the #2885a alignment audit). Never records attempts.
5. **`scripts/maintenance/relabel-nonlatin-catalog-source-language.mjs`** —
   author-allowlist relabel of clearly-mislabeled `la` rows (Luo Guanzhong→zh,
   Vālmīki/Kālidāsa→sa, Wu Cheng'en→zh). Title-marker relabeling is unsafe
   (11/16 keyword hits were false positives — Apuleius's "Golden Ass, or A Book
   of Changes" etc.). 5 rows relabeled.

## Audit result (2026-06-30)
`node scripts/eval/ft-catalog-match.mjs --audit --lang Sanskrit,Chinese`:
- 7 books matched the seed; **5 demote candidates, 100% precision** (all genuine
  prior complete English): Dao De Jing→Legge, Abhidharmakośa→Pruden, Brahma-Sūtra
  →Thibaut, Bhagavad Gītā→Telang, Yoga-Sūtra→Woods.
- **Zero false merges.** The 2 `needs_review` cases show the guards working:
  Zhuangzi held back by ANTHOLOGY ("Writings of…"), and a Kālidāsa book correctly
  rejected a Latin-tagged catalog row via SOURCE_LANG + COMPLETENESS.
- Two non-Latin traditions (sa, zh) now produce correctly source-language-gated
  candidates. Acceptance criteria met.

Note: most seed-matched works aren't *currently* FT-badged, so immediate badged-
book impact is small; the value is the proven mechanism + correct priors for
future FT decisions on these works.

## Round 2 (2026-06-30, #2901): canon-grounding is EMPTY for our holdings
The "give the canon external work-ids → work-id-anchored Tier-0" idea (below) was
tested before building it, and the premise does not hold **for what we actually
hold**:
- **84000 ↔ our Tibetan corpus: ZERO overlap.** Parsed 480 published 84000 texts
  (CC0 RDF) and token-matched (Sanskrit-IAST + English titles) against all 1,470
  visible/translated Tibetan books → **0 hits**. Our Tibetan corpus is indigenous
  Tibetan literature (Nyingma termas, Milarepa songs, Tsongkhapa/lamrim treatises),
  NOT the Kangyur/Tengyur sūtras 84000 translates. We don't hold those sūtras, so a
  prior-catalog of them can't match anything.
- **External work-ids are ~absent on the non-Latin corpus**: of 3,998 visible/
  translated non-Latin books, only **194 (5%)** carry a Wikidata QID (179 Greek +
  15 Sanskrit — already from the classical resolver); **3,743 (94%)** carry
  internal `local:` slugs that join to nothing external.
- **General lesson**: a prior-translation catalog's value = overlap between {works
  it says have English} and {works we hold and badge FT}. Our corpus is *selected*
  for untranslated/obscure material, so external "complete English exists" catalogs
  structurally MISS it — which is the CORRECT answer (those books genuinely ARE
  firsts). Building the BDRC/84000 pipeline would have produced ~0 matches.

So the only lever that pays off is the **named-author famous-work seed**, expanded
to the full public-domain canon (18 rows: + Mahābhārata/Ganguli, Rāmāyaṇa/Griffith,
Arthaśāstra/Shamasastry, Kāma Sūtra/Burton, Mencius/Sunzi/I-Ching/Legge-Giles,
Milinda/Rhys Davids (pli), Tirukkural/Pope (ta)). Across ALL non-Latin a broad
author scan finds only **7 famous-author FT badges total** — confirming the corpus
is overwhelmingly genuine firsts.

### The "famous base text + classical commentary" pattern (route-to-human)
The two LIVE famous-work FT badges are both *text + named commentary* editions:
- **老子元翼** (Jiao Hong's 64-commentary anthology of the Daodejing) — base text
  Englished since Chalmers 1868/Legge 1891.
- **Tirukkural with Parimelazagar commentary** — base text Englished since
  Pope 1886; the *commentary* is Tamil-only even in our own Lazarus 1885 holding,
  so a narrow "first complete English of the Parimelazagar commentary" claim is
  plausible (one ambiguous 1955 prior unresolved).
In both, the badge MISLEADS as catalogued (titled as the famous base text) but a
narrow commentary-first claim may be genuine. **Decision (Derek, 2026-06-30): KEEP
the badge + reframe the metadata** to foreground the commentary (recorded in each
book's `translation_verification.ft_reframe_needed_2026_06_30`; evidence in
`scripts/output/ft-evidence-2026-06-30/commentary-edition-ft-verify-2026-06-30.json`).
This is the FT runbook's "route famous-adjacent works to a human specialist" case.

## Superseded follow-up (kept for the record — do NOT build the 84000 path)
The anonymity + cross-script blockers suggested a cross-lingual work-identity
layer (BDRC for 84000, Wikidata elsewhere). Round 2 above shows this yields ~0 for
our holdings — **do not build it for Tier-0 prior-matching.** (Work-ids are still
worth pursuing for OTHER reasons — clustering, dedup — under #2318, just not as a
Tier-0 prior-catalog lever.) Expanding the named-author seed where the author
appears in Latin script remains the only productive direction.
