---
stage: ocr
measure: [judged]
languages: [fr]
scripts: [Latn]
canons: []
n_books: 30
n_pages: 30
verdict: "PENDING — rule and frame committed before materializing and judging."
status: undecided
decision: "PENDING"
defect_rates: "scripts/eval/route-judge-6740/results/euro-manifest-sample-6871/defect-rates.json"
feeds: route
superseded_by: null
issue: [6871]
router_evidence: "none — score files in scripts/eval/route-judge-6740/results/euro-manifest-sample-6871/; router table not edited"
---
## 2026-11-07 · French print 1800-1929 in manifest-only books (e-rara, NB Norway, IA, BSB): does GPU draft > agy Flash-low carry over? (#6871)

Part of #6871.

PRIOR ART: `2026-11-07-euro-gpu-agy-cells-6871.md` (the same route and rule on French 1800-1929 books WITH page records,
mostly Internet Archive scans: 28/30 accepted with the #8296 parser fix, about 53% of drawn pages written). Its harness
`scripts/eval/route-judge-6740/jcb-1600-8049/run.mjs` is reused with a new `--study=euro-manifest-6871` (stages `draw`
→ `drawManifest`, and `probe`); every later stage (collect, read, written, packet, plant, score, apply, record) is
unchanged except that the packet carries the drawn image file for the judge (`image_file`, judge.mjs), because e-rara
refuses this box.

### Route under test
LightOnOCR-3-1B draft on gex45 (`euro-gpu-correct-7567/drive.sh LO`, util 0.6, the euro cells' recipe), then agy
`gemini-3.8-flash-low` correcting with the page image, one page a call (`cli-ocr.mjs read --gpu-draft --correct-prompt`,
template `agy-0601ef30e816f7a7`), on pool `/root/.agy-milo`. The written set is what
`cli-ocr.mjs apply --diff-guard=gpu-draft --print-only` would write. A bare GPU draft is never served. The parser fix
#8296 is on main: marker residue and refusals are counted.

### Rule (unchanged from #8049 and the euro cells; fixed here before judging)
At least 10 judged; wrong text ≤ 4%; P(acc ≥ 0.8) ≥ 0.9 under Beta(1+k, 1+n−k) over written pages; both wrong-page
controls rejected; planted errors (French planter) not both missed. One page per book, seeded (salt `m6871-frm19`).
A second draw, from books not yet sampled, only if the first comes close.

### Frame (`run.mjs draw --study=euro-manifest-6871`; dry run 2026-11-07 10:05Z)
- Book's first language French (`firstReadLanguage`), parsed `year` 1800-1929 (no year, no book; nothing after 1929, so
  no text in copyright).
- `pages_state.state` is `manifest_only`, and the book's only hold is `manifest-only-lazy-pages` (no other hold, no
  `pipeline_auto.held`). No earlier failed materialization (`pages_state.failed_at`).
- Not an unsplit spread (`needs_splitting` and not split), not a manuscript (`manuscriptReason`: 2 books out). After the
  image is fetched, a frame wider than 1.15× its height is refused as multi-leaf and the book stays manifest-only.
- One body page a book: a canvas between 5% and 95% of the manifest, seeded.
- Pages are allotted to libraries (`image_source.provider`) by their share of the frame's pages, largest remainder:

| library | books | pages | share | pages allotted of 30 |
|---|---:|---:|---:|---:|
| e-rara (`erara`) | 2,247 | 1,031,918 | 91.2% | 27 |
| NB Norway (`nb_norway`) | 164 | 57,690 | 5.1% | 2 |
| Internet Archive (`ia_language`) | 63 | 29,824 | 2.6% | 1 |
| BSB (`bsb`) | 71 | 12,164 | 1.1% | 0 (probed separately: 3 books, fetch only) |
| **frame** | **2,545** | **1,131,596** | | **30** |

- **Fetch before materializing.** For each book the harness fetches the manifest and the drawn page's image FIRST. A book
  whose manifest or image cannot be fetched, or whose page is multi-leaf, is counted for its library and left
  manifest-only. Only then is `materializePages(db, id, { trigger: 'eval-euro-manifest-6871', fetchManifest })` called,
  fed the manifest already fetched (so it makes no second GET). Each book's state is recorded before and after
  (`sample.json`: pages_state, pipeline status and hold, counters, visible, archive block, page-doc count).
