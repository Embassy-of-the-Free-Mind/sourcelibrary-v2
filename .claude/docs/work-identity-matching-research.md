# Fixing citation → work → holdings matching (research, 2026-06-20)

How to match a **cited work** (in a reading list, footnote, bibliography) to the
**books we hold**, without the two failure modes that plague fuzzy/embedding
matching:

- **False negatives** — miss a work we hold under a divergent title/language
  ("Golden Ass" ≠ our "Apuleii Metamorphoseos"; "Corpus Hermeticum" ≠ "Poimandres").
- **False positives** — "same author, wrong work" (Porphyry's *lost* *De regressu
  animae* → his *Sententiae*; Damascius *In Phaedonem* → *De principiis*) and
  cross-author title coincidence (Middleton's play *A Game at Chess* → Cessolis's
  medieval *Game of Chess*).

Source: deep-research pass (`wf_3389a3b3-75d`, 21 sources, 24/25 claims verified
3-0 / 2-1). This is the design basis for rebuilding the SHWEP reading-room matcher
and for trusting the acquisition gap list.

## The core principle
**Resolve BOTH sides to the same canonical work-identity space, then match on ID
equality — never fuzzy title/embedding matching.** Our books already carry
`work_id` (a Wikidata QID; see `work-identity-coverage.md`). The missing half is
resolving the **citation** to a work_id with the same rigor. Match on
`citation.work_id == book.work_id`:
- Solves false negatives — every edition/translation of a work shares one QID,
  regardless of title or language (this is the FRBR/IFLA-LRM Work entity: a
  translation is a new *Expression* of the *same Work*, the same collocation
  library uniform-title authority control has always done).
- Solves false positives — distinct works have distinct QIDs; a *lost* work has
  **no edition pointing at its QID** → correctly "we don't hold it," not a
  same-author guess.

**False-positive guard (from IFLA-LRM, verbatim):** "similarity of factual or
thematic content alone is not enough to group several expressions as realizing
the same work." So the rule is **author-anchor agreement AND work-id match** —
never thematic/title similarity. That kills Middleton→Cessolis (different authors)
and De regressu→Sententiae (different work-ids).

## Identifier systems (what to use as backbone vs. fallback)

| System | What it is | Use |
|---|---|---|
| **Wikidata QID** | Universal work id; covers ALL traditions incl. Islamicate, Byzantine, Renaissance | **Backbone** — already our `work_id`. The only viable id outside Greek/Latin antiquity. |
| **CTS URN** (CITE Architecture: TLG Greek + PHI Latin + Stoa) | `textgroup.work` e.g. `tlg0059.tlg030` = Plato *Republic*. Language-/edition-independent, FRBR Work-level, persistent | **High-precision overlay for Greek/Latin/patristic.** Bridged from author via Wikidata **P12869 (LAGL Author ID)** → author CTS URN, then work-level match within that author. |
| **VIAF** | Aggregates ~37 national authority files → one id/author (variant names across LC/BNF/DNB) | **Cross-lingual author anchor** (Latin↔vernacular name variants). Author-level only — its work lists are non-exhaustive. |
| **LAGL / Iowa Canon** (catalog.lagl.org) | Models lost-by-title + fragmentary works as **separate entries** with a `status` field (complete/fragmentary/lost), **attested abbreviations**, and Perseus URI cross-refs | **Fallback for lost/fragmentary/anonymous**, AND the **abbreviation→work decoder** for scholarly forms ("de myst.", "civ. dei"). |
| **Clavis Patrum (Graecorum/Latinorum)** | Catalogs patristic works extant only in translation or lost (*deperdita*) | Fallback for patristic lost/translation-only works. |
| **Trismegistos Authors** (KU Leuven) | All-languages author/work ids, 800 BC–AD 800 | Supplementary breadth (WIP, partial). |

**Critical coverage caveat:** TLG/PHI/Stoa/Clavis/LAGL are overwhelmingly
**Greek/Latin classical–patristic**. SHWEP's Islamicate, Byzantine, and
Renaissance/early-modern material is NOT well-covered by these canons — there,
**Wikidata QID is the only work-id**. So Wikidata is the backbone; CTS URN is a
precision booster where it exists.

## The structural gap that maps to our hard cases
Lost / fragmentary / anonymous works are **exactly where canonical TLG/PHI numbers
are missing** (Perseus documents this directly). So:
- **Lost works** (De regressu animae, fragments/testimonia) → resolve via LAGL/
  Clavis `status=lost`; the pipeline returns **explicit "no holding / lost work"**,
  never a same-author fallback.
- **Anonymous works** (Chaldaean Oracles, Nag Hammadi) → no author to anchor on;
  resolve title-direct against Wikidata/LAGL (our existing rare-token fallback).
- **Same-author-many-works** (Proclus's ~10 commentaries) → VIAF/Wikidata fixes the
  author anchor; the work-level CTS URN / QID disambiguates which work.

## Recommended pipeline (citation → canonical work → holdings)
Mirrors the proven two-stage design (Romanello's CitationExtractor: CRF/NER extract
→ separate disambiguation/matcher; modern transformer NER replaces the CRF stage):

1. **EXTRACT** cited work + author from the reading list (LLM, as today). Also
   capture the scholarly **abbreviation** form ("de myst.").
2. **NORMALIZE** abbreviation → canonical work title via a classical-abbreviation
   table (OCD/LSJ/Lewis-Short/Perseus `abbrevhelp`/LAGL attested-abbreviations).
3. **RESOLVE AUTHOR** via the existing author thesaurus → VIAF/Wikidata (cross-
   lingual anchor). Anonymous → skip to title-direct.
4. **RESOLVE WORK to a work_id:** Wikidata QID (existing resolver) as the universal
   key; add CTS URN for Greek/Latin via the author's work list (P12869 bridge).
   Honor LAGL `status=lost` → return "no holding."
5. **MATCH holdings by ID equality:** `citation.work_id == book.work_id` (our books
   already carry `work_id`). No fuzzy match.
6. **GUARDS:** require author-anchor agreement AND work-id match; never thematic/
   title similarity; explicit "lost/anonymous/uncertain" outcomes instead of a
   forced match.

## What this means for Source Library concretely
- **Reuse, don't rebuild.** The book side already has `work_id` (Wikidata,
  ~95–98% on Greek/Latin via `resolve-work-ids-wikidata.mjs`). The fix is to run
  the *same* author-anchored resolver on the **cited works**, then match on QID.
- The SHWEP embedding+LLM matcher should be **replaced** by this for the
  classics-heavy episodes; keep LLM only for extraction + the anonymous title-
  direct tail.
- **Acquisition gap is currently inflated** by work-level false negatives (we
  flagged "acquire" for works we hold under divergent titles — Golden Ass, Hamlet
  in the First Folio, Theologumena arithmeticae, Ecclesiastical History). Re-derive
  the gap from `work_id` clusters (`work-coverage.mjs`), not title matching.

## Open questions (verify before building)
1. **Work-level Wikidata↔CTS crosswalk** — a claim that "no LAGL *Work* ID property
   exists" was *refuted* (0-3), so a work-level bridge may now exist. Check Wikidata
   for a LAGL Work ID property; if present, our QID `work_id`s bridge straight to
   CTS URNs.
2. **Machine-readable abbreviation→work table** — LAGL "attested abbreviations" and
   Perseus `abbrevhelp` were referenced but the downloadable crosswalk wasn't
   pinned. Need the actual file/API.
3. **Non-Greek/Latin coverage** — confirm Wikidata QID is the only fallback for
   SHWEP's Islamicate/Byzantine/Renaissance works (likely yes).
