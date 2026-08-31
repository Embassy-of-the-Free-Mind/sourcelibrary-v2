# Round 5 — Tier-2 oracle brief (UNPRIMED)

You are auditing a "first English translation" claim for a library. Decide whether
OUR book is the FIRST complete English translation of THIS specific text — by doing
REAL `WebSearch` / `WebFetch` and actively trying to **REFUTE** the claim (find a
prior). AI tends to wrongly assume "no prior" — fight that bias.

Our record IS the source-language original and we have produced an English
translation of it, so a plain source-language original is a **valid** candidate —
do NOT mark `not_applicable` merely because the book is in its original language.

**Thoroughness floor — before concluding "no prior", you MUST consult at least:**
WorldCat, archive.org, **and** one tradition-appropriate catalogue or scholarly
bibliography for the source language. Weight library catalogues, scholarly
publishers and digital archives (HathiTrust, Brill, Cambridge/OUP, university
presses, ESTC/VD16/VD17, tradition catalogues such as 84000/BDRC for Tibetan,
CTEXT/SIKU for Chinese, ETCSL for Sumerian, Sefaria for Hebrew).
**DISTRUST** aggregator / file-share / forum / AI-mirror sites (Scribd,
dokumen.pub, pdfcoffee, blogspot, reddit, ebay, goodreads, grokipedia) — never
conclude "a prior exists" from those alone.

Disambiguate THIS work from parent / sibling / derivative works and other editions.

**Source-language rule (decisive):** if a complete modern English translation of
THIS WORK exists from ANY source language, the verdict is `not_first` — even if our
copy is in a different language than the prior translator used. Use
`first_from_source` ONLY when our text is a distinct, separately-citable
intermediary never Englished while the underlying work has been.

**`not_applicable` is NARROW.** It means ONLY: our item is *already in English*
(an English original, or an existing English edition/translation), OR it is
wordless visual art with no translatable prose. A multi-work container /
anthology / single volume of a larger set / scripture-or-liturgy compilation is
**NOT** `not_applicable` by itself — judge it like any other text: if a complete
prior English of THIS content exists → `not_first`; if none does and our English
is the first rendering of that material → a **first**. "Container" and "scripture
copy" are cataloguing labels, not translation facts.

**A prior only defeats the claim if it is formally published with a durable
identifier** — a DOI, an ISBN, or a formal press/journal imprint. Web-only
translations (including AI-assisted ones) should be REPORTED in
`prior_translations_found` with their nature stated in `reasoning`, but set the
verdict as if they do not defeat.

## Return ONLY this JSON, nothing else

```json
{
  "book_id": "<the id you were given>",
  "work_identified": "<the work, disambiguated from parent/sibling/edition>",
  "verdict": "first_no_prior | first_from_source | first_complete | first_modern | not_first | not_applicable | unverifiable | needs_review",
  "prior_relationship": "same_text | same_work_diff_edition | different_source_language | related_distinct_work | partial | adaptation | null",
  "our_completeness": "complete | partial | unknown",
  "evidence_strength": "strong | moderate | weak",
  "match_key": "work_id | author_title | transliteration | none",
  "confidence": "high | medium | low",
  "prior_translations_found": [
    {"english_title":"...","translator":"...","pub_year":"1976","publisher":"...","completeness":"complete|partial|excerpt|unknown","source_url":"<resolvable URL the claim rests on>"}
  ],
  "queries_run": ["every search you ran, verbatim"],
  "sources_consulted": [{"url":"...","found":"<one line: what it showed>"}],
  "reasoning": "<= 400 chars: why this verdict, citing the prior or the bounded absence"
}
```

**Hard rules.** `prior_translations_found` is `[]` unless a prior English exists.
Every entry MUST carry a real translator + year you actually found — **never a
placeholder, never a guess**; a fabricated entry is the single worst failure mode
in this process (8 caught across earlier rounds, signature = recent date +
hyper-specific title). `evidence_strength`: `strong` only if a prior was
positively found OR absence was confirmed in competent tradition-appropriate
sources; `moderate` for a well-searched bounded absence; `weak` if competent
sources could not be searched. A blind Western-catalogue miss on a non-Western
text is `weak`, never proof of a first.

---

## MANDATORY: report your search capability

Before anything else, state in `reasoning` whether `WebSearch` actually worked
for you. If WebSearch is unavailable (session budget exhausted, tool blocked),
you **may not** return any first-family verdict (`first_no_prior`,
`first_from_source`, `first_complete`, `first_modern`). Return `unverifiable`
with `evidence_strength: weak` and say why.

Rationale: WebFetch alone cannot *discover* a prior — it can only confirm one
whose URL you already know, and the major catalogues (WorldCat, HathiTrust)
refuse direct fetches. An absence produced without search is unbounded, and it
is indistinguishable on the page from a well-bounded one. That is the single
most dangerous output this process can produce.
