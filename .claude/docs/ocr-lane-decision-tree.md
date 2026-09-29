# Which OCR to use — the lane decision tree

PRIOR ART: `scripts/eval/DECISIONS.md` — the per-stratum ledger of what was MEASURED and what
Derek decided (evidence per language × period); `scripts/lib/ocr-routing.mjs` — the one
router in code (Latin script → lite, else flash, `OCR_LITE_ONLY` override); the RECITATION
ladder comment in `scripts/workers/pipeline-orchestrator.mjs` (Phase 2); `memory/pipeline-ops.md`
"OCR lanes" (which producer, which lane, $/1K pages); `.claude/docs/data-provenance.md` §5 (what
every writer must stamp) and §8 (known gaps). None of them answers the operator's question in
one place — *this page has no text (or bad text): which lane, in what order, and what does that
lane write?* — so on 2026-09-30 it took twelve files to reconstruct. This doc is that answer. It
cites the others; it does not restate their evidence. When a ledger row changes, change the
branch here in the same PR.

**Read this when** a book or a set of pages needs text, a page came back empty or refused, or
you are about to pick `--model`, an engine, or a free lane by hand.

## Rules that apply on every branch

1. **Every writer stamps provenance, or it does not run.** `ocr.source` names the producer;
   Gemini output carries the `gemini-engine/1` block via `write-provenance.{mjs,ts}` (never
   hand-built); specialist engines carry the Kraken/Yigdzin shape (model, weights revision or
   DOI, licence, run id, decode settings); every write sets `content_hash`, snapshots the old
   text to `page_revisions` first, refuses pages with `ocr.edited_by` / `source: 'manual'`, and
   leaves `sweep_log` + `book_events` rows. Enforced twice: `tests/unit/text-writers-use-provenance-builder.test.ts`
   (CI, per writer file) and `scripts/audit/provenance-coverage.mjs` (daily, per page). A lane
   that is in the **writer registry below as GAP** is not run until the gap is closed, however
   cheap the text is (the 47 Keely/Tesla residue pages stayed empty for this reason).
