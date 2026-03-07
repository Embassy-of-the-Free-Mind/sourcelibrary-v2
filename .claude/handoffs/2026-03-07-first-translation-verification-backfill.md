# First-Translation Verification Backfill (Mar 7, 2026)

## What Happened

Ran the new catalog-backed verification pipeline (`scripts/enrichment/cleanup-first-translation-claims.mjs`) across the entire non-English library using Gemini function calling with real tool calls to:
- MongoDB `translation_catalogs` collection (~12k records from UNESCO, Loeb, Brill, Penguin, etc.)
- Open Library API
- Google Books API
- USTC (Supabase)

The model searches these catalogs, evaluates results semantically (not regex), then makes a determination with cited evidence and URLs.

## Runs

### Run 1: Re-verify flagged books (COMPLETE)
- **994 books** already marked `is_first_translation: true`
- Log: `root@46.224.122.120:/root/ft-cleanup.log`
- Results: 896 confirmed first, 54 first_full, 37 translation_exists (misclassified), 7 errors

### Run 2: All non-English books (IN PROGRESS on Hetzner)
- **3,823 books** — everything without new-style verification (`tools_called` field)
- Command: `nohup npx tsx scripts/enrichment/cleanup-first-translation-claims.mjs --all --apply > /root/ft-cleanup-all.log 2>&1 &`
- Log: `root@46.224.122.120:/root/ft-cleanup-all.log`
- At 1,285/3,823 (34%): 654 first_translation, 107 first_full, 480 translation_exists, **442 NEW discoveries**, 43 errors
- ETA: ~10 more hours from 2026-03-07 evening
- Rate: ~4 books/minute, ~$0.0002/book

## When It Finishes

Check results:
```bash
ssh root@46.224.122.120 'tail -40 /root/ft-cleanup-all.log'
```

Projected final numbers: ~2,000+ verified first translations (up from ~1,000 flagged).

## Key Files

| File | Purpose |
|------|---------|
| `scripts/enrichment/cleanup-first-translation-claims.mjs` | Backfill script (--all, --apply, --book-id flags) |
| `src/lib/verify-first-translation.ts` | Core verification function (Gemini function calling, 5 tools) |
| `scripts/enrichment/import-translation-catalogs.mjs` | Imports CSV catalogs into MongoDB |

## Commits (this session + previous)

- `f14d3806` Fix template literal syntax error in cleanup script
- `c968d4fb` Add --all flag to verify all non-English books
- Earlier commits: core verify-first-translation.ts, import-translation-catalogs.mjs, pipeline integration (Phase 3.7)

## Errors

43 errors so far, all "Model did not call make_determination" — the nudge mechanism (injected after 3 rounds) doesn't always work. These books can be re-run individually with `--book-id=ID`.

## After Completion

1. Update site's first-translation count (currently "500+" — will be ~2,000+)
2. Review error books: `grep "ERROR" /root/ft-cleanup-all.log`
3. The verification data is on each book doc at `book.translation_verification` with full evidence chain (tools_called, translations_found with URLs, reasoning)
4. Pipeline integration (Phase 3.7) is deployed — new books get verified automatically during post-import-pipeline cron
