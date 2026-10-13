# OCR routing: who reads which kind of page, and the weekly audit that watches it

PRIOR ART: `.claude/docs/ocr-lane-decision-tree.md` (the operator's procedure for ONE page that needs
text: free text first, then script, then the refusal ladder); `.claude/docs/ocr-engine-routing.md` (a
generated per-LANGUAGE table of what the Gemini router does, with evidence cells); `scripts/eval/DECISIONS.md`
(the ledger: one row per question, who decided); `scripts/audit/convergent-audit-weekly.mjs` (#6420 lane D:
every Monday, 60 random non-English books plus 20 pages lane B wrote, read by Opus and Gemini). None gives
one lookup from a KIND of page to its reader, and the weekly audit does not sample by lane, so it cannot say
which reader a bad page came from. This file is the lookup and the audit's specification (#6688).

**Read this when** you are about to OCR a book and need to know which reader to use, when you want to
propose a new OCR benchmark, or when you build or change the weekly audit.

## The table

The rows live in `scripts/lib/ocr-routing-table.json` and nowhere else.

- Code: `scripts/lib/ocr-routing.mjs` exports them as `OCR_ROUTING_TABLE` and `ocrRouteForKind(id)`.
- Readers: `/quality` ("Who reads which page") renders `kind`, `reader`, `why` and the evidence link of the same rows.
- This section is generated: `node scripts/eval/build-routing-table.mjs` (`--check` exits 1 when it is stale).
- `tests/unit/ocr-routing-table.test.ts` fails when this section is stale, when the page stops reading the
  JSON, when an evidence file is missing, or when a row's `code` claim disagrees with the live router
  (`getOcrModelForBook`) or names a lane file that does not exist.

The table **records** what the evidence settled. It does not route: `getOcrModelForBook` stays the only
Gemini router and each specialist lane selects its own books. A row marked `routed: no` is evidence
production has not acted on. That is a decision for Derek, not a bug to fix in passing.

To change a row, edit the JSON in the same PR as the experiment file that justifies it, then run the builder.

<!-- BEGIN GENERATED ocr-routing-table: scripts/eval/build-routing-table.mjs writes this section from scripts/lib/ocr-routing-table.json. Do not edit it by hand. -->

