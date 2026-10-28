---
stage: ocr
measure: judged
languages: [zh, de, grc]
scripts: [Hani, Latf, Grek]
canons: []
n_books: 30
n_pages: 750
verdict: "Preregistration only: per language (Chinese, German, Greek), 10 lite-read books × 25 spread pages, three arms (stored lite L, Opus correction of L C, agy Flash re-read R), one blind Opus reader per book judging all three against the image, and a 30-page agy second-family check on C vs R. No result here."
status: superseded
decision: null
superseded_by: "2026-10-28-correct-vs-reread-wave1-zh-de-grc-7568.md"
issue: [7568]
---
PRIOR ART: `2026-10-24-latin-lite-opus-correct-vs-flash-reread-5924.md` (the Latin result this repeats in three more languages: misleading L 111 / Opus correction 31 / Flash re-read 20–32 of 250), `2026-10-24-latin-lite-flash-correct-four-arms-5924.md` (the second-family agy judge, `fc-judge.mjs`), and the harness in `scripts/eval/flash-reread-5924/` (draw rule, `correct.mjs` run unchanged, `cli-ocr.mjs read` unchanged, `C-TASK.md` verdict words, `crop.mjs`, the scorers' measures), reused.

## 2026-10-27 · Preregistration: correct the lite text with Opus, or re-read with Flash — Chinese, German, Greek (#7568, wave 1)

Written and committed **before any draw, correction, re-read or judgment** (job `correct-vs-reread-7568`, gex45).
Grade: **exploratory** (10 books per language, eval-design §10.2): a result can recommend a route with its price,
nothing is applied. **No production write to `pages` or `books`.** Corrections and re-reads are kept in R2
`candidate-reads/` by the scripts' own keep-read path (#7075), which is not a page write.

### Question
On lite-read Latin, Opus correcting the stored lite text in place beat a Flash re-read. Does that hold for Chinese,
German and Greek? Per language: which route upgrades a lite page — **C** (Opus corrects the lite text) or **R**
(Flash re-reads the image) — or neither?

### Sample (per language, one language at a time: zh, then de, then el)
- `flash-reread-5924/w-draw.mjs`, `LANG7568=<lang>`. Frame: visible books with `pipeline_auto.status: complete`
  (terminal), `language` in the language's names (zh: Chinese, Classical Chinese; de: German, de; el: Greek,
  Ancient Greek, grc), not `duplicate_of`, not catalogued manuscript, ≥ 50 OCR pages. Mulberry32 seed zh 75681,
  de 75682, el 75683 shuffles the frame (sorted by book id).
- In shuffled order a book is a candidate when ≥ 70% of its OCR'd pages are flash-lite reads, ≥ 50 pages are eligible
  body pages (page_type text/null, flash-lite, ≥ 400 letters — **150 for zh**, where a half-leaf holds ~200
  characters — and an image), and the script check passes on a sample of its eligible text (zh: ≥ 60% Han letters;
  de: the stopword classifier says German; el: ≥ 60% Greek letters). 14 candidates are drawn.
- **Format screen** (one Opus reader per language, 2 drawn pages per candidate — the 8th and the 18th of 25 — image
  only): drops a candidate that is a manuscript, not this language's print (woodblock and lithograph count as
  print), or not a text page. The **first 10 that pass** are the sample.
- Pages: `spread` over the eligible pages, `v[floor((i + 0.5) · n / 25)]`, 25 per book = 250 per language. A page
  whose stored `ocr.data` changed since the draw, or whose image fails to download, is dropped and listed.

