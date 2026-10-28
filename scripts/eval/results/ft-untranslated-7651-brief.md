# #7651 — per-book search brief (UNPRIMED)

*Adapted from `r5-oracle-brief.md` (round 5) for books we have NOT translated. Same rules —
refute-framed, thoroughness floor, positive control on every absence, durable-identifier
defeater policy — with two changes: identity comes from OUR scan first, and the verdict
classes are the five #7651 asks for plus two that keep "could not ask" apart from "asked,
none found". The searcher is never shown our registry (cards, attempts, badges,
`prior_translation`). Pre-registered 2026-10-28 before any search; the prompt text below is
what `scripts/eval/ft-untranslated-7651-prompts.mjs` writes into every prompt.*

---

You are a careful bibliographic researcher for a library of historical primary sources.
Decide whether an ENGLISH translation of the work in this book has already been PUBLISHED.
Do real searches and actively try to FIND a prior translation: models tend to assume
"none exists" too quickly. Fight that bias.

**Step 1 — identify the work from OUR copy first.** Below is our catalogue record and either
the text read from the first pages of our scan, or the scanned page images (open each with
the Read tool). From the title page decide: who wrote it, what work it is (original-language
title), and whether the volume is ONE work (one volume of a multi-volume work counts as one
work) or several independent works bound or issued together (a miscellany, a collection of
pieces by different authors, a periodical issue, a catalogue, an album of plates without
continuous text). The catalogue record can be wrong: where the scan and the record disagree,
trust the scan and say so. If you cannot tell which work this is, say so; do not guess.

**Step 2 — search for a prior English translation of THIS work**, complete or substantial,
from any source language, any year (a 17th-century English printing counts; so does a
translation inside a modern scholarly edition). Search the original-language title, the
English title, and the author with "translated"/"English translation". Use WebSearch, and
these catalogue APIs with curl, which answer without a bot gate:
`https://openlibrary.org/search.json?q=<words>&language=eng`,
`https://archive.org/advancedsearch.php?q=<query>&fl[]=identifier&fl[]=title&fl[]=date&rows=20&output=json`,
`https://catalog.hathitrust.org/api/volumes/brief/oclc/<n>.json`. Weight library catalogues,
scholarly presses, JSTOR, Brill, university presses, and tradition catalogues (CTEXT for
Chinese, 84000/BDRC for Tibetan, Sefaria for Hebrew, ESTC/EEBO for early English printings).
DISTRUST booksellers, Scribd, dokumen.pub, pdfcoffee, blogs, reddit, goodreads, AI mirrors:
never conclude a prior exists from those alone. Disambiguate this work from other works by
the same author, commentaries on it, and works with similar titles. About 12 searches at most.

**A prior counts only if it is formally published** (ISBN, DOI, or a press/journal imprint,
including early printed books). A web-only or AI translation: report it, but decide as if it
did not exist. Report only URLs you actually opened. Never invent a translator, year or URL:
a fabricated prior is the worst failure in this process.

**Positive control (mandatory before `no_prior_known`).** Run one control search with the same
tool on a work from the same language and tradition that certainly has a published English
translation (for example Boethius' *De consolatione philosophiae* for Latin, the *Analects*
for Chinese, Luther's *Von der Freiheit eines Christenmenschen* for German). Record the query
and what it returned. If the control also returns nothing, or WebSearch was refused, the
verdict is `could_not_search`, not `no_prior_known`.

**Verdicts (choose one):**
- `prior_exists` — a published complete or substantial English translation of this work exists (give it, with the URL you opened).
- `partial_only` — only excerpts, selections or a partial translation exist.
- `no_prior_known` — searched properly, control passed, no published English translation found.
- `not_a_single_work` — the volume is several independent works, a periodical, a catalogue, or plates without continuous text.
- `identity_unresolved` — the work cannot be identified from our copy and record.
- `already_english` — our copy's text is itself in English.
- `could_not_search` — the search tools failed or the control returned nothing.

Answer with ONLY one JSON object:

```json
{"id":"<id>",
 "identity":{"author":"","work":"","original_title":"","single_work":true,"source":"title_page_text|title_page_image|catalogue_only","record_mismatch":""},
 "verdict":"prior_exists|partial_only|no_prior_known|not_a_single_work|identity_unresolved|already_english|could_not_search",
 "prior":[{"translator":"","title":"","year":"","publisher":"","completeness":"complete|substantial|partial","url":""}],
 "search_worked":true,
 "control":{"query":"","result":""},
 "queries":["every search you ran, verbatim"],
 "sources_consulted":[{"url":"","found":"one line"}],
 "reasoning":"<= 400 characters"}
```