- A host whose final fetch fails twice with the same error is dropped; its pages are drawn from the other libraries.
- **e-rara refuses this box** (clawdbot, HTTP 403 on manifests and images; known since 2026-10-25, which is why the
  archive lane table puts e-rara on l7a). Fetches it refuses are retried over ssh `curl` from gex45, which e-rara serves.
  Both the refusal and the relay are counted.

### What materializing does, read from the code (before anything is written)
`scripts/lib/lazy-pages.mjs` `materializePages()`:
- **Writes** one claim on the book (`pages_state.state` manifest_only → materializing, a lease, `pages_state.trigger`,
  `attempts`+1), then `insertMany` of one page doc per canvas (`buildPageDocs` through `makePageDoc`: deterministic
  `_id`/`id` = `pageIdFor(book, n)`, `photo` = `photo_original` = the canvas image URL, `thumbnail`, no `ocr`, no
  `translation`; pages the manifest ledger proves on R2 are born with `archived_photo`), then `finish()`:
  `pages_state.state: 'materialized'`, `materialized_at`, `pages_written`, `manifest_pages`, and
  `recountBook(reason 'materialize-pages')`, THE counter writer, which sets the counters from the page docs.
- **Does not change** `pipeline_auto` (status stays `held`, hold `manifest-only-lazy-pages` stays), `visible`/`hidden`
  (all 30 drawn books are hidden), `archive_metadata.blocked`, or `pages_count` (it is already the true count).
- **Does not download images.** It makes one manifest GET (20 s timeout, no rate limiter; zero here, since the manifest
  is passed in). Images are fetched only by an archiver.

**Who acts on a book because it now has page records** (writing to a store a job reads is actuation):
- **Text lanes: none.** Every OCR/translation lane selects by `pipeline_auto.status` or a named hold reason, and the hold
  stays: the orchestrator's phases (status), `cli-ocr-lane` (idle statuses, or the reasons `ocr-flash-cli-7075`, its
  GPU frame's `GPU_LANE_HOLDS`, Latin only), `cli-translate-lane`, `enrich-worker` (`NOT_HELD`), `translate-batch-worker`
  (enrolment by status), `reader-request-lane` (only books a reader asked for), `mineru-ocr-worker` (English only).
- **Archivers: the same ones as before.** The archive host lanes (`archive-lanes.json`, started by
  `archive-lanes-revive.sh`) already select these books while they are lazy and archive them from the manifest into the
  ledger: e-rara on l7a at 1 req/s, nb-norway on l7a at 1/s, ia-lazy on gex45. After materializing, the same lanes draw
  them through the page-doc path instead (same hosts, same rates and breakers). `archive-erara.mjs`, `archive-ocr.mjs`,
  `archive-iiif-local.mjs` and `archive-bulk.mjs` gate on `PAGES_MATERIALIZED_FILTER` and would now see them, but none
  is on the live crontab (checked on this box, 2026-11-07). `archive-acquired-cron.sh` on main runs queue mode (acquired-book
  queue rows only; it drew 0 books at 09:45Z). So materializing adds no lane; it does not need preventing for this sample.
  Archiving held books is by design (`HOLD_ONLY_ARCHIVE_BLOCK`, #5448 step 3): preservation is not text.
- **Counters and audits:** `recountBook` now; the sync worker's page-count pass and `recoverLazyPages` (only for a stale
  lease or a failed partial write); `stage-coverage` and `translation-state-audit` count the books in their
  materialized denominators from now on.
- **Reader:** the book page would have materialized them on first open anyway (`src/lib/lazy-pages.ts`); hidden books.

The 30 books carry `pages_state.trigger: 'eval-euro-manifest-6871'`, so they can be listed with
`db.books.find({ 'pages_state.trigger': 'eval-euro-manifest-6871' })`.

### Writes
Each judge-accepted page is written as a first read through `cli-ocr.mjs apply --diff-guard=gpu-draft` (pipeline
`gpu-agy-first-read-euro-manifest-6871`, provenance and a revision a page, only on pages with no text). Holds stay.
Rejected and unwritten pages stay unread. Page verdicts go to `recordPageVerdicts()` under method
`euro-gpu-agy-cell-6871`.

### Results
PENDING.
