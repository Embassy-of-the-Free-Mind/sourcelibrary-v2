---
stage: metadata
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 7626
n_pages: null
verdict: "Single-book author strings (#7660 had linked only strings on two or more books): 9,827 live strings classified, 5,607 author docs minted, 6,902 books linked; 79 institution docs linked to 192 more books; 1,039 multi-person strings judged by Sonnet, 445 resolved to one existing author, 532 books linked. Live books with no author_id: 17,807 -> 11,168."
status: adopted
decision: "Applied 2026-10-30. Each lane has its own provenance run (additive-mint-7761-live-singletons on the docs, link-7761-institutions and link-7761-compound on books, plus sweep_log rows) except the 6,902 person links, which carry the backfill script's generic run backfill-2250-backlog."
superseded_by: null
issue: [7761, 7660]
router_evidence: "none — a catalogue-identity measurement, no OCR or translation route"
---
## 2026-10-30 · Author links for strings #7660 left out (#7761)
<!-- PRIOR ART: #7660's pipeline (PR #7682: classify-author-strings, additive-mint-authors-3780, backfill-author-canonical-links), run on the live single-book slice it skipped. -->

**Why.** A book with no `author_id` cannot be grouped with its other editions: the nightly local work-id mint keys works by author. #7660 linked 150K books but only author strings carried by two or more books.

**Persons.** 9,827 live strings, minus those on BSB/SBB books (#7660's GND harvest owns them), classified by `gemini-3.8-flash-low` on the agy subscription (55 calls, reads kept). 30 random person verdicts: 30 right. All 112 institutions read: 18 printers, publishers or holders held back. Minted 5,607 docs, appended 241 variants, linked 6,902 books. Three wrong links through one-word Wikidata aliases (Zeno, Lampert, Albericus) were unlinked and the aliases moved to `aliases_refused`.

**Institutions.** 166 minted docs had no books: the backfill links persons only. 80 were institutions. One, Royal College of Surgeons of England, is a holder (609 unrelated dissertations and pamphlets) and was not linked; the doc remains, with no books. The other 79 were linked to 192 books (89 live).

**Multi-person strings.** 1,039 strings such as "Josephus; trans. Thackeray" (BSB/SBB excluded). Sonnet (subscription CLI) named the author as written and in standard form, or "none" for printers, editors and translators only: none 182. Matched to existing docs only, exactly one doc required, one-word names refused when matched only through an alias: 445 matched, 376 no doc, 34 ambiguous, 2 refused. All 63 one-word matches and 40 random others read: all the right person (three targets carry odd slugs such as `arataeus` for Aratus; the docs are right). Linked 532 books (513 live).

**Not established.** Whether this moves work grouping. `scripts/eval/work-recall/recheck.mjs` re-scores the 2026-10-29 frame against current work_ids. Baseline after the merges: 46/291 = 15.8%. It runs after the 2026-10-31 02:30 re-key and reports on #7761.

**Snag.** The first judge run failed 26/26 batches with "Invalid API key": under `node --env-file=.env.production.local` the child `claude -p` took the file's ANTHROPIC_API_KEY instead of the subscription. `scripts/lib/claude-cli-env.mjs` now strips it; the work-recall judges use it.
