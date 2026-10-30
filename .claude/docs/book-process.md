# How a book becomes readable (the process today)

PRIOR ART: `pipeline.md` (Mar 2026) and `pipeline-phases.md` describe the orchestrator era, when one scheduler drove every book through numbered phases on the paid Gemini API. `pipeline-architecture.md` (Aug 2026) describes the one door and the spend dial at the time the subscription lanes began. `pipeline-next-step.md` is a design for one standing driver that mostly has not been built. All four are now marked superseded and point here. This doc holds the INTENT only. Every number lives on the generated page.

**Read this when** you need to know how a book gets from import to readable today: which lane OCRs or translates it, what checks it passes, and what rules decide the order. Do not quote a count, a pool level or a schedule from here. Read them on **https://sourcelibrary.org/admin/pipeline/now**. That page is rebuilt from each box's live crontab, agy pools and lane state every hour, and from the page store every night (`scripts/maintenance/pipeline-now-push.mjs`, #7759).

Living doc. Owner: #7759.

## Who this serves

Readers come for a primary source they can read and quote. A book helps them only once its pages carry text (OCR) and, for most of the library, English (translation). Every rule below is about getting more books to that point, at subscription cost, without serving invented text.

## The stages

1. **Import.** A book enters hidden through the acquisition gate (`acquisitionGate()` / `insertBookIfNew()`, `invariants/edition-identity.md`). Page images are archived to R2 under book-scoped keys. Bulk imports run on Hetzner (`import-workflow.md`).
2. **Split.** A frame showing two leaves is split into one page per leaf before any OCR or translation (#6948).
3. **OCR.** Each page gets text from the lane its router cell names (see Routing). The kinds of lane:
   - **GPU** on gex45: PaddleOCR-VL (Chinese and other print) and LightOnOCR, through the GPU queue. `ocr-filler.sh` adds the next gated route whenever the queue is empty (#6871, #5660).
   - **agy Flash** (Gemini 3.8 Flash on the Google subscriptions): first reads for visible books with no OCR, and corrections of weaker reads (`cli-ocr-lane.mjs`, #7701, #7263).
   - **The Internet Archive's own OCR**: scored and accepted page by page (`ia-ocr-nightly.mjs`). English Archive imports are held at import (#5124).
   - **Specialist engines** for single scripts, for example Kraken for Syriac.
   - **The orchestrator line** on the paid Gemini API (Flash-Lite): `scheduler.mjs` runs every 2 min on main and spawns the orchestrator's phases (preview OCR, Batch OCR, archive OCR, `translate-worker`), all bounded by the spend dial. This was the whole pipeline until mid-2026 (`pipeline-phases.md`). It now carries a small share of the pages.
4. **Translate.** Pages whose language is not English get an English translation:
   - **agy Flash** carries the volume. It runs the Siku Quanshu Chinese lane (`siku-translate-lane.mjs`, #5600) and reader requests (`reader-request-lane.mjs`).
   - **Opus** on the Claude subscriptions, through `claude -p`, takes the hard scripts and languages (`cli-translate-lane.mjs`).
   - **The paid lanes** on Flash-Lite: `translate-worker` (spawned by the scheduler) and the chained Batch lane (`translate-batch-worker.mjs --chained`), both under the spend dial. The chained lane is the only one that runs the NO-GO brake, the OCR-trust gate and the pre-translation gate. Paid enrolment has been paused since the standing gate's NO-GO on 2026-10-10 (#5826).
5. **Enrich.** Summaries, chapters, the index and geocoding are derived from the text (`enrich-worker.mjs`). A bad read poisons these too (`invariants/derived-metadata-lane.md`).
6. **Readable.** `computeTranslationState` (`scripts/lib/page-counts.mjs`) sets `readable_in_english` and the stage from page COUNTS alone. No quality input feeds it yet.
7. **Per-book check (proposed, not running).** #7759 proposes judging three pages per book by rule, stamping a draft or checked label, and feeding each read to the estimator. It waits on Derek's yes.

## What checks a page passes today

- **At the write door, every lane:** `assessTranslationHealth` in `translate-core.mjs` (hidden meta, reasoning leak, collapse, runaway, recitation, stray script, echo, leaf drift) and the truncation guard in `write-text-guard.mjs`. A page that fails is not written.
- **By sample, per lane:** the Siku lane has Opus judge 10 pages for every 5,000 it writes. The check is skipped while the box's Claude account is at 90% or more of its week, and a sense-error FAIL does not stop the lane. The generic CLI lane had one adoption sample per language, when its route was chosen. The paid lane has its gates (above).
- **Corpus-wide:** the monthly translation audit (about 100 books, one page each; `scripts/eval/translation-corpus-audit/`) and the daily quality-dashboard trends.
- **On finding invented or wrong-leaf text by eye:** contain at once (`invariants/containment-on-finding.md`).

No lane checks each BOOK. That gap is the subject of #7759.

## Routing: which engine reads which page

The router table decides (`scripts/eval/estimator/router-table/rules.json`, #6740, #7263). Each cell (language × script type × source) carries a k/n acceptance count from blind judging, and the route with the best cost per usable page wins. A job brief that writes page text names its cell on a `Route:` line, and `claude-job.sh start` refuses a brief without one (`scripts/workers/JOB-HOSTS.md`). Rule of thumb from the table so far: GPU and agy Flash for print, Opus for manuscripts and hard scripts.

## Standing rules (Derek)

- **New books before re-translation** (#7755). Re-translate a page only when it is urgently bad.
- **Cost is counted at subscription price.** Fee × share of the plan's weekly quota used, per usable page. Plan fees are in the private ops repo, `costs/subscription/plan-fees.json`. They never go in this public repo.
- **Opus for hard scripts, Flash for the bulk.** Claude runs only through the subscriptions (`claude -p`), never the API. The only Gemini model allowed on the paid API is `gemini-3.1-flash-lite`. Every other Gemini model runs through `agy` on the subscriptions.
- **One page per leaf** before OCR or translation.
- **Keep and reuse every paid read.** A lane applies kept reads before it buys new ones (#7469).
- **A lane without provenance does not run.** Every writer records its source, engine and prompt (`ocr-lane-decision-tree.md`).

## Where quota comes from

- **agy:** two Google plans, each with one weekly pool and one 5-hour bucket shared by every Gemini model on that login. The second login is `AGY_HOME=/root/.agy-james` (JOB-HOSTS.md). The Siku lane stops a pool at 35% of its week left (5% in the last 24 h before reset). Concurrency is not the ceiling; the pool is.
- **Claude:** one account per box. Jobs refuse an account at 90% of its week (JOB-HOSTS.md, `climits status`).
- **Paid Gemini API:** the spend dial (`set-dial.mjs --show`), read only by the paid lanes.

The live levels of all three are on the generated page.

## Where the rest lives

| Question | Where |
|---|---|
| What runs right now, on which box, how many pages a day | https://sourcelibrary.org/admin/pipeline/now |
| What work is left, by step | https://sourcelibrary.org/admin/pipeline (`pipeline-next-step-audit.mjs`) |
| Which headless Claude jobs are running | https://sourcelibrary.org/admin/work |
| Choosing an OCR lane for a book | `ocr-lane-decision-tree.md` |
| Pipeline status fields and holds | `invariants/pipeline-status-truth.md` |
| Spend controls | `invariants/spend-controls.md` |
| Placing a job on a box | `scripts/workers/JOB-HOSTS.md` |
