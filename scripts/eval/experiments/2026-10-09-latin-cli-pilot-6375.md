## 2026-10-09 · Latin OCR backlog: Gemini 3.7 Flash through the CLI against production flash-lite on 299 queue pages (#6375)

PRIOR ART: `2026-10-03-open-engine-print-5660.md` (#5924 round 4: Latin CER on referenced pages, no gothic; lite's
gap is long-s) and #6331 (CLI throughput and the nudge recipe). This run takes their two arms to the pages the
backlog would actually read. No new instrument: `run-cli-arm.py` for the CLI arm, `ocr-loop-guard.mjs` for loops,
Opus subagents for the by-eye read.

**Question.** Before any routing decision for the 6.9M-page Latin backlog: how does Gemini Flash through the
subscription CLI behave on real queue pages, gothic and blank leaves included, against production flash-lite?

**Prereg** `scripts/eval/PREREGISTRATION-latin-cli-pilot-6375.md`, commit c967fd0f9, pushed before any engine call.
Script `scripts/eval/latin-cli-pilot-6375.mjs`; artifacts `scripts/eval/results/latin-cli-pilot-6375/` (no OCR text
is committed; the outputs stay on the box under `/root/latin-cli-pilot-6375/`). Read stage only, no production writes.

### Setup
- **Sample.** Books with `pipeline_next.step = ocr`, language Latin (28,807 books, 7.5M pages). 50 books per century
  stratum (1400s, 1500s, 1600s, 1700s, 1800s+, undated), seeded. One interior page per book (skip the first and last
  5%), with no `ocr.data`. One image returned 404, so **n = 299**.
- **Not queue-weighted.** The 1800s+ stratum is 0.9% of the queue but 1/6 of the sample.
- **Arms**, on the same JPEGs:
  - **cli:** `gemini-3.7-flash-low` via `agy -p --mode plan --print-timeout 120s --output-format json`, one page per
    call, 4 parallel. It used the #6331 nudge. It never ran with `--dangerously-skip-permissions`.
  - **lite:** `gemini-3.1-flash-lite` via the API, with realtime-ocr.mjs settings.
  - Both arms got the same live prompt, "Standard OCR" v19.1.
- **Type label.** A lite one-word pass labelled each page roman, gothic, other or blank. Where a by-eye reader
  labelled a page, the reader's label replaced lite's.
- **By eye.** 40 pages were read against the image by Opus subagents (8 of them), blind A/B with a seeded swap,
  labelled `read-from-image`. Set rule: 10 blank/edge candidates first, then gothic up to 30, then the rest.
- **Spend.** Lite cost $0.896: $0.806 for OCR and $0.090 for the type pass, at list price. It is metered in
  `gemini_usage` under endpoint `scripts/eval/latin-cli-pilot-6375.mjs`. The CLI made 303 calls (299 plus 4 nudges)
  on the subscription, with no 429.

### Results — automatic, all 299 pages (2026-10-09)

Each cell is k/n (%, Wilson 95% CI). Type is the lite label with by-eye overrides: roman 239, gothic 46, other 14.

| measure | roman · lite | roman · cli | gothic · lite | gothic · cli |
|---|---|---|---|---|
| empty output | 8/239 (3.3% [1.7–6.5]) | 0/239 | 0/46 | 0/46 |
| refusal | 8/239 (3.3% [1.7–6.5]), all RECITATION | 3/239 (1.3% [0.4–3.6]) | 0/46 | 2/46 (4.3% [1.2–14.5]) |
| nudged | — | 2/239 | — | 1/46 |
| plan-note | 0 | 0 | 0 | 0 |
| repetition loop (guard) | 0/239 | 0/239 | **4/46 (8.7% [3.4–20.3])** | 0/46 |
| hit the 16K token cap | 1/239 (leader dots) | 0 | 4/46 (the same 4 loops) | 0 |
| pages with any ſ in output | 5/239 (2.1%) | 47/239 (19.7% [15.1–25.2]) | 0/46 | 1/46 |
| words written f where the other arm writes ſ | 252 | 0 | 9 | 0 |

