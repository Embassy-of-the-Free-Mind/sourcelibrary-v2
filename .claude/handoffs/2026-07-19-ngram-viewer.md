# Ngram viewer: idea → shipped in one arc (2026-07-17 → 07-19)

**Live:** https://sourcelibrary.org/ngrams — Google-Books-style term-frequency
trends over the corpus, plus the two things Google can't do: a cross-language
`en` corpus (English translations of everything, one curve across Latin/German/
French/… sources) and peak-click-through to the actual readable pages.

## What shipped (all merged + deployed)
- **#3177** — the feature: batch counter (`scripts/analytics/build-ngrams.mjs`,
  disk-backed map-reduce, zero AI cost), Supabase `ngram_series`/`ngram_totals`,
  `/api/ngrams`, `/ngrams` UI, explore-hub card. Normalizer + wrapper-stripper
  live as parity-pinned `.mjs`/`.ts` twins (`tests/unit/ngram-normalize.test.ts`).
- **#3195** — ReDoS fix: `stripMarkdownMarkers`' unbounded lazy interiors went
  quadratic on ~50K-word junk pages (2h CPU spin, caught via `kill -USR1` +
  CDP pause on the live process). Interiors now bounded (300 chars, single-line)
  in BOTH stripper twins; also request-path hardening for reader/quote routes.
- **#3203** — cross-language overlays (`mercurius:la` syntax + curated lexicon
  chips in `src/lib/ngram-lexicon.ts`), 1930 default range, and
  `text_role:'modern-translation'` excluded from the build (620 books whose
  year = the modern translation's publication date).
- **#3206** — `Number(null)`=0 collapsed absent API params to year 800; loader
  now writes totals FIRST (writing them last left the API 404ing for the whole
  multi-hour `--truncate` reload).
- **#3208** — supabase-js's silent 1,000-row cap truncated the multi-corpus
  totals query ALPHABETICALLY (Latin vanished while `found=true`). One totals
  query per corpus now. **CLAUDE.md gained an invariant for this.**
- **#3213** — per-year book counts in tooltip + backdrop caption.

## Data state
Final build (v2): **52.2M series rows / 17,819 books / ~3.4B tokens**, 12
corpora, thresholds min-total 10 + min-books 2. Built on Hetzner
(`/root/ngram-build/`, scripts staged with node_modules symlink), ~12h
end-to-end, self-purging via chained watcher scripts. **The 42GB of gzipped
shards in `/root/ngram-build/data` are deliberately kept** — they're the input
for the doc-frequency mode (#3217), which is a load-phase-only change.
Supabase DB is now ~103GB total (ngram_series ~13GB of it) ≈ $12/mo disk
overage, dominated by embeddings, not ngrams.

## Open follow-ups (issues carry full designs)
- **#3214** USTC coverage panel — use `ustc_editions.in_source_library`
  (catalog-coverage columns) for true matched %-of-USTC per year.
- **#3217** doc-frequency mode (% of books mentioning a term) — load-phase only.
- **#3215** semantic concept trends over page embeddings — prototype first.
- Tibetan/Chinese/Sanskrit corpora need segmentation (noted in #3175).

## Operational lessons (also in auto-memory)
- `SUPABASE_DB_URL` exists only on Hetzner's env file, not locally.
- ExitWorktree kills this session's background monitors/tasks — re-arm
  watchers from the main dir after leaving a worktree.
- After a squash-merge, ExitWorktree warns about "unmerged commits" — verify
  with `git diff HEAD origin/main` (content), then discard.
- GitHub `pull_request`-event CI silently stalled for hours on 07-18 (push
  events fine); gated merges on the full local suite + post-merge main CI.
- Diagnosing a wedged Node process: `kill -USR1 <pid>` → CDP pause names the
  exact function; log-silent + ~100% CPU + flat RSS = synchronous spin.
