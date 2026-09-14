# Archived 2026-09: stale Gemini scripts that wrote no usage row

Every script here called Gemini, wrote **no row to any of the three usage stores**,
and was listed in `scripts/audit/gemini-usage-perimeter.baseline.txt` — the residue of
#4599, where 117,090 of August's 417,936 successful `GenerateContent` calls could be
attributed to nothing.

Classified 2026-09-14 rather than blanket-fixed. These are the ones that are **dead**:

- last commit more than 120 days ago;
- **zero references by name or path** anywhere tracked — `src/`, `scripts/`,
  `.github/`, `package.json`, `.claude/docs`, `memory/` — with the two baseline files
  that list every one of them excluded;
- not in `scripts/workers/crontab.production`, not in the **live** Hetzner crontab
  (read with `crontab -l` the same day), not in any workflow.

None set a thinking budget. Fixing their metering would have meant editing code that
nothing runs; archiving them shrinks the perimeter baseline instead, and the guard
walks past `_archived/` by design.

This is a **move, not a delete**. Restore one with `git mv` back to its old path, and
before running it, route its Gemini call through a usage logger — the perimeter check
will fail the PR otherwise.

The stale scripts that DO still have a reference were left in place and stay
baselined; a mention is not proof of use, but it is a reason to ask first.

| Script | Last commit | Header |
|---|---|---|
| `experiments/generate-alignment-data.mjs` |  | Generate word alignment data for the interactive demo. |
| `experiments/generate-sentence-alignment.mjs` |  | Generate sentence-level alignment between Latin source and English translation. |
| `tmp-test-librarian.mjs` |  | Quick test of the agentic librarian — runs the tool-calling loop directly. |
| `test-chapter-extraction-v2.mjs` |  | Test improved chapter extraction on known broken books. |
| `enrichment/gemini-domain-tagger.mjs` |  | Phase 2: Gemini-powered domain tagger for books not covered by category mapping. |
| `enrichment/migrate-facet-domains.mjs` |  | Migrate faceted_tags.knowledge_domain to revised cross-cultural vocabulary. |
| `backfill-rich-image-extraction.mjs` |  | Rich image extraction for high-scoring gallery images. |
| `enrichment/backfill-facets-phase2-gemini.mjs` |  | Facet Redesign Phase 2: Gemini-powered domain & tradition tagging. |
| `semantic-consistency/find-editions.mjs` |  | Find related editions using semantic embeddings. |
| `quality/reference-check.mjs` |  | Reference text quality check for OCR pages. |
| `one-off/test-translate.mjs` |  | Get one Da Vinci page with OCR but no translation |
| `one-off/verify-kloss-unscanned.mjs` |  | Run unscanned verification on Kloss catalog records. |
| `analysis/label-clusters.mjs` |  | Use Gemini to relabel clusters with better names and assign tradition tags. |
| `enrichment/enrich-source-work-dates.mjs` |  | Enrich books with source work compositional timeline. |
| `enrichment/backfill-display-titles.mjs` |  | Backfill display_title (English title) for non-English books. |
| `enrichment/enrich-entities.mjs` |  | Entity Enrichment Script |
