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
   cheap the text is (the 47 Keely/Tesla residue pages stayed empty on 2026-09-30 until the
   MinerU gap closed the same day).
2. **The model fixes the channel (#7075).** gemini-3.1-flash-lite is the only Gemini model sent
   to the paid API, Batch by default (`bulk-reocr-local.mjs`; #5244; realtime is for a reader
   waiting or a handful of pages, and needs `--realtime`). Every other Gemini model (3 Flash,
   3.x Flash, Pro) reads through the **agy CLI** on the subscription (`cli-ocr.mjs`), never the
   API. Claude reads through `claude -p` (`claude-ocr.mjs`, `claude-ocr-two-read.mjs`), never via
   agy. When a CLI lane has no quota the book **waits**; it never falls through to the API.
   agy offers no Gemini 3 Flash (its Gemini models are 3.8 Flash and 4 Argon, checked 2026-10-26), so a
   book routed to `gemini-3-flash-preview` is read by **3.8 Flash low**: `scripts/batch/cli-ocr-lane.mjs`
   drains the `ocr-flash-cli-7075` hold that way (`CLI_MODEL_FOR`, #7089). Spread books wait.
   Enforced by `assertApiOcrModel` in `scripts/lib/ocr-routing.mjs` at every OCR submitter and
   `tests/unit/ocr-api-channel-guard.test.ts`.
3. **No Tesseract**, as an engine or as a free reference (Derek). Never Gemini below v3.
4. **Split spreads before any read** (`needs_splitting` / `split_completed`, Phase 3.1); a
   two-leaf page is two discontinuous halves (#5260 `<leaf-break/>`).
5. **The book's language field is the EDITION's language** (`language-fields.md`); routing
   reads it, so fix a wrong language before routing, not after.
6. **Cost is decided where the writer is dispatched**, not where the text lands: a held book
   pays nothing; a released book pays the dial for every downstream phase (`spend-controls.md`,
   `pipeline-status-truth.md` #4523). Quote the batch price before submitting.

## The routing table (#7075): the evals choose the model, the model fixes the channel

| model | channel | cost |
|---|---|---|
| gemini-3.1-flash-lite | paid Gemini **Batch** API | ~$1/1K pp measured (#6968) |
| any other Gemini model (3 Flash, 3.x Flash, Pro) | **agy CLI** on the subscription (`cli-ocr.mjs`), never the API | $0, quota-bound |
| Claude Opus | `claude -p` on the subscription (`claude-ocr.mjs`), never via agy | $0, quota-bound |
| Kraken / Yigdzin / Paddle / MinerU | Hetzner or GPU lanes | $0 marginal |

| script / material | OCR reader | evidence | in code |
|---|---|---|---|
| Latin-script print (la, fr, de, it, nl, en …) | flash-lite, Batch | default since 2026-09-11 (`OCR_LITE_ONLY`) | `getOcrModelForBook` → lite |
| Greek | 3 Flash via agy | CER 6.6% flash vs 11% lite, 176 referenced books (#5575) | `FLASH_OCR_FROM.grc` |
| Persian, Sanskrit, Pali, Arabic | 3 Flash via agy | flash re-read lifts judged translation fidelity +1.00 / +0.75 / +0.58 / +0.39 (#5700, PR #5760) | `FLASH_OCR_FROM` |
| Ge'ez | in the Flash list on agreement only; the issue marks it "not Flash" — open | #4729 agreement 0.47, 9/20 catastrophic | `FLASH_OCR_FROM.gez` |
| Chinese print (woodblock, movable type, typeset) | **Paddle split-leaf lane** (row below) — Derek 2026-10-26 "use paddle": $0 and no agy quota, which stays for correction; pages its guards turn away → 3 Flash via agy | split leaves median CER 6.1% vs Flash 5.2% (Flash stays the better reader), catastrophic 3/198, all blank leaves, now guarded (PR #7184); whole-spread Paddle failed ~1 spread in 7 (#6101) | lane: `scripts/workers/paddle-print-lane.mjs`; fallback and books outside a lane frame: `FLASH_OCR_FROM.zho` (from 2026-10-21). Fallback for held lane books: `paddle-print-lane.mjs fallback --read --apply` (the lane's `apply` writes the list; `fallbackRoute` sends blank-or-faint textless pages nowhere) |
| Chinese / Japanese print outside the Siku, cursive and Meiji-typeset cohorts (woodblock, movable type, Chinese typeset) | **Paddle split-leaf lane** on gex45 for pages with no text, a flash-lite read or a whole-spread Paddle read; a stored Flash / Pro / Claude / typed / human read is kept | P1 median CER 0.061 vs lite 0.067, catastrophic 3/198 each; Flash 0.052 stays the better reader (PR #7184); blank-leaf + loop guard per leaf | `scripts/workers/paddle-print-lane.mjs`, books held `paddle-print-6101` |
| Chinese manuscript | Paddle lane where the book is held for it; otherwise 3 Flash via agy until #4743 has a writer | #4743 | holds + `FLASH_OCR_FROM.zho` |
| Syriac | Kraken; never Gemini | #4883 | own lane, books held |
| Tibetan | BDRC/Yigdzin per-leaf; lite unusable | #4523, #5250 | own lane, books held |
| German Kurrent manuscript | Opus two-read (`claude-ocr-two-read.mjs`) | #6780 | hand-run |
| Recitation-refused pages | lite → 3 Flash via agy → Opus (`claude-ocr.mjs`) | #6968 ladder | branch 3 below |

How a Flash book reaches the CLI lane: Phase 1.5/2 of the orchestrator and every pooled submit
check the model; a non-lite one is never uploaded. The book is held with `CLI_FLASH_OCR_HOLD`
(reason `ocr-flash-cli-7075`, `pipeline_auto.hold.detail.routed_model`), which takes it out of
every lane. A person or job runs `cli-ocr.mjs read --page-ids-file=… --out=DIR` on the book's
unread pages, then `apply --apply`, then `hold-pipeline-books.mjs --release-held --reason
ocr-flash-cli-7075 --book <id> --apply`; Phase 2 then finds nothing unread and advances it. A
scheduled runner for this queue does not exist yet (follow-up on #7075).

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
│     │                      application unverified (#4743) → until then, 3 Flash via    │
│     │                      the agy CLI. Books held for the Paddle lane keep the hold.  │
│     ├─ Chinese print ───── Paddle split-leaf lane (Derek 2026-10-26 "use paddle"; PR   │
│     │                      #7184: CER 6.1% vs Flash 5.2%, $0, keeps agy for correction)│
│     │                      onto empty / lite / whole-spread-Paddle pages, books held   │
│     │                      paddle-print-6101. Pages its guards turn away, and books    │
│     │                      outside a lane frame → 3 Flash via the agy CLI (#7075).     │
│     ├─ Greek, Persian, Sanskrit, Pali, Arabic ── 3 Flash via the agy CLI              │
│     │                      (FLASH_OCR_FROM; #5575, #5700). Ge'ez is in the same list   │
│     │                      on agreement only (#4729). Kraken passes on Greek 1450–1699 │
│     │                      but no lane exists; Japanese kuzushiji (NDL unjudged) and   │
│     │                      Hebrew stay lite.                                           │
│     ├─ BPH manuscripts ─── flash by policy.                                            │
│     ├─ German Kurrent MS ─ two-read Opus lane (`claude-ocr-two-read.mjs`, #6780) ✓:    │
│     │                      two independent Opus reads from native-res strips, a diff,   │
│     │                      a zoomed adjudication of the disputed spans only. lite reads │
│     │                      fluent nonsense on these hands (Zucker → "Zuber") and        │
│     │                      truncates whole recipes. Subscription, $0; run on Hetzner.   │
│     ├─ Latin-script print (en/fr/de/nl/la/it/es …) ── lite, batch. de/fr/nl stay on   │
│     │                      lite UNJUDGED (agreement only, #5090); English 1800–1930    │
│     │                      DECIDED lite (flash fixes nothing, #5182).                  │
│     └─ Unknown / empty language ── flash (safer default) — but fix the field first.   │
│     NOTE: `OCR_LITE_ONLY` (default ON since 2026-09-11) forces lite for every Gemini  │
│     read except the families in `FLASH_OCR_FROM`, and collapses ladder tier 2 to a    │
│     lite re-run. A "flash" answer from the router is NOT an API read: the orchestrator│
│     holds the book (`ocr-flash-cli-7075`) for the agy CLI lane and it waits there;    │
│     `bulk-reocr-local.mjs` lists those pages for `cli-ocr.mjs` instead of submitting. │
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
│     │    tier 2  flash, agy CLI    (`recitation_retry_lite`; = lite under LITE_ONLY;   │
│     │            a flash tier is held for the CLI lane, never sent to the API, #7075)  │
│     │    tier 3  MinerU + grounded correction (`mineru-ocr-worker.mjs` → `ocr-correct-  │
│     │            grounded.mjs`, #3389). Provenance ✓ since PR #5280 (2026-09-30).       │
│     │            MEASURED on the 114-book English reference (PR #5298): reads every    │
│     │            page Gemini refuses (16/16 at median CER 0.21%), median 0.66% overall │
│     │            vs lite 0.20%; 1820+ only — before 1820 it reads ſ as f (median 4.6%).│
│     │            Its worst pages dropped footnotes → fixed in PR #5299.                │
│     │    A page with a COMPLETE draft: correct it, don't re-read it (§ below).         │
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

## A page that already has a complete draft: correct it, don't re-read it

Experiment files are in `scripts/eval/experiments/`. When a page has a complete transcription and the
alternative reader is a generalist that drops or invents lines, correct the draft against the image
(`scripts/batch/ocr-convergence/correct.mjs`, Opus) instead of re-reading it.
- **Wins:** #6694, preferred to Gemini read + adjudication 158–6 (Opus judge) / 148–21 (Gemini), adopted
  (`2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md`). Paddle tables, median CER 4.0% vs Paddle 6.4% vs Opus
  redo 5.8% (`2026-10-12-paddle-zh-correct-vs-redo-6561.md`). Tibetan: redo 0.70 vs draft 0.945; correct +0.015
  (`2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md`). Florentine (#6865 comments, 2026-10-24): the re-read
  gate went 29/1, failing on a dropped half-line; the correction gate went 30/0/0, Getty Nahuatl CER
  0.571 → 0.069, 130 pages written.
- **Loses:** near-perfect drafts whose "errors" are variant forms, 12–15% made worse
  (`2026-10-15-stale-siku-opus-correct-pilot-6561.md`); weaker correctors
  (`2026-10-13-sonnet-haiku-correct-vs-opus-6667.md`); the corrector is chosen per language (Tibetan: 3.8 Flash
  low beats Opus, `2026-10-13-tibetan-flash38-correct-6560.md`; Argon NO-GO,
  `2026-10-15-tibetan-g4l-pass-gate-6560.md`); translation, where correcting stored English helps less than an
  Opus retranslation (`2026-10-12-pro-opus-correction-hardest-languages-6545.md`).
- **Conditions:** screen first and correct only weak pages; run a blind made-worse gate on held-out pages before
  writing. A correction costs about a read in quota (the image still goes in): it buys accuracy, not savings.
- **Known gap (open):** `cli-ocr.mjs apply` takes `correct.mjs` output as a plain read (no `mode: 'correct'`),
  so the correction-mode 25%-changed cap does not run (Florentine job, 2026-10-24).
- **Pending:** the Latin lite arm (job opus-correct-latin-5924, #5924).

## Writer registry — what each lane stamps (checked 2026-09-30)

"✓" = imports the provenance builder and passes the writer-guard test; "GAP" = listed in
`data-provenance.md` §8. Re-check with `npx vitest run tests/unit/text-writers-use-provenance-builder.test.ts`
and `node scripts/audit/provenance-coverage.mjs`; do not trust this table over those.

| Lane | Writer | `ocr.source` | Provenance |
|---|---|---|---|
| Gemini batch (orchestrator, `bulk-reocr-local.mjs`) | `scripts/workers/batch-collector.mjs`, `scripts/batch/collect-batch-results.mjs` | `batch_api` | ✓ `gemini-engine/1` |
| Gemini realtime, hand-run | `scripts/batch/realtime-ocr.mjs` (`--realtime`, `--model=lite` only since #7075) | `ai` | ✓ |
| Gemini CLI (agy, subscription): 3.8 Flash low in place of 3 Flash for the `FLASH_OCR_FROM` scripts and the ladder's flash tier | `scripts/batch/cli-ocr.mjs read` then `apply`; the held queue through `scripts/batch/cli-ocr-lane.mjs` | `ai` | ✓ `gemini-engine/1` (api `cli`, CLI name and version, prompt, image) |
| Gemini realtime, Lambda / Vercel | `src/workers/ocr-processor-logic.ts`, `/api/books/[id]/batch-ocr-async` | `ai` / `batch_api` | ✓ (collect stamps `updated_at` as a string, #5228) |
| Archive free text | `scripts/import/ia-ocr-ingest.mjs` | `ia_djvu` | ✓ `ia` block + `agreement_ref` (measured or `by_eye`) + ingest run |
| Syriac Kraken | `scripts/lib/syriac-kraken-lane.mjs` | `kraken` | ✓ the reference shape |
| Tibetan Yigdzin / BDRC | `scripts/maintenance/apply-reocr-verdicts.mjs` | per verdict | ✓ `engine` + `verdict` + revisions + sweep_log + book_events |
| MinerU (ladder tier 3) | `scripts/workers/mineru-ocr-worker.mjs` | `mineru` | ✓ since PR #5280 — `specialist-engine/1` block (version, licence, run, image, `ladder` = the refusal stamps it follows), revisions, human-edit guard, sweep_log + book_events; `missingProvenance` checks it with the kraken/bdrc rule. Rows before 2026-09-30 (2,586) carry only a bare string. |
| Opus two-read (German Kurrent MS, #6780) | `scripts/batch/claude-ocr-two-read.mjs apply` (`ocr.pipeline: claude-two-read-6780`) | `ai` | ✓ `anthropic` engine block (api `cli`); `input.two_read` = both reads' hashes, folded agreement, every dispute with its ruling; revisions, human-edit guard, sweep_log + book_events. The 40% overlap guard is lifted only for a stored flash-lite read on a book in `--replace-lite-books`. |
| Opus one-read (Nahuatl / Maya, #6559) | `scripts/batch/claude-ocr.mjs` reads, `scripts/batch/cli-ocr.mjs apply` writes | `ai` | ✓ `anthropic` engine block (api `cli`) |
| Chinese Paddle cost lane | no production writer yet (#4743) | — | — |
| Chinese guarded Paddle (held table + mixed residue, #6871 row 3) | `scripts/workers/paddle-zh-guarded-lane.mjs` (dry-run tested 2026-10-18; not applied) | `paddle`; `ai` on the Flash route | ✓ Paddle engine block (weights sha256, stack, serving, run, image sha256) or `gemini-engine/1` CLI block; `ocr.verdict` = the guard's verdict; first reads only, human-edit guard, revisions, sweep_log + book_events. Books stay held: their release is what queues paid translation |
| Paddle split-leaf print (Chinese / Japanese, #6101) | `scripts/workers/paddle-print-lane.mjs apply` (`ocr.pipeline: paddle-print-2026-10`) | `paddle` | ✓ Paddle engine block (weights sha256, stack, serving, run) + `input.leaves` (crop box, ink, blank per leaf) + `replaced` (no_text / flash_lite / paddle_whole_spread); through `writePageText` (revision row with the whole prior field, `reason: reocr_paddle_print_6101`, `run_id`), human-edit guard, leaf blank/loop guards, sweep_log before and after, book_events. Books held `paddle-print-6101` before the first write |
| Greek Kraken, Japanese NDL | eval only | — | — |
| Manual edit (reader UI) | `/api/pages/[id]` | `manual` | `edited_by` only; not in `audit_log` |

## How to use it on a cohort (the Keely/Tesla shape, 2026-09-29/30)

1. Count empties per book **and per stamp** (`ocr.recitation_count`, `ocr.fail_reason`), not
   just "no `ocr.data`" — the reason decides the branch. Beware `{ 'ocr.data': null }`
   matches missing too.
2. Free first (branch 0): accepted by-eye books fill for $0; unverdicted books get a two-leaf
   pack and a read — a verdict is per BOOK, but the ingest fills only empty pages, so a late
   verdict on a mostly-model book is cheap and safe.
3. Ladder tier 1 on the Batch API (lite), priced by `bulk-reocr-local.mjs --dry-run`; tier 2
   (flash) through the agy CLI (`cli-ocr.mjs`), $0 and quota-bound (#7075; on 2026-09-30, before
   the channel rule, 126 pages on Batch flash cost $0.16). Expect flash to refuse most of what
   lite refused: 53/126 filled.
4. What is left is stamped, and that stamp is the "recorded reason" the definition of done
   asks for. Do not reach for a writer in the GAP row to close the last 1%.
5. Say in the report what reads each write: released books are actuated, held books are not.
6. **Gate a new reader against what the reader gets now, not against an absolute score.** On a page
   with NO text the alternative is nothing, so the gate is the harms only: no invented text, the
   planted errors caught, the script's letters kept. A fidelity mean is reported beside it, never
   used as the bar. An absolute bar belongs only where the read REPLACES stored text, and there it
   is paired against that stored text on the same pages. Set the gate before the fan-out and run
   it first, so a pass writes as it reads. #6559 (2026-10-12/13): Opus read 11,843 empty Nahuatl
   and Mayan-language pages, 0 invented, 3 of 3 plants caught, then wrote nothing for a day because
   one weak judge scored 3.80 on 15 pages against a 4.0 bar.
