# Visitations register, Swedenborg translation, hand-fed shelf — 2026-08-29

## What happened

**1. "A Register of Visitations" artifact** (claude.ai/code/artifact/e6b9e0e9-461a-4e2d-8956-731726cec53e).
Cross-cultural survey of first-person encounter records with non-human beings, ten
traditions: Soushen Ji, Zhen'gao, Dee's Enochian diaries, Jane Lead, Hauber, Horst,
Callaway (Zulu), Evans-Wentz, Westermarck (jinn), Swedenborg. All quotes verbatim via
`/quote` with `/q/` shortlinks. Possible follow-on: a real collection page via
propose_collection (not started).

**2. Swedenborg Vom Himmel (1776 German, book 69b51ee19a81ef7feb3dc2cb) fully processed.**
592/592 OCR (497 via `bulk-reocr-local.mjs` batches ~$0.39; 78 pre-existing Mar/Apr; 17
from a briefly-alive Lambda job), 591/592 translated via `queue-translations.mjs` (job
HfgH18tnYxgB). The one untranslated page is a blank BSB ownership-stamp leaf — correct,
not a gap. Book counters verified (pages_ocr 592 / pages_translated 591).

**3. Instrument lesson (the day's main scar).** The public `GET /api/books/[id]` no
longer serves `pages[].ocr.data`/`translation.data` to anonymous callers (#4306 side
effect). Every jq status recipe in the batch-translate skill therefore counts 0 on a
fully-processed book → false "stalled at 0/592" alarm → I cancelled a working Lambda
job. Fixes shipped: **PR #4345 (merged)** adds a corrections header to the skill
(authed queue-books contract, Mongo-truth progress counts, positive-control rule,
paused-line script paths, blank-page N−1 tell); auto-memory
`lesson_public_book_api_strips_page_text` written.

**4. "The Hand-Fed Shelf" artifact** (claude.ai/code/artifact/c37c63ca-345a-4ba8-ad40-f8f08374c99c).
Derek asked for a list of manually-processed books. Reconstructed from
`db.jobs.initiated_by`: 715 books, 19 episodes. Reasons recovered in two passes:
conversation-search index (SHWEP Aug wave, BnF Enfer erotica wave, Slime Moulds
collection) + **direct grep of `~/.claude-archive/live/projects`** — Derek corrected my
false "retention gap" claim; Feb–May 2026 transcripts survive there, the search MCP
just doesn't index the archive. Archive grep recovered: June canon sweep = SHWEP-cited
works DB, May yoga runs = Yoga collection, March Albigensians = Medieval Heresies
collection. Seven episodes now "recorded"; Feb trio, April Columbus + 74-book push,
Maya kickoff remain "inferred". **Issue #4336** filed: `--reason` flag →
`jobs.initiated_reason` so the ledger becomes self-writing.

## State
- No uncommitted work from this session; worktree reaped after #4345 merged.
- Untracked files in main checkout predate this session (other windows').
- Monitors/background tasks: all ended.
- MEMORY.md updated: archive-grep pointer on the retention entry; new API-strips lesson.

## Next
- Optional: "Encounters/Visitations" collection page from the register's books.
- #4336 awaits implementation (small: queue scripts + admin UI + book-history surface).
- Swedenborg could use a QA pass (Fraktur OCR quality unverified beyond spot-checks).
