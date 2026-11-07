---
stage: ocr
measure: [judged]
languages: [deu, lat, fra, ara]
scripts: [Latn, Arab]
canons: []
n_books: 21
n_pages: 76
verdict: "@./file attaches nothing in agy -p 1.4.8; the read_file turn is the read. The waste was a denied run_command turn on every call. The read-file-7558 prompt names the file and the one tool: input tokens per page 27.5K -> 17.5K at 1/call, 14.0K -> 6.8K at 4/call, with usable 53/56 -> 53/56 (1/call) and 56/56 -> 54/56 (4/call) on German/Latin print. On Arabic manuscripts (the held queue) 1/call on the new prompt was the best arm (16/20; 4/call 15/20). The lite>agy-flash-low correction lane wrote 418 of 696 pages in 47 min (131 UNCHANGED, 4 CONTAIN claims not confirmed by eye, 143 held, mostly by the 25% change guard catching dropped passages), at about 1.3e-5 of the pool's week per page (noisy)."
status: adopted
decision: "Lane runs read-file-7558: 4/call on Latin-script print, 1/call on Arabic and every other script, 4 books at a time, 95 min deadline. New correction lane on German/French Flash-Lite drafts behind a quota floor (weekly under the straight line to reset, or 5 h under 25%). cli-ocr.mjs's default prompt is unchanged."
superseded_by: null
issue: [7558, 7520, 7522]
---
PRIOR ART: `2026-10-27-agy-ocr-pages-per-call-7522.md` (the 1 vs 2 vs 4 pages-a-call arms, their draw and judge, reused
here) and `2026-10-27-flash-low-fresh-vs-lite-7517.md` (the 3-turns / ~34K-input finding and the "view_file-free
prompt" this tests). The correction route's quality is the router tests' (`estimator/router-table/2026-10-26-router-tests.md`),
not re-judged here.

## 2026-10-27 · Can agy OCR read more pages from the same quota, and where should the spare quota go? (#7558)

**Why.** The main agy pool (Ultra) was about two-thirds used: 63% of the Gemini week left at 16:00Z on 2026-10-27, with
the reset at 2026-10-30 22:00Z. The straight line to the reset was 46%. In the last 24 h the pool spent ~9.5% of a week
a day against ~14% affordable. Derek, 2026-10-27: "more pages and 4 pages". Everything here is agy (Gemini 3.8 Flash low)
on the main pool, $0 API. The judge is Opus via `claude -p`.

**1. The view_file turn is not redundant** (`agy-read-file-7558/attach-probe.mjs`, 2 pages, agy 1.4.8).
- With read_file denied, the model answered "The image @./page.jpg is not present in the message context" (both
  pages). `@./file` puts a path in the prompt, not an image.
- `--input-format=stream-json` refuses an image content block: `stream input content block type "image" is not
  supported (only "text")`.
- So the model sees a page only through its own read_file turn. That turn is the read.
- What a call does waste: the old sentence ("The page image to transcribe is attached: @./p.jpg") sent the model to
  try a shell first on **every** call (`run_command:deny`, 56/56), so the whole context was sent once more.
- Telling it "do not call any tool" did not stop the read_file call. Naming the file and the one tool did.
  `cli-ocr.mjs --prompt-variant=read-file-7558` says "the file ./p.jpg in this directory. Open it with read_file (or
  view_file): that is the only tool available here, and running commands, cropping or any other tool is disabled."

**2. A/B on German/Latin print** (`agy-read-file-7558/`, `results/de-la-56/`). The 56 pages are #7522's draw, 14 books
× 4 consecutive pages, minus the contained Jung book. Every arm read all 56 pages fresh (`--fresh`,
`CANDIDATE_READS=off`). The judge was #7522's `judge.mjs`, blind and one page per call with its neighbours. Controls
were 4 plants in a copy of a new-1/call read (2 dropped lines, 2 lines bled in from the next page): **4/4 caught**.

| arm | usable (Wilson 95%) | omission | addition | order | input tok / page | uncached | out | denied-tool turns |
|---|---|---|---|---|---|---|---|---|
| old 1/call (production) | **53/56** [85–98] | 1 | 2 | 1 | 27,541 | 20,579 | 1,731 | 56 |
| new 1/call | **53/56** [85–98] | 2 | 1 | 1 | **17,486** | 11,829 | 878 | 0 |
| old 4/call | **56/56** [94–100] | 0 | 1 | 1 | 14,040 | 10,417 | 915 | 14 |
| new 4/call | **54/56** [88–99] | 0 | 1 | 3 | **6,789** | 4,976 | 897 | 2 |

- Paired by page: at 1/call, new is worse on 3 pages and better on 3. At 4/call, new is worse on 2 and better on 0.
- The two 4/call misses are table pages: the two-column footnotes of Irenaeus p.527 and the Gaurico grammar table
  p.109. #7522's 1/call arms also failed the Gaurico page.
- Against what the lane ran before (old prompt, 1/call), new 4/call is 54 vs 53 usable at **0.25× the input**.
- Bleed was 0 in every arm, as in #7522.

**3. Arabic, the held queue** (`draw-arabic.mjs`, `results/arabic-20/`). Frame: the 568 Arabic-script books held for
the CLI OCR lane. On 2026-10-27 the lane's readable queue was 439 Arabic books (2,591 pages) and 1 Sanskrit book (8
pages). Draw: 5 books × 4 consecutive interior pages, seed 7558. **All 5 are handwritten**, so this queue is
manuscripts, not the Arabic print that #7341's Kraus test measured. Controls 4/4.