- **What the refusals were.**
  - All 8 lite refusals are RECITATION on 19th–20th century editions in the queue. Examples: Loeb Caesar, Tyrrell &
    Purser's Cicero, a Catullus commentary, and *The Writings of George Washington*.
  - The CLI refused 6 times in all (1 on an "other" page): 2 safety blocks on incunables (*De pollutione nocturna*,
    1488; *Dispensarium*, 1497), and 4 mid-page switches. In each switch the CLI transcribes part of the page, then
    writes "I cannot provide a verbatim transcription…" and a summary. That happened on Tusculanae (1472),
    Almagestum (1515), Loeb Ovid and Washington.
  - **On the CLI, a refusal comes with text attached:** a summary sits beside part of the transcription. Any CLI
    lane needs a guard for it.
- The nudge was needed on 4 of 299 pages (1.3%), and all 4 came back with text.

### Results — by eye, 40 pages (Opus, read-from-image, 2026-10-09)

| measure | roman · lite | roman · cli | gothic · lite | gothic · cli |
|---|---|---|---|---|
| reader prefers this arm | 2/22 | **17/22 (77% [57–90])**, 3 ties | 1/15 | **14/15 (93% [70–99])** |
| pages with dropped lines (lines) | 7/22 (238; 6 of these are the RECITATION empties) | 3/22 (49) | **9/15 (200)** | 3/15 (44) |
| pages with invented text | 3/22 | 4/22 (3 are refusal summaries or a restarted pass) | **6/15** (repeated lines and loops) | 1/15 (a refusal summary) |
| ſ read as f, words in a 10-line window (pages) | **21 (9 pages)** | 1 (1) | **28 (8)** | 1 (1) |

- **Blank and edge leaves.** The readers found only 4 true blank leaves. Neither arm invented text on any of them
  (0/4 each, CI [0–49%]). #5924's "lite invents on blanks" is neither confirmed nor ruled out at this n.
- **Edge strips.** One lite page transcribed fragments of a facing-page edge strip as marginalia.
- **Roman text pages without the blank-candidate selection** (15):
  - Readers preferred cli on 11, lite on 2, and 2 were ties.
  - Lite's defects there are almost all ſ→f: 21 words, against 3 dropped lines and 3 invention pages.
  - The CLI dropped 23 lines on one page.
- **Type check.** The readers agreed with the lite label on 31 of 40 pages.
  - 3 of the 9 disagreements are blank leaves the readers called "other".
  - **Lite over-calls gothic:** 5 of the 20 pages it called gothic are roman by eye.

### Gothic share of the backlog, re-estimated
Gothic by lite label, per stratum: 1400s 76%, 1500s 10%, 1600s 2%, 1700s 4%, 1800s+ 2%, undated 0%. Weighted by
queue pages, that is **about 7% of the queue, roughly 0.5M of 7.5M pages**. Since lite over-calls gothic, this is
more likely an over-estimate than an under-estimate. #5924's "about 30% gothic by eye" was 65 books, not
page-weighted. At the #6331 ceiling of about 3,400 CLI pages a day, 0.5M pages is about 150 days on the current plan.

### Preregistered rule → outcome
- **Flash CLI for gothic: MET.**
  - The reader prefers cli on 14 of 15 decided gothic pages; the lower bound is 0.70, above the 0.5 bar.
  - CLI failures on gothic (empty, refusal, plan-note, loop) are 2/46 = 4.3%, within the 5% bar. The margin is thin:
    the CI is [1.2–14.5].
- **Lite + long-s for everything: NOT MET.** On roman pages ſ→f is lite's dominant defect, as the rule requires.
  But lite loses on gothic, and long-s does not explain why: lite loops on gothic and drops lines there.
- **Reading:** route gothic (mostly incunables) to Flash through the CLI. Keep lite for roman and add a long-s
  post-pass. "Dense" pages were not separated in this sample.

### Caveats
- These are AI readers, not a scholar. There are no references, so no CER.
- The by-eye set is 40 pages, and its blank-candidate rule pulled in 6 lite-empty RECITATION pages. Those inflate
  lite's roman dropped-line count, so read the 15-page roman subset above instead.
- The CLI arm is 3.7 Flash, as the brief set it. #6331 measured 3.8.
- The queue contains non-Latin and modern books labelled Latin: a Chinese Mozi, Loebs, Washington.

**Next.** A guard in any CLI OCR lane for mid-page "I cannot provide a verbatim transcription" switches. Fall back to
lite on the 2 safety blocks. A long-s post-pass on lite's roman output (#5924's Calamari route, or a dictionary pass).
