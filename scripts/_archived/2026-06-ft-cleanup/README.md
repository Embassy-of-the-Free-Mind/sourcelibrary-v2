# Archived first-translation one-offs (2026-06, #2332 Task 1)

Dated migrations/backfills and superseded verifiers that already ran and have
**zero live code references** (verified by grep across `scripts/` + `src/` — the
only remaining mentions were comments/docstrings/system-map example text) and
are **not** in the live Hetzner crontab. Moved here rather than deleted so the
history and logic stay recoverable.

Kept live (NOT archived): `maintenance/reconcile-ft-from-catalog.mjs` — the
documented disposition→flag bridge (run manually, not cronned). See
`.claude/docs/first-translation-system.md` §5/§11.

| Script | Was | Why dead |
|---|---|---|
| `backfill-first-translation.mjs` | early flag backfill (Feb 2026) | superseded by the catalog-search pipeline + reconcile bridge |
| `bulk-flag-tibetan-ft.mjs` | one-shot Tibetan FT flagging | ran; Tibetan now handled in the normal disposition flow |
| `tag-kanjur-not-ft.mjs` | one-shot Kanjur NOT-first tagging | ran; reflected as `source: canonical_kanjur` dispositions |
| `bulk-flip-vague-claims-to-confirmed-first.mjs` | 2026-05-30 one-shot needs_review cleanup | ran; idempotent + reversible (wrote `bulk_flip_2026_05_30` marker) |
| `clean-ft-harvest-schema-errors.mjs` | 2026-05-30 one-shot `translation_catalogs` purge | ran; input guards now live in the harvester |
| `migration/backfill-bph-first-translation.mjs` | one-shot BPH FT backfill | recurring logic now in `src/app/api/cron/sync-bph-sl-book-ids/route.ts` |
| `migration/backfill-ft-verify-bph.ts` | one-shot BPH verify backfill | ran |
| `enrichment/verify-first-translations.mjs` | predecessor verifier | replaced by `search-translation-evidence.mjs` + the 8-tool agent |
| `analysis/validate-translation-claims.mjs` | predecessor validator | replaced by `validate-translation-evidence.mjs` |