As of 2026-10-13 (#6688). Status: settled = measured and decided; provisional = decided on thin or by-eye evidence; open = no reader chosen on evidence yet. Routed: whether production does this today.

| page kind (`id`) | reader | status · routed | production today | evidence |
|---|---|---|---|---|
| Printed books in Latin, English, German, French and other languages in the Latin alphabet (`latin-script-print`) | Gemini 3.1 Flash-Lite | settled · yes | getOcrModelForBook returns lite for every Latin-script language (and, under OCR_LITE_ONLY, for everything not in FLASH_OCR_FROM). Batch API. | `scripts/eval/experiments/2026-10-07-ocr-engines-full-sets-wave2-6011.md` (147 Latin pages, 2026-10-07); `scripts/eval/experiments/2026-10-06-untried-ocr-engines-wave1-6011.md` (385 pages, one per book, 2026-10-06); `scripts/eval/experiments/2026-10-04-latin-print-by-century-5126.md` (82 books, 2026-10-04); `scripts/eval/experiments/2026-10-06-latin-print-r4-by-book-5924.md` (97 books, 2026-10-06) |
| Printed Greek (`greek-print`) | Gemini 3 Flash | settled · partly | FLASH_OCR_FROM.grc: visible Greek books and Greek books created from 2026-10-02 read on gemini-3-flash-preview (Derek, #5575). The hidden Greek backlog stays on lite until its language labels are fixed (#4884). | `scripts/eval/experiments/2026-10-07-ocr-engines-full-sets-wave2-6011.md` (127 Greek pages, 2026-10-07); `scripts/eval/experiments/2026-10-06-untried-ocr-engines-wave1-6011.md` (60 Greek pages, 2026-10-06); `scripts/eval/experiments/2026-10-06-greek-reocr-production-5813.md` (119,978 pages in 540 books re-read, 2026-10-06) |
| Printed Persian, Sanskrit, Pali and Arabic (`persian-sanskrit-pali-arabic-print`) | Gemini 3 Flash | provisional · partly | FLASH_OCR_FROM fas/san/pli/ara/gez: visible and new books read on gemini-3-flash-preview (PR #5760). Persian's hidden backlog too (FLASH_OCR_INCLUDES_HIDDEN, Derek 2026-10-04). Ge'ez is routed the same way on agreement evidence only (0.47 with flash, 9 of 20 pages catastrophic on lite, #4729). | `scripts/eval/experiments/2026-10-04-reocr-lift-5700.md` (93 pages, one per book; 6 Persian, 10 Sanskrit, 6 Pali, 9 Arabic, 2026-10-04); `scripts/eval/experiments/2026-10-04-hidden-flash-5795.md` (117 pages, one per book, 2026-10-04) |
| Handwritten pages (manuscripts) (`manuscripts`) | Claude Opus | settled · no | Not routed. Manuscripts still go to lite through getOcrModelForBook (the BPH and non-Latin carve-outs are unreachable under OCR_LITE_ONLY, #4877). The reader exists: scripts/batch/claude-ocr.mjs (claude -p, subscription, 10 pages per call), written by cli-ocr.mjs apply. Gemini 3.1 Pro was withdrawn from the agy CLI on 2026-10-12, so it is not an option. | #6544 (write-up in PR #6605) (76 pages with expert transcriptions, plus 40 of our own, 2026-10-12) |
| Nahuatl and Mayan-language books (print and manuscript) (`nahuatl-mayan`) | Claude Opus | provisional · yes | By hand: scripts/batch/claude-ocr.mjs read, cli-ocr.mjs apply --mark-stale=opus-ocr-6559. 11,843 pages written 2026-10-13 on Derek's call (#6559), every one empty before. No scheduled lane selects these books. | `scripts/eval/experiments/2026-10-12-nahuatl-maya-ocr-cli-6559.md` (18 pages, one per book, 2026-10-12); `scripts/eval/experiments/2026-10-13-opus-ocr-calibration-6559.md` (15 pages in 3 books, 2026-10-13) |
| Chinese: the Siku Quanshu, a library copied by hand in regular script (`chinese-siku-manuscript`) | PaddleOCR-VL | settled · yes | scripts/lib/paddle-zh-lane.mjs (ocr.source 'paddle'), run by hand on a leased GPU over fixed book lists (#5600, #5660, #6388); 1.57M pages written. Not in lanes.mjs, and no scheduled lane selects its books: they are held. Measured 2026-10-13 from books.pages_count − pages_ocr: about 68K unread Chinese pages sit in books held for this lane (holds gpu-backlog-5660, paddle-zh-5600-ocr-only, paddle-zh-6388-*) and wait for its next run. | `scripts/eval/experiments/2026-10-01-chinese-ocr-cohort-5547.md` (433 books, one page each, 2026-10-01); `scripts/eval/experiments/2026-10-10-paddle-zh-random-qa-6388.md` (60 books, one page each, 2026-10-10); `scripts/eval/experiments/2026-10-07-ocr-engines-full-sets-wave2-6011.md` (503 Chinese manuscript pages, 2026-10-07) |
| Chinese pages with tables and diagrams (`chinese-tables`) | PaddleOCR-VL, then Claude Opus corrects the draft against the image | settled · partly | The 4,379 flagged pages are ocr.unreadable (reason paddle_table_6388). Job table-correct-6561 is correcting them to files; nothing is written until the Gemini review. Only Opus corrects: Sonnet and Haiku were tested and rejected (#6667). | `scripts/eval/experiments/2026-10-12-paddle-zh-correct-vs-redo-6561.md` (100 pages, one per book (40 table pages), 2026-10-12); `scripts/eval/experiments/2026-10-11-paddle-zh-table-detector-6388.md` (1,568,108 pages screened, 136 known cases, 2026-10-11); `scripts/eval/experiments/2026-10-12-paddle-zh-table-opus-reread-pilot-6388.md` (100 pages, one per book, 2026-10-12); `scripts/eval/experiments/2026-10-13-sonnet-haiku-correct-vs-opus-6667.md` (40 table pages, 2026-10-13) |
| Chinese woodblock and typeset print outside the Siku Quanshu (`chinese-print`) | Gemini 3.1 Flash-Lite, for now | open · yes | lite through getOcrModelForBook. Chinese is deliberately not in FLASH_OCR_FROM (it waits for #5574, Paddle against flash off the Siku Quanshu). Measured 2026-10-13 from books.pages_count − pages_ocr, about 339K Chinese pages are unread: about 82K in books at archive_complete with no hold, which the scheduled Gemini lane (orchestrator-ocr) will read on lite; about 68K held for the Paddle lane (row chinese-siku-manuscript); about 102K in books already marked complete and about 63K in needs_attention, which no lane selects; the rest parked or held images-only. | `scripts/eval/experiments/2026-10-07-ocr-engines-full-sets-wave2-6011.md` (19 Chinese print pages, 2026-10-07) |
| Tibetan (`tibetan`) | BDRC Yigdzin, a reader built for Tibetan | settled · yes | Per-leaf Yigdzin read, verdicts applied by scripts/maintenance/apply-reocr-verdicts.mjs (ocr.source 'bdrc'). Lite is unusable as a Tibetan reader (#4523). A correction pass is an open decision on #6560. | `scripts/eval/experiments/2026-10-06-untried-ocr-engines-wave1-6011.md` (60 Kangyur pages, 2026-10-06); `scripts/eval/experiments/2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md` (30 folios, one per book, 2026-10-12); `scripts/eval/experiments/2026-10-04-tibetan-lite-vs-yigdzin-4523.md` (494 books, one page each, 2026-10-04) |
| Syriac (`syriac`) | Kraken, an open-source reader, with a model trained on Syriac | settled · yes | scripts/lib/syriac-kraken-lane.mjs on Hetzner CPU (ocr.source 'kraken'). Never Gemini (Derek, #4883). | `scripts/eval/experiments/2026-10-08-syriac-print-pareto-6295.md` (20 books, one page each, 2026-10-08); `scripts/eval/experiments/2026-10-08-syriac-cli-flash-tiers-6295.md` (20 books, one page each, 2026-10-08); `scripts/eval/experiments/2026-09-16-syriac-retest-do-the-beth-mardutho-kraken-models-read-4746.md` (40 pages of 2 manuscripts, 2026-09-16) |
| Japanese cursive writing before 1868 (`japanese-cursive`) | NDL Koten OCR, the National Diet Library's reader for classical Japanese | provisional · partly | scripts/lib/ndl-koten-lane.mjs (ocr.source 'ndl-koten'), pilot of 20 books (PR #5412); no standing lane (#5100). Typeset Japanese is unmeasured and reads on lite. | `scripts/eval/experiments/2026-09-30-ndl-classical-ocr-lane-20-book-pilot-written-and-4925.md` (20 books, 10 pages read by eye, 2026-09-30); `scripts/eval/experiments/2026-09-15-does-any-current-specialist-ocr-engine-beat-flash-lite-4743.md` (45 cursive pages, one per book, 2026-09-15) |
| A page Gemini declines to read because it recognises a famous published text (`refused-pages`) | A second try, then MinerU (an open-source reader) for English printed after 1820, then the Internet Archive's own text if a person has checked it | settled · yes | The RECITATION ladder (ocr-lane-decision-tree.md, branch 3): lite again, flash (= lite under OCR_LITE_ONLY, ocrEscalationModel), scripts/workers/mineru-ocr-worker.mjs (1820+ only: before that it reads the long s as f), ia-ocr-ingest under a by-eye verdict, then by eye. | `scripts/eval/experiments/2026-09-30-mineru-on-the-english-reference-pages-peer-engine-tier-5182.md` (114 books, one page each, 2026-09-30); `scripts/eval/experiments/2026-09-30-later-post-hoc-the-same-mineru-rule-re-applied-5299.md` (114 books, 122 pages, 2026-09-30); `scripts/eval/experiments/2026-09-30-which-engine-reads-printed-numbers-correctly-engine-disagreements-adjudicated-5224.md` (82 books, 5,212 numbers, 2026-09-30) |
| A page where two readings disagree (`two-reads-disagree`) | Claude Opus compares both with the image and decides; Gemini checks a sample of the changes | settled · partly | scripts/batch/ocr-convergence/driver.mjs (#6420 lane B): Gemini CLI second read, Opus adjudicates every disagreement, a two-family audit gates the writes. Run on the 200 most-read non-English books; not a standing lane for the whole library. | `scripts/eval/experiments/2026-10-10-ocr-convergence-gate-6420.md` (50 books, 360 pages, 2026-10-10); `scripts/eval/experiments/2026-09-30-does-disagreement-between-two-reads-of-one-page-find-5313.md` (327 books, one page each, 2026-09-30) |
| A page that already has a text from a specialist reader, with some errors (`correct-not-redo`) | Claude Opus corrects the existing text against the image; the page is not read again from nothing | settled · partly | Applied to the Chinese table pages only (job table-correct-6561, files, not yet written). Tibetan correction is an open decision on #6560. For manuscripts a correction pass was no better than Opus alone (#6544), so this row covers specialist drafts only. | `scripts/eval/experiments/2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md` (30 folios, one per book, 2026-10-12); `scripts/eval/experiments/2026-10-12-paddle-zh-correct-vs-redo-6561.md` (100 pages, one per book, 2026-10-12); `scripts/eval/experiments/2026-10-13-sonnet-haiku-correct-vs-opus-6667.md` (130 pages, one per book, 2026-10-13) |

Tested and not adopted:

- **Other engines for print in the Latin alphabet and Greek (PaddleOCR-VL, olmOCR, GLM-OCR, Chandra, DeepSeek-OCR, Qwen3-VL, Mistral OCR).** None read Latin or Greek print better than Gemini 3 Flash. olmOCR read English of 1600 to 1699 better than Flash-Lite, but it was not adopted and the lanes on our own GPU were stopped (#5660, #5924, #6011).
- **Claude Sonnet and Haiku as correctors.** Neither corrects a draft as well as Opus (#6667).
- **Gemini 3.1 Pro.** No longer offered by the subscription tool we use (since 12 October 2026). Where measured, it did not beat Opus on manuscripts (#6544) and made 21 of 40 Chinese table pages worse (#6561).
- **Any general model as a Tibetan or Syriac reader.** They write text that is not on the page, or write out a known edition instead of reading the page (#4523, #4883, #6011).

<!-- END GENERATED ocr-routing-table -->

## When a new benchmark is allowed

Derek, 2026-10-13: "we've done so many tests, have we really learned anything?" The table is the answer for
transcription, and the weekly audit below replaces new benchmarks as the standing measurement. A new OCR
benchmark is allowed only when it could change a row:

1. the audit flags a lane (rule below);
2. a reader's model changes: a new version ships, or one is withdrawn (as Gemini 3.1 Pro and 3.7 Flash were
   from `agy` on 2026-10-12);
3. the row is `open` or `provisional`, and the test is the one that would settle it;
4. a kind of page enters the library that no row covers.

Say which row the test could change, and to what, in the brief. If no row would change, do not run it.

## The weekly audit (specification; not built, not scheduled)

**Question.** For each reader in the table: of the pages it wrote that a reader of the site can see, how many
books have a serious error, and of what kind?

**Why it is not the existing Monday audit.** `convergent-audit-weekly.mjs` draws 60 random visible non-English
books. That is a rate for the library, weighted to the largest lanes: most weeks it holds no Syriac, Tibetan
or Opus-read page. This audit draws the same number of books from **each** lane, so every reader gets a rate.

**Draw.** Weekly, a new seed each week (the ISO date, recorded). For each row of the table whose `audit.select`
names a lane (`ocr.source` and `ocr.model` stamps, plus the book's language family or class):

- 10 books at random, **one page per book** (pages of one book are one observation);
- draw a book first, then a uniform page among its eligible pages, and keep it if the page carries the lane's
  stamps; record how many draws were rejected. No full scan of `pages`;
- eligible as in the Monday audit: `ocr.data` of 200 characters or more, not a blank, title, contents, index,
  plate or cover page; the image is downloaded and its sha256 recorded;
- record each page's **exposure** when it is drawn (`exposureOf()`, `scripts/lib/review-vocabulary.mjs`): the
  headline counts served text only; hidden and withheld pages are reported separately;
- 1 packet in 10 carries one planted error (a dropped line, an invented line or a respelled word, as in
  `scripts/eval/second-reader/`), so the reviewer has a measured catch rate each week.

At today's table that is 12 lanes (two rows are covered by another row's stratum), about 120 pages a week.

**Reviewer.** The other model family from the reader, with the page image and the stored text, on the frozen
#6338 brief (`scripts/eval/second-reader/REVIEWER.md` + `CALIBRATION-ADDENDUM.md`):

| the page was read by | reviewed by |
|---|---|
| Gemini (Flash-Lite, 3 Flash, any CLI tier) | Claude Opus |
| Claude Opus | Gemini (the strongest tier `agy` offers that week, named in the report) |
| a specialist engine (PaddleOCR, Yigdzin, Kraken, NDL, MinerU, the Archive's text) | both, so agreement between the two can be reported |

**Subscription CLIs only, never an API.** Claude through `claude -p` in a sealed folder
(`scripts/eval/second-reader/run-readers.sh`, with the API key stripped from the environment as
`ocr-convergence/driver.mjs` `claudeEnv()` does). Gemini through `agy -p --mode plan`
(`scripts/eval/run-cli-arm.py --no-tool-gate`, one page per call, logged to the shared `agy` call meter). If a
CLI is out of quota the run waits and retries as the Monday audit does; it never falls back to a paid key.
About 100 Claude calls and 90 Gemini calls a week.

**Report.** One comment a week on the tracking issue, and `report.json` on the job volume. Per lane:

- **k of n books** with a serious error, with a Wilson 95% interval (`kOfNBooks()`, `formatKOfN()`), served
  text only;
- the same **by kind** (`.claude/docs/review-vocabulary.md`): the six "text not on the leaf" kinds as one
  count and each by name (`confabulation`, `recitation`, `wrong_leaf`, `carry_over`, `show_through`,
  `illegible_fill`), then `misread`, `omission`, `layout`, `other`. Never "invented" for the six together
  without the split;
- a rolling four-week figure beside the week's (40 books a lane), because 10 books cannot carry a rate alone:
  below 30 books the report says "too few books" and gives the count only;
- planted errors caught, per reviewer. A reviewer that caught fewer than 2 of 3, or read under 80% of its
  pages, is named with the reason and its rates are left out (`readerStatus()`, as on Mondays);
- for the two-reviewer lanes, agreement on serious / not serious.

A model reviewer's verdict is a model's opinion. The report says "AI reviewers" and names them.

**When the audit flags a lane.** Either: 2 or more books in the four-week window with text not on the leaf; or
the four-week serious-error interval lies wholly above the previous window's. A flag opens ONE issue for the
lane (and closes it when a later window passes). It allows a benchmark under rule 1 above. It changes no
routing by itself.

**What it writes, and what reads that.** Read-only on Mongo. It writes the GitHub comment and files on the
job volume. No automated job reads either, so nothing is actuated. A page found with text not on the leaf is
listed at the top of the comment with its link, for a session to contain under
`.claude/docs/invariants/containment-on-finding.md`; the audit holds and withholds nothing itself.

**How to build it.** Add a `--lanes` draw to `scripts/audit/convergent-audit-weekly.mjs` that reads
`OCR_ROUTING_TABLE.rows[].audit`, and a per-lane, by-kind section to its `score` step. The readers, the
packet format, the quota retries and the posting already exist there. Then one cron line beside the Monday
one (installed by hand; it is Derek's decision on #6688):

```
30 9 * * 1 /root/sourcelibrary/scripts/audit/convergent-audit-weekly.sh --lanes >> /var/log/sourcelibrary/ocr-routing-audit.log 2>&1
```

09:30 UTC on Monday, after the 06:00 audit has finished and the Gemini quota has reset (it ran out at 03:30 and
reset at 06:35 on 2026-10-12).