### Arms
- **L** — the stored lite OCR (what readers are served today).
- **C** — `scripts/batch/ocr-convergence/correct.mjs --model=opus --per-call=10 --concurrency=3`, unchanged (live OCR
  prompt + correction block, sealed `claude -p --restricted --tools Read`, opened-files check, chatter guard).
  C serves the correction where the outcome is `corrected`, else L (as #5924).
- **R** — `scripts/batch/cli-ocr.mjs read --model=gemini-3.8-flash-low`, unchanged defaults (one page per call, live
  OCR prompt, tool gate), `--concurrency=3`. `apply` is never called. A page R fails to read is judged as an empty
  transcription and counts as **R worse**.
- Opus runs only through `claude -p` (subscription); Gemini Flash only through `agy`. No paid-API call, no fallback.

### Judgment: Step T (blind, three transcriptions, one reader)
- One fresh Opus subagent per book, `T-TASK.md`: image (crop helper for zoom) and the three texts labelled X/Y/Z,
  the arm order one of the 6 permutations drawn per page with Mulberry32(seed + 1) in sample order. Verdict per text
  (misleading / flawed / sound, `C-TASK.md`'s definitions verbatim) and the three pairwise preferences with
  `loser_material`. Language conventions (`lang_note` in T-TASK) say what is minor in that script.
- Change from #5924: Latin used one reader per pair (Step C L–F, C2 O–L, C3 O–F). Here one reader judges all three
  arms of a page together, so every arm's verdict comes from the same reader under the same conditions (in #5924 the
  same F text was called misleading 20 times next to L and 32 times next to O). Where C = L by text, both are shown;
  differing verdicts on identical texts are counted as a reader-noise check.
- Controls: no arm names in packets; readers see no key, no other packet; keys only in the job scratch, read by the
  scorer (`w-score.mjs`).
- **(d) second-family check, not a bar:** agy `gemini-3.8-flash-low` judges C vs R blind on 30 pages per language
  (Mulberry32(seed + 3) over the pages where C ≠ R, X/Y from Mulberry32(seed + 4); `w-judge2.mjs`). Opus judging an
  Opus correction may favour C; Gemini judging a Gemini read may favour R. **Self-preference is suspected** when the
  two families' C-vs-R preferences on those pages point opposite ways.

### Measures and bars (per language, pooled over its pages; Wilson 95%)
- misleading(L), misleading(C), misleading(R) from Step T.
- **(a) halves:** misleading(arm) ≤ ½ · misleading(L), per arm.
- **(b) no page worse than L**, per arm: arm misleading and L not; or L preferred over the arm with a material loss;
  C `no-answer`, or a false contain (contain where the reader did not mark L `not_this_leaf`); R unread. Every page
  listed.
- **(c) C vs R:** misleading(C) ≤ misleading(R) and C preferred over R on more pages than R over C.
- **Route per language** (the recommendation):
  - misleading(L) ≤ 2% of pages → **leave lite** (no upgrade worth its price).
  - else **C** when misleading(C) ≤ misleading(R) and the C/R preference favours C with a two-sided sign test
    p < 0.05 over non-tied pages; **R** symmetrically.
  - else **no clear answer**.
  - A winner that does not halve L is reported as "weak".
- Reported, not bars: per-book counts, contains, R refusals/filter cuts, books failing the 25-page check
  (≥ 2 misleading on L), facing-strip handling, and the (d) agreement.

### Cost
Claude: the box account's weekly % (`/root/.claude-limits/latest.json`, the `claude auth` account) before and after
each language's correction run and its readers, and the correction's token totals (`calls.jsonl`). Other jobs share
the account, so meter deltas are upper bounds. agy: calls per page. Projection in account-weeks per 1K pages.

### Stop rules
- Weekly Claude usage of the box account at **≥ 70%**: stop, comment on #7568 with a resume note.
- A language with < 6 books passing the screen runs on those it has, reported with its n; < 3 → the language is skipped
  and reported.
- A usage-limit stop in `correct.mjs` (exit 3) waits for the 5-hour window and resumes (it skips answered pages).
- **Wave 2** (Sanskrit, Arabic: seeds 75684, 75685, same design, its own preregistration amendment) runs only if at
  least one wave-1 language gets route C or R. Otherwise the job says so and stops.

### By eye (after scoring)
Per language, every page where the winning arm is worse than L, and 2 random pages where C and R differ
(Mulberry32(seed + 5)), opened against the image.

### Amendment 1 (2026-10-27, after the draws, before any model read)
- **Draw fix.** The script check and the letter count now run on the body with the OCR metadata block stripped
  (`stripOcrMetadata`). Before, `<page-type>text</page-type>` and the other tags counted as Latin letters and sank the
  Han share of short Chinese pages. This changes no seed and no rule.
- **Chinese: 5 books.** The terminal-status frame has 42 Chinese books with ≥ 50 OCR pages. Only 5 of them are lite
  reads in Chinese. The other lite-read books are an English translation (諸蕃志, 佛國記), Japanese-glossed (韓非子),
  stored refusals ("mojibake", 佛說無量壽經), or diagrams. Most Chinese lite pages are in `held` books, which the
  brief puts out of the frame. Per the stop rule (≥ 3 and < 6), Chinese runs on the 5 books that pass, n ≤ 125.
- **Greek: manuscripts stay in.** 12 of the 14 Greek candidates are catalogued or titled as manuscripts. In
  this frame, the lite-read Greek pages *are* mostly manuscripts. So the Greek screen drops only a candidate that is
  not Greek or not a text page, and keeps manuscripts. The result is reported split MS / print. (#6769 is
  pilot-testing an Argon re-read of Greek manuscripts. This job writes nothing, so the two do not collide.)

### Amendment 2 (2026-10-28, wave 2: Sanskrit and Arabic; before any wave-2 draw or read)
Wave 1 gave route C in all three languages, so wave 2 runs as the stop rule allows. The design is unchanged:
`w-draw.mjs` with seeds sa 75684 and ar 75685, frames named in its `LANGS`, the same arms, Step T, (d), bars and
route rule. Two settings carry over from amendment 1. First, the screen keeps manuscripts and reports the MS/print
split, because the lite frames outside Latin are mostly manuscripts. Second, a language with fewer than 6 books
runs on what it has (fewer than 3: skipped). A contain where the readers call L misleading is reported as a
justified contain beside the strict rule's count. The result goes in its own experiments file. Stop at 70% weekly.
