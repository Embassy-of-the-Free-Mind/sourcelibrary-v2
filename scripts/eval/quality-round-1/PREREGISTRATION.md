# Pre-registration — quality round 1: a stratified random sample of the backlog through the production pipeline, judged end to end (#5438)

_Written 2026-10-01, **before the draw was committed and before any spend**. Issue: #5438. Derek
approved up to $500 of Gemini spend on 2026-10-01: "I want to see that we get quality out of this
pipeline. Keep things organized and production ready." The design, strata and ship rule below
come from the issue and are fixed now. Amendments go at the bottom with a UTC timestamp, and none
may change the ship rule after spending has started._

PRIOR ART: `../PREREGISTRATION-translation-chained-vs-realtime.md` (house format: fixed rule,
amendments at the bottom — reused); `../translation-corpus-audit/` (draw → packets → Opus judges
→ `score.mjs` with swap/drop/repeat controls, and the `JUDGE-PROMPT.md` source-grounded fidelity
rubric — reused verbatim for translation); `GATE.md` on `eval/speedtest-a-gate` (Hetzner draw +
claude.ai routine judge, and the hand-read rule for invention candidates — reused);
`lib/metrics.mjs#scoreAgainstReference` and `ground-truth/` (OCR against external text — reused);
`two-read-garble-5313.mjs` (PR #5390, the two-read screen — reused where no reference exists);
`.claude/docs/page-error-taxonomy.md` (defect classes — reused as the label set);
`scripts/audit/scope-progress.mjs` (per-stage outputs, not statuses — reused for progress).
Not fitting as-is: the speed test measures pace and price on whatever the roadmap enrols, and its
gate samples one page per book from one lane. This round chooses the books.

## The decision this changes

Per stratum, whether the books the pipeline produced are published. A stratum that passes ships
visible. A stratum that fails stays hidden, with the failing class named and a fix ticket. Across
strata, the round shows which kinds of book the pipeline can be trusted with today, and at what
cost per book.

## Frame (operationalised from the issue; written before the draw)

A book is eligible iff all of the following hold:

- `visible ≠ true` OR `pipeline_auto.status ≠ complete`;
- not held (`pipeline_auto.hold` absent) and not at a hold-like status (`held`,
  `loop_quarantine_hold`, `paused`);
- not Kloss (`image_source.provider ≠ cmc_kloss`); not an artwork (`content_type ≠ artwork`);
  no `tenantId`/`tenant` (partner-owned books publish on the partner's decision);
- `40 ≤ pages_count ≤ 600`;
- page images archived at the **RECORD tier** (`archive-coverage.md`): one page doc per page, and
  every page doc claims an R2 original in `archived_photo` (`classifyPageRecord` =
  `MASTER_OR_DERIVATIVE`). Checked on the pages, not on `pages_archived`;
- its language resolves to one of the six groups below, and no language on it is Tibetan or
  Syriac (those have their own lanes and are never OCR'd with Gemini).

Three refinements the issue does not spell out, fixed before the draw because without them the
ship rule could publish something it must not:

1. **`hidden_reason` must be liftable.** Through `mapLegacyReason` (`scripts/lib/publication.mjs`),
   the reason maps to none, `launch_curation`, `unprocessed` or `unarchived`. Duplicates, quality,
   wrong content, rights/takedown, provider-restricted and curation holds are decisions about the
   book, and a passing stratum must not undo them.
2. **Not at or past image extraction** (`images_submitted`, `images_complete`, `cover_selected`,
   `complete`). Re-queuing those books would re-run Phase 8 on work it has already done.
3. **Not inside another open scope or envelope** (by book id or scope collection). That run
   already funds and measures those books. Counting them here would double-book their spend.

**Groups** use the FIRST language of `books.language`, parsed by `toLanguageCodes` and compared by
family. `language` is the edition's language (`language-fields.md`).

| group | codes |
|---|---|
| latin | lat |
| vernacular | deu, fra, nld, ita, spa (with historical stages) |
| greek | grc, ell |
| semitic_persian | heb, ara, fas |
| cjk | zho (incl. lzh), jpn, kor |
| indic | san, pli, pra, hin, mar, ben, guj, pan, tam, tel, kan, mal, ori, sin, nep, awa, bho, mai, new |

**Source:** `ia` if `image_source.provider = internet_archive` (or, when that field is absent,
`provider` names Internet Archive); otherwise `other`.

**Draw:** 12 cells (6 groups × 2 sources), 20 books per cell, seed **20261001**. Each cell's
candidates are sorted by `id`, then shuffled with `makeRng(20261001 + cellIndex)` (mulberry32,
`lib/paired-stats.mjs`). The RECORD-tier archive check runs in shuffled order until 20 books pass.
A cell with fewer than 20 eligible books takes all of them and says so. `draw.mjs` is the frame;
`draw-2026-10-01.json` is the committed result, with every book screened out and why.

## The draw (as amended by Amendment 1; read-only; reproducible id-for-id)

| cell | eligible candidates | screened | drawn | pages | OCR pages at draw | statuses at draw |
|---|---:|---:|---:|---:|---:|---|
| latin__ia | 3260 | 1 | 20 | 6813 | 928 | needs_attention 12, archiving 5, parked 1, archive_complete 2 |
| latin__other | 15105 | 5 | 20 | 6133 | 150 | archive_complete 17, needs_attention 2, archiving 1 |
| vernacular__ia | 627 | 0 | 20 | 8654 | 553 | needs_attention 9, archive_complete 11 |
| vernacular__other | 1532 | 6 | 20 | 5718 | 2135 | archive_complete 15, needs_attention 5 |
| greek__ia | 174 | 7 | 20 | 7182 | 664 | failed 1, needs_attention 13, archive_complete 6 |
| greek__other | 2403 | 257 | 20 | 6487 | 75 | archive_complete 20 |
| semitic_persian__ia | 40 | 1 | 20 | 6058 | 968 | archive_complete 15, needs_attention 4, failed 1 |
| semitic_persian__other | 181 | 1 | 20 | 5810 | 975 | archive_complete 20 |
| cjk__ia | 3754 | 0 | 20 | 3211 | 307 | needs_attention 12, archive_complete 8 |
| cjk__other | 179 | 1 | 20 | 2903 | 623 | archive_complete 13, needs_attention 7 |
| indic__ia | 898 | 1 | 20 | 3615 | 643 | archive_complete 20 |
| indic__other | 83 | 66 | 17 (short) | 3696 | 473 | archive_complete 16, needs_attention 1 |
| **total** | | | **237** | **66280** | 8494 | |

`indic__other` is short: 66 of its 83 candidates failed the RECORD-tier archive check, so it takes all 17 eligible books. `greek__other` screened out 257, mostly BSB books whose pages are not on R2. A catalogue mislabel is drawn as catalogued: for example, 阿彌陀經要解 is catalogued Persian and sits in `semitic_persian__ia`. Per-language routing reads the same field, so that is part of what is measured.

## Run — the production pipeline as routed today

- **Envelope:** `quality-round-1-2026-10` over exactly the drawn book ids, `budget_usd = 500`,
  no `lanes` restriction (every phase spends it). Created with `scripts/maintenance/set-scope.mjs`.
- **Enrol:** each drawn book gets the Phase 0 record (`pipeline_auto.status = queued`,
  `source = quality-round-1-2026-10`, `queued_at`, `retry_count: 0`, `likely_first_translation`).
  A book's prior status is kept in `pipeline_auto.prior_status`. The write is a compare-and-set
  on the status read a moment earlier, filtered by `NOT_HELD`, with an `audit_log`
  `pipeline_status_changed` row. A book whose status moved in between is reported, not forced.
  From `queued`, the orchestrator carries the book on its own: archive check, split detection,
  IA reference and preview, metadata, OCR (Batch API; only pages without text), translation
  (chained Batch lane for `processing_priority < 90`, realtime at ≥ 90, by the router), summary,
  index, chapters, image extraction, cover, finalize. Embeddings run from their own workers.
- **No** special prompts, no hand repairs, no priority edits, no dial change. Books stay hidden.
- **Cap enforcement.** While the global dial is open (speed test A runs at $300/day until
  2026-10-03T22:30Z), the envelope is only a meter and does not stop spending. The watcher
  therefore enforces the cap itself. When measured envelope spend (both stores) reaches **$475**,
  every round book not yet at a terminal status is held (`holdBook`, reason
  `quality-round-1-cap`), and the round reports BLOCKED. In-flight batches finish.

**Expected spend.** At draw time 237 books (63,737 pages) needed about 56,000 pages OCR'd and up
to about 62,000 translated. Speed test A measured roughly $0.002/page for OCR plus chained
translation (`/root/speedtest-a/ticks.jsonl`). Enrichment, chapters and image extraction add
some. Estimate **$150–250**, inside the $500 cap. Logged in the ops spend ledger.

## Measures, per stratum (cell)

1. **Cost and time.** $ per completed book and per phase, from BOTH meter stores (Mongo
   `gemini_usage` + Supabase `gemini_usage`), attributed by `book_id` since the envelope's
   `created_at`. Phase is read from the row's endpoint/call site. Wall-clock per phase comes from
   `audit_log` `pipeline_status_changed` rows, with page `ocr.updated_at` /
   `translation.updated_at` and chained-run `rounds[]` as cross-checks. The watcher snapshots
   status every 30 min into a checkpoint file.
2. **Pipeline health.** Refusals (chained-lane gates, recitation blocks, safety), parked, failed
   and `needs_attention` books with the reason, cancelled Batch rounds, and pages left without
   text or translation, each with a reason.
3. **OCR — one seeded interior page per book** (15–95% of the book, ≥ 200 chars OCR):
   - **Reference available** (the book or work has an external e-text in `ground-truth/`,
     `benchmark/refs/`, CBETA/Kanripo/ctext, First1KGreek/Perseus, GRETIL, la.wikisource): score
     with `scoreAgainstReference`, reporting `charAccuracy` and `charAccuracyWindowed`.
     `aligned:false` pages drop out. **Positive control first:** the reference scored against
     itself with 5% noise must come back aligned with CER ≤ 0.08, and a shuffled-reference
     chance floor must come back unaligned. If either fails, the instrument is `probe_broken` and
     that stratum's OCR is reported unmeasured, never as a pass.
   - **No reference:** the two-read garble screen (`two-read-garble-5313.mjs` `twoReadAgreement`,
     a second flash-lite read of the same page through the Batch API), plus **3 pages per cell
     read by eye** against the image, labelled `read-from-image`, with page-error-taxonomy class.
4. **Translation — one seeded interior page + one seam page per book.** A seam page is the first
   page of a consecutive pair where both pages hold text and the earlier one ends without a
   terminator. Judged with `translation-corpus-audit/JUDGE-PROMPT.md` verbatim by Opus
   lean-workers (subscription, $0), blinded (packets carry only `id, language, source,
   translation`). Controls: swap, drop and repeat (`draw.mjs`'s construction, n ≥ 10 each, from
   round books). `score.mjs --gate` must pass. A `major` defect is the judge's per-defect
   severity, mapped to a page-error-taxonomy class. Every invention or echo candidate is
   hand-read under GATE.md step 8. **20 pages by eye across cells**, labelled
   `read-from-text`/`read-from-image`.
5. **Enrichment — 5 books per cell.** Title, author and date in the record and `ai_metadata`,
   checked against the title page image (by eye, `read-from-image`). The summary must read as
   this book, with nothing invented. A book with no title page in the scan is replaced by the
   next drawn book in its cell, in rank order.

## Ship rule — fixed now (from the issue)

A stratum **SHIPS** (its books become visible through `setPublication(state: 'public')`, with
provenance labels on) iff ALL of:

1. **major-defect rate ≤ 10% on n ≥ 20 judged translation pages**. Rate = pages with ≥ 1 major
   defect ÷ judged main pages. Controls passing is a precondition; failed controls = NOT_JUDGED,
   never a pass;
2. **zero confirmed inventions** (hand-confirmed under GATE.md step 8: a whole sentence with no
   counterpart in the source, or the source echoed back / not English);
3. **OCR not worse than the language's prior measurement:**
   - *with a reference:* round median CER ≤ the production engine's
     (`gemini-3.1-flash-lite`) median reference CER for that language in the latest
     `results/benchmark/summary-*.json`, + 0.02;
   - *without one:* median two-read agreement ≥ the language's lite-vs-flash agreement in
     `results/per-language-suitability-2026-09-11.json` − 0.05;
   - *where no prior exists for the language:* the 3 by-eye pages show no O1/O2/O3/O5 or I1
     class;
4. **metadata 5/5** (title, author and date each correct on the 5 checked books, no invented
   summary).

Otherwise the stratum **HOLDS**. Its books stay hidden, and `hidden_reason` is set by the writer
to a `quality` reason naming the failing class (`quality-round-1: <class>`). One fix issue per
failing class is filed, or commented on if the class's existing issue already exists (the
taxonomy classes each have one, #5131–#5160).

Books in a passing stratum are made visible only if they themselves reached `complete` with
`pages_ocr ≥ pages_count − pages_blank` and translation readable (`isTranslationReadable`). A book
in a passing stratum that did not finish stays hidden with `hidden_reason` naming why.

Books that were already `visible: true` at draw time keep their visibility whatever the verdict.
Hiding a public book is a curation decision, not this round's. In a failing stratum they are
listed on the fix issue.

## Deliverables

`draw-2026-10-01.json` + this file (PR 1, before enrolment); `scripts/eval/results/quality-round-1-2026-10.json`;
an `EXPERIMENTS.md` row; `REPORT.md` with ONE table (stratum × $/book, days, OCR score,
translation major %, verdict) and the by-eye URLs; every visibility flip logged on #5438; a
spend-ledger line. Progress comment on #5438 every ~6 h.

## Do not

Raise the dial; edit priorities; hand-repair a page; OCR Tibetan or Syriac with Gemini; delete
anything; read a judge's verdict without its controls; quote one meter store.

---

## Amendments

### Amendment 1 — 2026-10-01T07:58Z, before any enrolment or spend: books parked for a pending decision are out

The first committed draw had 10 books at `pipeline_auto.status: parked` whose park was a decision,
not a budget park: 9 in `cjk__other` were `reason: awaiting kuzushiji OCR benchmark` (Japanese
cursive; Gemini must not read them before #5100 decides), and 1 in `vernacular__other` had a
non-budget `parked_reason`. Those are holds by another name, and enrolling them would override a
lane decision. **The frame now excludes `parked` books unless `parked_reason` is the budget park
`ocr-backlog-age-scope-*`** ("unpark to resume").

Re-running the draw under the amended frame changes only the two cells that held such a book.
Their pools changed, so each was reshuffled whole rather than one-for-one. The other 10 cells
are unchanged id-for-id. The envelope's book list was replaced to match (`--replace-books`)
before any book was enrolled. The draw's book ids and pages above are the amended ones (237 books,
66,280 pages). No measure, threshold or ship rule changed.
