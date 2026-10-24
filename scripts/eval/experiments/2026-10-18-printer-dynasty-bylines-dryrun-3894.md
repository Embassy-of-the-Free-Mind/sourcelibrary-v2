---
stage: metadata
measure: judged
languages: [la, it, grc]
scripts: [Latn, Grek]
canons: []
n_books: 383
n_pages: null
verdict: "Of 383 printer-dynasty books with an OCR front-matter window, a claude -p reader plus screens plus an Opus refuter proposes 116 byline corrections; 20 of 20 sampled proposals match the title-page image."
status: undecided
decision: null
superseded_by: null
issue: [3894]
---
PRIOR ART: PR #4021 (`apply-aldine-byline-correction-3894.mjs`, in-session subagent reader + refuter over the 67 visible Aldine-imprint books) and PR #3982 (the title-page benchmark). This entry is the same reader → screens → refuter flow as a script, over the rest of the printer-dynasty scope.

## 2026-10-18 · Can the reader/refuter flow propose bylines across the remaining printer-dynasty books? (#3894)

**Design.** Scope: every book whose `books.author` matches the PRINTER_DYNASTY pattern of `title-page-attribution.mjs`, plus two #4392 records: 698 books. 137 skipped as self-named by the title string, 200 have no OCR front-matter window, so 383 were read. Reader: `claude -p` Sonnet, 8 books per call, v4 role grammar, over up to 6 typed front-matter pages (p1–24). Screens: quote on the cited page, not the catalogued person, no role conflict, single-author book, confidence. Wikidata: human, date-gated; `author_id` only via a thesaurus doc carrying that QID. Refuter: `claude -p` Opus, told to default to refuted.

**Result.** 120 self-named (the catalogued person wrote it), 55 no author on the pages, 54 composite volumes, 16 held by screens plus 1 human hold, 21 refuted of 138 sent (15%), **116 READY**: 91 printer, 21 editor, 3 publisher, 1 translator. 87 of the 116 link to an existing author doc by QID, and 8 add a translator. By eye, 20 READY rows checked against the cited page image: 20 correct (95% CI lower bound 83%). One Wikidata search hit was the wrong person (Longinus → the soldier-saint); because no thesaurus doc carries that QID, it would not write an `author_id`.

**Refuter kills** were mostly compilers (Núñez, Lipomano, Possevino), editors (Welser), commentary volumes (Tibullus with Statius), composites (Aristotle with Alexander's *Problemata*, Gregory of Nyssa with Gregory Thaumaturgus), and the wrong Aldo (the 1576 signer is Aldo the Younger).

*Replicated?* No. The 20-row check is a precision sample over READY only; recall over the 109 NO_NAME and composite rows was not measured.

**Artifact.** `scripts/eval/results/byline-proposals-3894.json`, `scripts/eval/byline-proposals-3894.mjs`, apply with `scripts/maintenance/apply-byline-proposals-3894.mjs` (dry run by default). Nothing written to Mongo.
