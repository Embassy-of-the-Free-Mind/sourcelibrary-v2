# Card round 2 — 2026-08-11

*Sample: 22 cards from the post-rules 919-card seed (8 entry, 8 empty, 4 random,
2 sibling-disagreement; 2 disagreement draws duplicated round 1 and were
excluded). Verifiers: 6 independent Claude subagents, unprimed on absences.
All 16 card corrections applied same-day; collection still has no readers.*

## Scores

**Entry claims (~34 checked):**
- CONFIRMED with records: ~15 — including three *complete*-translation proofs of
  unusual quality: Newton 1575 proven structurally from the OTA TEI XML (three
  Bookes = libri III); Wang & Zhao 2008/2011 as the first complete *Dream Pool
  Essays*; Soranzo 2019 (Brill) as a full Chrysopoeia translation.
- **FABRICATED: 3** — Thompson 1932 "Chrysopoeia" (real author, real year, real
  publisher-plausible title; his actual 1932 book full-text-checked), Christie
  1980 (real historian, no such work), "Ya-chuan Wang 2018". All three carry the
  real-author/invented-title signature, **all three passed the hygiene rules**
  (translator+year = locatable) — only unprimed verification catches this class.
- WRONG (real publication, wrong content/text): 4 — Strunk 1950 (full-text grep
  with positive control: zero Tartini), Sivin 1975 (study), Goldwyn & Kokkini
  2015 (translates Tzetzes, leaked onto Homer's card), Dowman (wrong tertön's
  namthar, conflated title).
- Reclassified: Metzger (study, not translation); Kapstein & Shakya (genuine
  partial translations — kept, completeness made explicit); Bekker 1695 =
  Book I only, 1700 = retitled reissue.
- Date corrections: 3 (Evangelion 2000≠1990; Gunther 1934≠1933; Aubery 1577≠1584).
- Dedupe: 2 cards (Bekker ×3→1, Shen Kuo ×3→1).

**Absence claims (10 attacked):**
- **HELD: 8 of 8 testable** — cumulative across rounds: **14 of 14**. Zero
  missed priors in the method's history so far.
- CATEGORY ERROR: 1 (Grew — English original with a Latin title; the Parker
  class, now 2-for-2 rounds → the English-original screen is the top
  card-existence risk).
- UNTESTABLE: 1 (Ogyen Choling "phyag rdor sgrub thabs" — generic title, text
  unidentifiable; an absence claim on an unidentified text is meaningless).

**Structural findings:**
- Seeder mapping bug found and fixed: book-grain `not_applicable` (usually "this
  edition is itself a translation") must NOT become work-grain
  `not_a_single_work` — it mislabeled De Materia Medica, whose corrected card
  now carries Goodyer 1655/1934 + Beck 2005.
- Work-identity bug caught by address: Q16547641 (7 books + a 12th-c. codex) is
  Wikidata's node for POPE'S 1720 TRANSLATION, not the Iliad (Q8275). Routed to
  the work-merge queue.
- Modeling decision ADOPTED: cards live on WORK nodes; manuscripts are
  witnesses. A per-witness card duplicates identical entries and still
  misrepresents bundled second works (the Tzetzes leak). Two witness cards
  flagged for re-homing.

## Error classes

| class | round 1 | round 2 | trend note |
|---|---|---|---|
| fabricated_entry | 0/14 | 3/34 | new class surfaced at larger n; hygiene-proof; verification-only |
| wrong_attribution | 1 | 4 | wrong-text pins; the gloss/conflation signature recurs |
| missed_prior | 0/6 | 0/8 | **0/14 cumulative** — the searches are good |
| wrong_work_identity / category | 2 | 4 | English-original screen is the top fix (2 rounds running) |
| entry hygiene | 3 (now write-blocked) | 2 filler + 2 dedupe | rules working; extend placeholder screen to translator/year fields |

## Rules adopted this round

1. `not_applicable` (book grain) → `under_review` (work grain), never
   `not_a_single_work` (seeder fixed).
2. Consistency check extended: `not_a_single_work` with complete entries also
   flips to `under_review`.
3. New card states needed: `original_language_is_english` (Parker/Grew/Purchas
   class) and `text_unidentified` (generic-title manuscripts).
4. Placeholder screen must also cover translator/year fields ("Various",
   "Not specified") while preserving genuine `anonymous`.
5. Entry dedupe by (translation event), not (author-string, year-string).
6. Witness cards re-home to work nodes; bundled second works get their own cards.

## The method finding that matters

The layering is now demonstrated, not asserted: **write-time rules kill noise
(41.5% of raw entries); unprimed verification kills well-formed fabrications
(3 found, all hygiene-proof); nothing has yet beaten the absence searches
(14/14).** Each layer catches what the previous one structurally cannot.
