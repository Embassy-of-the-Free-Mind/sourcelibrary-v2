Lands: #6561
PR: yes

# Gemini review of the Opus-corrected Paddle table pages, then serve what passes (job table-review-6561, on main)

Started through the box mesh by job table-correct-6561's cron on cloudlayer, when its Opus-correct run over the
4,379 withheld table pages finished. Derek's answer (2026-10-13) was "yes" to: "Run the Opus-correct pass on the
4,379 withheld table pages, followed by the pilot's <= 10% invented-text review, before serving any of them?"
This job is the review and, only if the gate passes, the serve.

Claim first: comment "taking this (job table-review-6561)" on #6561. If a live job already does this review,
comment and stop. Report ONLY by GitHub comments on #6561 (and the PR). Use
`node --env-file=/root/sourcelibrary/.env.production.local`. Gemini ONLY via `agy -p` on this box (main). NO Gemini
API, ever. No Claude calls on the pages: the family rule is that Gemini judges Opus.

## Input

Mongo `bookstore.paddle_table_corrections_6561`, one doc per page (written by
`scripts/eval/paddle-correct-6561/batch/upload.mjs`, PR linked on #6561): `page_id`, `book_id`, `page_number`,
`image_url` (the image Paddle and Opus read), `paddle_text`, `corrected_text` (Opus-correct, the candidate),
`corrected_sha`, `layout`, `flags`, `run`, `provenance`, `review: null`. Pages with no doc got no accepted
correction: they stay withheld, count them. Assert the SHAPE before you start (every doc has a string
`corrected_text` whose 16-hex sha256 prefix is `corrected_sha`; one doc per page_id; every page_id still carries
`ocr.unreadable: true` with `ocr.unreadable_reason: 'paddle_table_6388'` in `pages`); report any that do not and
leave them out.

## Method (do not redesign)

- Reviewer: `agy -p`, ONE page per call, image + the Opus-corrected text. Gemini 3.x Pro if `agy` lists one; agy
  withdrew 3.1 Pro on 2026-10-12 (#6635), so expect to run **gemini-3.8-flash-high**, which is also the fallback if
  Pro 429s. Say which model ran. Runner: `scripts/eval/run-cli-arm.py` (`--model … --parallel 2 --print-timeout 240`,
  the tool gate on), as the #6388 pilot ran it.
- Prompt: `scripts/eval/paddle-table-pilot-6388/review-prompt-pilot.txt`, unchanged ("list every character or cell
  in the text that is not printed on the page", plus omitted and misread; JSON verdict clean | minor | material |
  invented). Request builder: `scripts/eval/paddle-table-pilot-6388/mkreview.mjs` is the prior art; the candidates
  here are already the parsed transcription body (no sentinels to strip).
- A page is "called invented" when the verdict is `invented` (at least one invented span). A reply that does not
  parse, or a page the reviewer did not read, is retried twice, then counted as NOT REVIEWED: it stays withheld.

## Step 1: the sample and the gate

- 100 pages at random, seeded (seed 6561), one per book where possible, PLUS 5 planted controls: on 5 further
  sampled pages with a body of at least 3 text rows, insert a DUPLICATE of one printed row directly after it (the
  brief's control: "a duplicated row inserted"; record page, row and position). Controls are mixed in, unmarked.
- Controls caught (verdict `invented`, and the invented span is the duplicated row) on fewer than 4 of 5: STOP,
  comment the numbers, serve nothing.
- GATE: pages called invented <= 10 of the 100. Report the rate with its Wilson 95% interval, the split of verdicts,
  and 5 of the "invented" calls opened against the image by you (is the reviewer right? say so plainly; do not move
  the gate on that reading, report it beside it).
- If it FAILS: serve nothing. Comment **NO-GO** on #6561 with the numbers. Touch the done file. Stop.

## Step 2 (only if the gate passes): review every remaining page

Same reviewer, same prompt, 1 page per call, quota back-off (a 429 sleeps and resumes; it is not a verdict). A
headless job cannot wait: run it DETACHED (`setsid nohup`) with a checkpoint file (one row per page: page_id,
verdict, invented spans, model, at), and an hourly cron on main that comments progress on #6561 every 6 h and, when
the runner exits, starts the serve step (or a follow-on job with the serve section of this brief) and removes
itself. Verify the cron by its non-comment line and a dry run. Write each verdict into the page's staging doc
(`review: {verdict, invented, invented_chars, omitted_chars, misread_chars, note, model, at}`).

## Step 3: serve

For each page the reviewer did NOT call invented (verdict clean, minor or material) and that was reviewed:

1. Re-read the page live. Skip (and list) if it is no longer `ocr.unreadable` with reason `paddle_table_6388`, or
   carries a human edit (`ocr.edited_by`, `ocr.source: 'manual'`), or its book is gone.
2. `saveRevisionBeforeOverwrite(db, page.id, 'ocr', { reason: 'opus_correct_6561' })` FIRST
   (`scripts/lib/page-revisions.mjs`); a failed snapshot aborts the page.
3. Write the corrected text through the normal OCR write shape (`scripts/batch/cli-ocr.mjs` apply is the model:
   `ocr.data`, `model`, `source: 'ai'`, `updated_at`, prompt fields, `liftOcrTags`, `parseDetectedImages`, and an
   `ocrProvenance` block from `scripts/lib/write-provenance.mjs`). The provenance must name: Opus-correct, run
   `opus-correct-6561-tables`, the model, CLI and prompt hashes from the staging doc's `provenance`, the Paddle
   draft it corrected, the input image (url, bytes, sha256), and the reviewer (model, verdict, at). Unset
   `ocr.unreadable`, `ocr.unreadable_reason`, `ocr.verdict`, `ocr.withheld_chars`. Guard the update on the page
   still being withheld (filter on `ocr.unreadable_reason`), so a concurrent writer wins.
4. One `sweep_log` row PER PAGE (`recordSweepAction`, sweep `serve-opus-correct-6561`), then per book:
   `recountBook`, a `book_events` row, and `scripts/workers/sync-pages-content.mjs --book=<id>` so the Supabase
   mirror carries the new text.
5. Dry run first (no `--apply`), 20-page canary with `--apply`, open 3 of them in the reader, then the rest.

Lift NOTHING else:
- Book holds stay (`pipeline-hold.mjs`, reason `paddle-table-6388`): do not release a book.
- The 1,320 withheld English pages stay withheld. Retranslating them from the corrected Chinese is a separate
  decision; say so in the final comment and raise it as a `DECISION:` line. Do not un-park their
  `page_translations` rows and do not run `restore-withheld-translation.mjs`.
- Pages called invented, pages not reviewed and pages with no correction stay withheld. List them (a gzipped
  jsonl in the PR, counts in the comment).

ACTUATION, say it in the report: a served page has a string `ocr.data` again, so `embed-gemini.mjs --incremental`
(every 4 h) will embed it, and the reader, the meta description and the mirror will carry it. The hourly
`withhold-stale-translations` sweep keys on `ocr.unreadable` and will not re-withhold a served page. Check that no
lane translates these pages on its own while their books are held; if one would, stop and comment before serving.

UNDO, state it in the PR: every served page has its `page_revisions` snapshot (reason `opus_correct_6561`) of the
withheld state; give the command that puts it back.

## Final comment on #6561

Pages served / still withheld (by reason: called invented, not reviewed, no correction, skipped at write), the gate
numbers with the Wilson interval, the controls, the reviewer model, calls used, and 5 served page links
(`https://sourcelibrary.org/book/<id>?page=<n>`) that you opened and checked against the image. Follow
`.claude/docs/quality-statements.md` for any sentence about how good the text is: the measured rate, n and date.

## Caps

$0 cash. `agy -p` on main only. If anything needs money or the Gemini API: stop and comment. The PR carries the
review runner, the serve script, the sample, the controls and the verdicts (packed jsonl.gz, under 300 files,
`git commit -s`).