| arm | usable | omission | addition | input tok / page | calls |
|---|---|---|---|---|---|
| old 1/call (production) | 13/20 | 3 | 7 | 32,665 | 23 |
| new 1/call | **16/20** | 2 | 5 | 19,138 | 22 |
| old 4/call | 14/20 | 7 | 6 | 18,927 | 10 |
| new 4/call | 15/20 | 1 | 5 | 8,590 | 9 |

- The additions are word- and phrase-level misreads, plus Gemini filter-block messages. The wrapper guard refuses a
  reply cut before `<<<END>>>` at write.
- At 4/call two phrases appear that are on none of the three pages (Bahr-al-Jawahar p.6, Tanwir p.7). 1/call had none
  of that kind.
- One 4-page block (Bahr-al-Jawahar pp.6–9) was cut mid-reply in both 4/call arms. The strict marker split refused
  it, and its pages were read one at a time.
- No page carried another page's text or a whole invented page, so there was no containment.
- **Arabic stays at 1/call** (on the new prompt). The pool's problem is unused quota, not tokens.
- Not settled: whether Flash-low should read these manuscripts at all (old 1/call: 13/20 usable). That is #7341's
  routing, measured on print.

**4. The correction queue, and a lane for it** (`cli-ocr-lane.mjs correct`).
- **Route.** lite>agy-flash-low, from the 2026-10-26 router tests:

  | cell | lite>agy-flash-low accepted | wrong text | served lite draft accepted | wrong text |
  |---|---|---|---|---|
  | German | 28/30 | 2/30 | 21/30 | 5/30 |
  | French | 27/29 | 2/29 | 22/30 | 6/30 |

  The router itself prefers lite>opus for German (28/30, 1/30 wrong): agy's 2/30 misses its +2% wrong-text bar.
  Opus cannot run at this scale on Claude points. So this lane improves on what is served, and does not rule out an
  Opus pass later.
- **Frame:** the router test's. A visible, idle German or French book that is not held. A page whose OCR is a
  Flash-Lite draft of 300+ characters, not handwritten, not human-edited, not withheld, interior (15–95% of the book).
- **Queue: 335,862 pages** (German 250,041 in 1,299 books; French 85,821 in 376). Before those filters, the same books
  hold 609,722 lite pages (571,033 in visible books).
- **Three bugs found before the first write.**
  - `apply` had no handling for the template's `UNCHANGED` / `CONTAIN:` answers: it would have written the word as OCR.
  - The header check summed `<page-type>` and `<scan-quality>`. That refused 24/24 pilot corrections of drafts that
    have `<page-type>` but no `<scan-quality>`.
  - Two parallel applies in the same second shared a run id.
- **Measured run on gex45, 2026-10-27 16:38–17:25Z.** 3 books at a time, 40-page chunks, `--apply`:
  - 696 pages taken: **418 written (60%), 131 UNCHANGED (19%), 4 CONTAIN, 143 held (21%)**.
  - The held ones are almost all the 25% change guard. Checked: Mysterium Magnum p.518's correction has 179 words
    against the draft's 431, a ~250-word passage dropped, and the guard held it. Those pages stay on the lite draft.
  - The 4 CONTAIN claims are all in one book (`6a2121ed…40a2`). By eye (p.13), the image is an unsplit two-page spread
    and the draft is that image's own text in two columns. Not invented, not wrong-leaf: a split problem, not a
    containment.
  - By eye, Mysterium Magnum p.513: the correction changed 5 words, 4 to the print's reading (*Essentz*, *gebiehret*,
    *Wurtzel*, *Eigenschafft*) and 1 away from it (*ihn* → *ihm*).
  - With the 24-page pilot: 440 pages written, stamped `ocr.pipeline=agy-correct-lite-7558`. Each run can be undone
    with `revert-run.mjs --run-id cli-ocr-…`.
- **Throughput:** 14.8 pages/min at 3 books, about 1,400 per 95-minute cron run, or ~16,800 a day at 12 runs.

**5. Quota per page (noisy).**
- Gemini weekly remaining went 61.97% (16:38:27Z) → 60.78% (17:26Z) over the run: 1.19 pts.
- Taking out the pool's other traffic at its 24 h average (~9.5%/day ≈ 0.31 pts in 47 min) leaves **~0.9 pts for 696
  correction pages ≈ 1.3e-5 of a week per page**.
- `/quota` readings seconds apart jump by ~0.5 pt (seen here and in #7498), and other boxes share the pool without a
  shared ledger. Treat this as ±50%.
- Token cost of one correction call: ~33K input, ~1K output, because the #5924 template still pays the denied-shell
  turn. It was kept as judged; a read-file variant of the template is untested.

**Pages a day, before and after** (main pool; the held lane plus the new correction lane).

| | before (2026-10-26/27) | after |
|---|---|---|
| CLI OCR lane (held books) | ≤120 pages / 2 h run, 1 at a time (~1,440/day cap; ~38 min of 110 used) | up to ~2,300 / run (4 books, deadline 95 min); queue 2,599 pages, drained in ~2 runs |
| input tokens / page, print | 27.5K (old prompt, 1/call) | 6.8K (new prompt, 4/call) |
| input tokens / page, Arabic | 32.7K (old, 1/call) | 19.1K (new, 1/call) |
| correction lane | none | ~1,400 / run ceiling. At the quota floor: ~3,800/day steady (4.8 pts/day of spare pace ÷ 1.3e-5), plus ~12,000 pages to spend the 15 pts the pool is ahead of its line before the 10-30 reset |

**Caveats.**
- n = 56 and 20: differences under ~10 points cannot be detected.
- Quota per page is one noisy measurement on a shared pool.
- The correction lane's quality is the router test's (n = 30 per cell), not re-judged. Its UNCHANGED, CONTAIN and
  held rates come from 696 pages of the first books in queue order.
- Watch the ledger's outcome mix for drift.