2. **Batch API by default** for any Gemini read (`bulk-reocr-local.mjs`; #5244). Realtime is
   for a reader waiting or a handful of pages, and needs `--realtime`.
3. **No Tesseract**, as an engine or as a free reference (Derek). Never Gemini below v3.
4. **Split spreads before any read** (`needs_splitting` / `split_completed`, Phase 3.1); a
   two-leaf page is two discontinuous halves (#5260 `<leaf-break/>`).
5. **The book's language field is the EDITION's language** (`language-fields.md`); routing
   reads it, so fix a wrong language before routing, not after.
6. **Cost is decided where the writer is dispatched**, not where the text lands: a held book
   pays nothing; a released book pays the dial for every downstream phase (`spend-controls.md`,
   `pipeline-status-truth.md` #4523). Quote the batch price before submitting.

## The tree

```
A page (or book) needs text
│
├─ 0. Is there a FREE reference text for this leaf?
│     ├─ Internet Archive item with `_djvu.xml` (per-leaf, offset 0 only) ──────────────┐
│     │    English/French gate 0.80, Latin/German/Italian 0.85, Greek NEVER              │
│     │    (`ia-ocr-gate.mjs`), OR a by-eye verdict (`ia-ocr-by-eye-pack.mjs` →          │
│     │    `ia-ocr-ingest.mjs --by-eye`). Archive text is PROVISIONAL: it misreads        │
│     │    ~1.5% of printed numbers (#5186), so it never replaces a lite read on a       │
│     │    date-dense book; it fills empties and refusals. Writer: ia-ocr-ingest ✓.      │
│     ├─ A canonical e-text (Derge, Perseus, Sefaria…) is a REFERENCE for evals, never   │
│     │    page text (recitation risk, `eval-design.md`).                                │
│     └─ None → 1                                                                        │
│                                                                                       │
├─ 1. Which script / language?  (`getOcrModelForBook`, DECISIONS.md "OCR engine")       │
│     ├─ Syriac ──────────── Kraken lane on Hetzner (`syriac-kraken-lane.mjs`) ✓.        │
│     │                      NEVER Gemini (it recites the printed edition).              │
│     ├─ Tibetan ─────────── BDRC/Yigdzin per-leaf lane; verdicts applied by             │
│     │                      `apply-reocr-verdicts.mjs` ✓ (SERVE / MARK / TEXTLESS).     │
│     │                      lite is unusable as a reader (#4523). Crop helps, Otsu       │
│     │                      hurts (#5250).                                              │
│     ├─ Chinese MS ──────── PaddleOCR-VL cost lane ADOPTED by rule 2026-09-18, Derek's  │
│     │                      application unverified (#4743) → until then, flash.         │
│     ├─ Greek, Japanese kuzushiji, Hebrew Rashi, Sanskrit, Arabic … ── flash (non-Latin  │
│     │                      default); Kraken passes on Greek 1450–1699 but no lane      │
│     │                      exists; NDL for Japanese unjudged (0 references).           │
│     ├─ BPH manuscripts ─── flash by policy.                                            │
│     ├─ Latin-script print (en/fr/de/nl/la/it/es …) ── lite, batch. de/fr/nl stay on   │
│     │                      lite UNJUDGED (agreement only, #5090); English 1800–1930    │
│     │                      DECIDED lite (flash fixes nothing, #5182).                  │
│     └─ Unknown / empty language ── flash (safer default) — but fix the field first.   │
│     NOTE: `OCR_LITE_ONLY` (default ON since 2026-09-11, $5/day dial) forces lite for   │
│     every Gemini read and collapses ladder tier 2 to a lite re-run. Check it before   │
│     believing the branch above ran flash.                                             │
│                                                                                       │
├─ 2. Submit, then read the result at the write boundary (all in the collector):        │
│     blank-page guard #4149 (`blank-page-guard.mjs`), loop guard (`ocr-loop-guard`),   │
│     human-edit guard, `<page-type>blank` → never translated, `fail_reasons` tallied.  │
│                                                                                       │
├─ 3. Page came back EMPTY or REFUSED?  (read `batch_jobs.fail_reasons` and the page    │
│     stamps `ocr.recitation_count` / `ocr.fail_reason` FIRST — they exist since #4674)  │
│     ├─ RECITATION (the model recognises the text) or MAX_TOKENS (lite looping on a    │
│     │    formula- or table-dense page) → the ladder, in order, each step Batch:        │
│     │    tier 1  lite again        (book flag `recitation_retry`)                      │
│     │    tier 2  flash             (`recitation_retry_lite`; = lite under LITE_ONLY)   │
│     │    tier 3  MinerU + grounded correction (`mineru-ocr-worker.mjs` → `ocr-correct-  │
│     │            grounded.mjs`, #3389) — GAP: writes no engine block. Do not run.      │
│     │    tier 3' the Archive's text for THAT leaf, under an accepted by-eye verdict   ─┘
│     │            (branch 0) — the free refusal fallback DECISIONS.md still calls open.
│     │    tier 4  read it by eye (Claude on the subscription, never an API call), or
│     │            leave it: `recitation_blocked` / `fail_blocked` + model IS the
│     │            recorded reason. 3 strikes block the page for that model only.
│     ├─ SAFETY / error:<status> → transport or key problem, not the page; fix the
│     │    submission (`batch-ocr-operations.md` failure history) before resubmitting.
│     ├─ no-text:STOP with an empty candidate → usually a blank leaf; let #4149 decide.
│     └─ The page has text but it is WRONG (another book's page, a loop, a fabrication)
│          → that is a REPAIR, not a re-OCR: `derived-metadata-lane.md` (three lanes),
│            `page-error-taxonomy.md` (name the class), `paired-artifacts.md`.
│
└─ 4. After the write: it is ACTUATION. Gap-fill will retranslate any released book whose
      translation is older than its OCR (#4523 trap); English is never modernized by the
      pipeline (#4958) — and as read, an English book strands at `ocr_complete` (#5271).
      Hold first if retranslation needs approval; release with an explicit `--to`.
```

## Writer registry — what each lane stamps (checked 2026-09-30)

"✓" = imports the provenance builder and passes the writer-guard test; "GAP" = listed in
`data-provenance.md` §8. Re-check with `npx vitest run tests/unit/text-writers-use-provenance-builder.test.ts`
and `node scripts/audit/provenance-coverage.mjs`; do not trust this table over those.

| Lane | Writer | `ocr.source` | Provenance |
|---|---|---|---|
| Gemini batch (orchestrator, `bulk-reocr-local.mjs`) | `scripts/workers/batch-collector.mjs`, `scripts/batch/collect-batch-results.mjs` | `batch_api` | ✓ `gemini-engine/1` |
| Gemini realtime, hand-run | `scripts/batch/realtime-ocr.mjs` (`--realtime`) | `ai` | ✓ |
| Gemini realtime, Lambda / Vercel | `src/workers/ocr-processor-logic.ts`, `/api/books/[id]/batch-ocr-async` | `ai` / `batch_api` | ✓ (collect stamps `updated_at` as a string, #5228) |
| Archive free text | `scripts/import/ia-ocr-ingest.mjs` | `ia_djvu` | ✓ `ia` block + `agreement_ref` (measured or `by_eye`) + ingest run |
| Syriac Kraken | `scripts/lib/syriac-kraken-lane.mjs` | `kraken` | ✓ the reference shape |
| Tibetan Yigdzin / BDRC | `scripts/maintenance/apply-reocr-verdicts.mjs` | per verdict | ✓ `engine` + `verdict` + revisions + sweep_log + book_events |
| MinerU (ladder tier 3) | `scripts/workers/mineru-ocr-worker.mjs` | `mineru` | **GAP** — no engine block, no revisions, no guard |
| Chinese Paddle cost lane | no production writer yet (#4743) | — | — |
| Greek Kraken, Japanese NDL | eval only | — | — |
| Manual edit (reader UI) | `/api/pages/[id]` | `manual` | `edited_by` only; not in `audit_log` |

## How to use it on a cohort (the Keely/Tesla shape, 2026-09-29/30)

1. Count empties per book **and per stamp** (`ocr.recitation_count`, `ocr.fail_reason`), not
   just "no `ocr.data`" — the reason decides the branch. Beware `{ 'ocr.data': null }`
   matches missing too.
2. Free first (branch 0): accepted by-eye books fill for $0; unverdicted books get a two-leaf
   pack and a read — a verdict is per BOOK, but the ingest fills only empty pages, so a late
   verdict on a mostly-model book is cheap and safe.
3. Ladder tiers 1–2 on the Batch API, priced by `bulk-reocr-local.mjs --dry-run` (126 pages
   on flash = $0.23 quoted, $0.16 measured). Expect flash to refuse most of what lite refused:
   53/126 filled.
4. What is left is stamped, and that stamp is the "recorded reason" the definition of done
   asks for. Do not reach for a writer in the GAP row to close the last 1%.
5. Say in the report what reads each write: released books are actuated, held books are not.
