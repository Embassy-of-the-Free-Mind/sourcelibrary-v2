---
stage: ocr
measure: [judged]
languages: [fr]
scripts: [Latn]
canons: []
n_books: 30
n_pages: 30
verdict: "PASS — 25/26 written pages accepted, 0 wrong text, P(acc>=0.8)=0.981; 26/30 drawn pages written (87%)"
status: undecided
decision: "The route carries over to manifest-only French 1800-1929 books (e-rara, NB, IA). At scale agy quota, not fetch, GPU or storage, is the limit: 1.13M calls is 43-343 weeks of pools."
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

### Results (2026-11-07)

| | drawn | materialized | written | accepted | wrong text | P(acc ≥ 0.8) | decision |
|---|---:|---:|---:|---:|---:|---:|---|
| e-rara | 27 | 27 | 23 | 22 | 0 | | |
| NB Norway | 2 | 2 | 2 | 2 | 0 | | |
| Internet Archive | 1 | 1 | 1 | 1 | 0 | | |
| BSB | 0 (probe 3) | 0 | – | – | – | | |
| **cell** | **30** | **30** | **26** | **25** | **0 (0%)** | **0.981** | **PASS** |

Controls: wrong-page 2/2 rejected; planted errors 2/2 caught. No second draw (not close).
`defect-rates.mjs`: 6,811 words judged, misleads 0.15 per 1K words, wrong text 0, fidelity 4.88/5.

- **The one reject:** e-rara `6adefaadbf12d2ef2055b2d2` p145, O7 misleads: a printed `20⅓` read as `20½`. Cosmetic
  notes on accepted pages: italics dropped (3), `réglement` modernised to `règlement`, `!!!` spacing, alignment markup,
  a catchword note.
- **Why 4 pages went unwritten:** 3 refused by the diff guard (put-back not like-for-like with the GPU draft), 1 for
  letters outside the book's scripts. No refusals from agy (30/30 calls ok, 0 re-reads), marker residue 0
  (#8296 holds), and **0 handwritten tags** (the IA French cell lost 29 of 59 unwritten pages to those).
- **Fetches.** e-rara refused every direct GET from this box (27/27 HTTP 403) and served all 27 through the gex45
  relay (direct from gex45 ~0.4-0.9 s an image). NB direct OK. IA: in the dry run one image (book
  `6adec99ca765b2fd7a0ab8e0`) gave 504 twice (direct and relay) and the next book was drawn; in the real run the same
  book fetched (transient, so IA was not dropped). BSB: 3/3 probe books gave manifest and image direct (0.2-0.8 s); the
  sync worker's 12/12 `digitale-sammlungen` failures did not reproduce here. **No host was dropped.** The dry run's IA
  pick (a page of `6adeddd4bf12d2ef2054564a`) was a dry-run pick only and was NOT materialized.
- **State after.** 30 books, 8,552 page docs, `pages_state.state: materialized`, all still hidden,
  `pipeline_auto.status: held`, hold `manifest-only-lazy-pages` unchanged (re-checked after the writes). One NB book
  was born archived (245 pages from the ledger). Writes: 25 pages (run `cli-ocr-20261107102347-260198`, pipeline
  `gpu-agy-first-read-euro-manifest-6871`, 25 `page_revisions`); `recordPageVerdicts` 26 rows under
  `euro-gpu-agy-cell-6871`.
- **Cost:** $0. agy pool `/root/.agy-milo`: 30 calls, weekly 91.15% → 90.81% left, 5-hour 84.7% → 82.3% (pool shared
  with the gex45 Latin cron, so per call ≤ 0.011% weekly). GPU: 30 drafts, 0 errors, 26.7 s read (4,045 pages/h),
  peak 15 GB.

### Compared with the Internet Archive French cell (books with page records)
Same route and rule: 28/30 accepted there with #8296, about 53% of drawn pages written (32/60), 29 of the 59 unwritten
lost to handwritten tags. Here 25/26 accepted and **87% written** (26/30). The e-rara scans (full-size IIIF, ~763 KB
an image) read at least as well as the IA scans; the write rate is higher because the handwritten-tag refusal did not
fire once. n = 30, so the write rate's interval is wide (roughly 70-95%).

### What reading manifest-only French 1800+ at scale would take (measured numbers)
Frame: 2,545 books, 1,131,596 pages (e-rara 91%).
- **Page docs:** a lazy page doc is 414 B, one with OCR 4.7 KB (`bsonSize`). 1.13M pages → ~0.47 GB bare, ~4.7 GB
  uncompressed after OCR (~1.8 GB on disk at the collection's 0.39 storage ratio), ~0.12 GB of index, revisions about
  as much again. +3.4% on the 33.5M-doc `pages` collection. Not a constraint.
- **Images:** IIIF on demand is enough for the read (the harness fetched each image once and fed it to the GPU and
  agy). Archiving is preservation, not a prerequisite; if done, ~0.75 MB a page weighted → ~850 GB on R2,
  ~$13/month. The archive lanes already do it at their own pace (frame ledger coverage today: e-rara 0 books, NB
  54/164).
- **Fetch time** at the lanes' polite rates: e-rara 1 req/s → ~12 days; NB ~0.7 day; IA ~1.7 h; BSB (~25K req/day
  shared quota) ~0.5 day. e-rara must be fetched from gex45 or l7a; it refuses this box.
- **GPU:** 2,555-4,045 pages/h → 280-443 h, 12-18 days of the gex45 card.
- **agy is the limit:** 1.0 call a page drawn (1.15 per written page) → ~1.13M calls. A pool's weekly room measured
  between ~3,300 calls (earlier estimate, 0.03% a call) and ≥ 8,800 (this run) → **128-343 weeks on one pool, 43-114
  weeks on three.** Every other part fits in about two weeks.
- **Realistic?** Not as a single sweep on agy. It is realistic as a reader-driven and planned-wave lane (#6553) at a
  few thousand pages a week, or on a route whose correction step is not agy-quota-bound. A bare GPU draft is never
  served, so the GPU alone does not change this.
