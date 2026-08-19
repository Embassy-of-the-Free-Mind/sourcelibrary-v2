# How to translate a book (collaborator runbook)

You want a book OCR'd and translated. This is the short, reliable path — written
so anyone (not just whoever set up the pipeline) can do it without re-discovering
the gotchas. If you only read one thing: **don't try to "unpause the pipeline" —
run a one-off batch job for your single book instead.**

## First, know two things

1. **The production OCR/translation pipeline is deliberately PAUSED** to control
   Gemini spend (`system_config.processing_control.paused: true`, off since
   2026-06-08). Archiving still runs, so books pile up at `archive_complete` and
   it *looks* like an outage — it isn't. Do **not** flip the global pause to get
   one book done. Selectively unpausing a single book has a known bug that
   strands it at `archive_complete` (it raises module-level phase limits but not
   the phase-local split/dedup limits), and the pause flag is shared production
   state that other sessions depend on.

2. **You need credentials.** The endpoints below require either an editor login
   or `Authorization: Bearer $CRON_SECRET`, and the helper scripts read
   `.env.production.local` (Vercel-managed, gitignored). If you don't have that
   file, that is your actual blocker — ask Derek for access before anything else.
   Source it with semicolons, never `&&` (which silently fails in zsh):
   `set -a; source .env.production.local; set +a`

## The fork: is the book already in the library?

- **Already imported (most common).** It has a `sourcelibrary.org/book/<slug>`
  page but no/partial translation. Skip to "Translate one book" below.
- **Not in the library yet.** Import it first (use `/curator` or
  `/library-curator`, follow `.claude/docs/import-workflow.md` — enumerate →
  dedupe → import hidden → process → QA → visible). Then translate it.

Don't guess which case you're in — check the book's state first (next section).

## Translate one book

The cleanest path bypasses the paused cron entirely and runs a single Gemini
**Batch** job for just your book (~50% cheaper, results in ~24h).

### Option A — let Claude do it
Tell Claude: **"Translate book `<id, slug, or sourcelibrary.org/book/... URL>`
using the batch-translate path. It's in the library but untranslated. Don't
unpause the production pipeline."** Or invoke the skill directly: `/batch-translate <book>`.

### Option B — the endpoints (what the skill wraps)

1. **Check the book's state** — what actually needs doing:
   `curl -s "https://sourcelibrary.org/api/books/<BOOK_ID>"` then count pages with
   empty `ocr.data` / `translation.data` (see the `/batch-translate` skill for the
   exact `jq`). A book can need cropping → OCR → translation, in that order.

2. **OCR (if needed):**
   `POST /api/books/<BOOK_ID>/batch-ocr-async`

3. **Translate:**
   `POST /api/books/<BOOK_ID>/batch-translate-async`

Both take `Authorization: Bearer $CRON_SECRET`. Both return a Gemini Batch job
that completes in ~24h — they do not block.

**Quality tradeoff to know:** this batch route translates each page
*independently* — no previous-page continuity, unlike the (currently dormant)
sequential worker, which feeds each finished page into the next page's prompt.
For a single requested book that tradeoff is deliberate and fine; for bulk
reprocessing, or a text where cross-page flow matters a lot, use the
sequential path instead (see `memory/pipeline-ops.md`, Critical Rules).

### Model
Don't hardcode a model. The pipeline uses `getModelForBook(book)`
(`src/lib/types/ai-models.ts`), which routes BPH and non-Latin-script books to the
full model and everything else to the cheaper lite model. Never use Gemini below
v3, and note the bare GA names (no `-preview` suffix, which now 404s).

## Cost

Measured from `gemini_usage` over 1,752 books with both OCR and translation
logged (lite model + Batch discount, mostly): **median ≈ $0.58/book, mean ≈
$0.94** (the mean is pulled up by large folios). Roughly: p25–p75 is
$0.26–$1.05, so a typical book is **well under a dollar**. The tail is the
catch — multi-hundred-page folios run **several dollars up to ~$30** (a
~1,200-page book measured at $28.94). The full model (BPH / non-Latin) and the
realtime Lambda path (no Batch discount) both cost ~2× these.

So one ordinary book is cheap, but it is **not** "cents," and a big folio is
real money. The pipeline is paused on purpose, so **for anything beyond one or
two ordinary books — or any large folio — ask Derek before kicking off a
batch.** Bulk Gemini spend is the reason it's paused.

Per-page pricing lives in `src/lib/gemini-logger.ts` (`MODEL_PRICING`); to check
a specific book's actual logged cost, sum `cost_usd` in `gemini_usage` filtered
by its `book_id`.

## Where the rest of the knowledge lives

- `/batch-translate` skill (`.claude/skills/batch-translate/`) — the full
  crop → OCR → translate workflow with exact commands.
- `memory/pipeline-ops.md` (or the `/pipeline-context` skill) — pipeline, cron,
  Lambda, OCR/translation internals.
- `.claude/docs/import-workflow.md` — acquiring a book that isn't in the library.
- The top-level `CLAUDE.md` — project invariants (visibility, quote integrity,
  tenant lockdown, deploy rules).

## Why this doc exists

Much of the operational know-how for this project lived only in one person's
private Claude memory (gitignored, per-machine). This runbook promotes the
"how do I translate a book right now" piece into the shared repo so any
collaborator's Claude can answer it. When you learn a non-obvious operational
lesson, use `/lesson` to write it into repo `memory/` (shared), not just your
local notes.
