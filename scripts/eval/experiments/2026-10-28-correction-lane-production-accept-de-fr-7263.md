---
stage: ocr
measure: [judged]
languages: [de, fr]
scripts: [Latf, Latn]
canons: []
n_books: 79
n_pages: 157
verdict: "What the #7558 correction lane (agy 3.8 Flash-low correcting the Flash-Lite draft) now serves is accepted by the blind Opus judge on 74/84 German print pages (42 books) and 37/45 French print pages (23 books). Where the lane wrote its correction, the judge accepts 64/69 German and 26/28 French pages. The weak pages are the ones where a guard refused the correction and the Flash-Lite draft still stands: 10/15 German, 11/17 French. No German correction the lane wrote was worse than its draft. 2/28 French ones were: a wrong word and a wrong speaker label. Pooled with the router tests, lite>agy-flash-low reads 0.89 in German against Opus's 0.94. That is further below the Opus bar than before (P 0.80, was 0.89), so German stays keep. French stays switch → lite>agy-flash-low (0.88, n = 74)."
status: informational
decision: "Evidence only. Added to rules.json (german-lite and french-lite / lite>agy-flash-low; the German unguarded top-up as its own source); table rebuilt as router-table/2026-10-28-lane-accept-7263 (before: 2026-10-28-agy-gpu-7263). No cell's decision moves. ocr-routing-table.json and the lane config are untouched. 21 rejected lane pages are listed for a GPU-draft > agy retry (results/lane-accept-7263-2026-10-28/rejected-pages.json); none is corrected here."
superseded_by: null
issue: [7263, 7558, 7611]
router_evidence: [german-lite, french-lite]
---
## 2026-10-28 · The correction lane's production acceptance, German and French (#7263)

PRIOR ART: `2026-10-26-router-tests-idle-quota-6740.md` (the router tests: the lite>agy-flash-low route judged on 30 pages a
language, with the instrument used here: `route-judge-6740/judge.mjs` judgePrompt / opusCall / parseVerdict, unchanged) and
`2026-10-28-correct-vs-reread-wave1-zh-de-grc-7568.md` (the German pages of the top-up). #7618's `lane-judge-sampler.mjs`
does the same as a nightly sampler, but it had not run yet; its store gets nothing from this job (see Caveats).

**Question.** The router's German cell put lite>agy-flash-low just below the Opus bar (P 0.891 against 0.90; #7606), with
agy measured on only 30 pages. Meanwhile the #7558 lane has been writing that correction to German and French pages
since 2026-10-27 21:00Z. How good is what it now serves?

**Design** (Derek's inbox notes, 2026-10-28 10:59–12:06Z; they replaced the paired design in the brief).
- **Frame.** The gex45 lane ledger (`/root/jobs/cli-ocr-correct/correct-ledger.jsonl`, 8,101 pages at 13:0xZ). That is this
  box's shard. The other box's shard keeps its own ledger, which could not be reached from here.
  - The ledger holds 43 German and 26 French books. Two pages were drawn per book, seeded, from **every** ledgered outcome,
    not only the written ones. Where the corrector answered UNCHANGED or CONTAIN, or a guard refused the write, the route
    serves the Flash-Lite draft, and that draft is part of the route's output.
  - What was judged is the page's **current** `ocr.data`, checked to be the lane's output. A written page must carry the
    template stamp `0601ef30e816f7a7`; any other page must still hold the lite draft. One page had been rewritten since and
    was skipped.
- **German top-up** (the note's rule: fewer than 60 books). Before the 10:59Z note was read, this job had run the same
  corrector and template (`cli-ocr.mjs read --correct-prompt`, `--lane=route-judge-6740-eval`) on the 250 German pages of
  #7568 wave 1: **250 agy calls, main pool, weekly 33% → 32%**, never written.
  - Two of those pages per book (10 books, 20 pages) were judged as the top-up, with no further agy call. They had no
    apply guard, so they are reported apart and enter rules.json as their own source (`lite>agy-flash-low-unguarded`).
  - That gives 53 German books, not 60. The other 230 reads were left unjudged, per the 10:59Z note.
- **Judge.** Opus (`claude -p`), the route-judge prompt, one output per call against the page image, blind, in a hashed order.
  - Two wrong-page controls per language: both passed in both languages.
  - Where a written correction was rejected, the draft it replaced (the lane's `page_revisions` row) was judged too.
- **Script type** (11:55Z / 12:06Z rule): the `ocr.data` `<script>` tag, else `pages.script_type`, else the book's
  majority. Manuscript pages (German 2, French 6) are reported apart and kept out of the print cells' evidence.

**Result** (`route-judge-6740/results/lane-accept-7263-2026-10-28/score.json`; 95% intervals by book bootstrap)

| | pages (books) | accepted | wrong text |
|---|---|---|---|
| **German print, lane as served** | 84 (42) | **74/84** [0.80, 0.95] | 6/84 |
| — correction written | 69 (37) | 64/69 | 1/69 |
| — draft served (guard refused / UNCHANGED / CONTAIN) | 15 (10) | 10/15 | 5/15 |
| German print, unguarded top-up (#7568 pages) | 20 (10) | 17/20 [0.65, 1] | 3/20 |
| German manuscript, lane (1 book) | 2 (1) | 0/2 | 2/2 |
| **French print, lane as served** | 45 (23) | **37/45** [0.72, 0.91] | 4/45 |
| — correction written | 28 (18) | 26/28 | 1/28 |
| — draft served | 17 (13) | 11/17 | 3/17 |
| French manuscript, lane | 6 (4) | 5/6 | 0/6 |

- **Worse than the draft.**
  - German lane: 0 of the rejected written corrections; their drafts were rejected too.
  - French: 2 of 28 written corrections.
    - `69b51e2b…` p62: *piratisme* → *piratage*.
    - `6a08dd9f…` p103: the speaker *Angelique* → *Agathe*.
  - The top-up has one such page, an O4 repetition (`69c80b2b…` p293).
- **What the lane refuses is the weak half.** Pages where the guard kept the draft (mostly "changes over 25% of the
  draft's words") read at 10/15 and 11/17.
  - They include a page carrying the previous page's text (`69ef2b26…` p103, fidelity 1).
  - They include an unsplit spread (`6a2121ed…`).
  - They include two engraved plates with handwritten captions, and a Fraktur page that drops half a line.
  - The guard holds back changes it cannot check. It does not tell a good correction from a bad draft.
- **Router** (`router-table/2026-10-28-lane-accept-7263.md`, `--before 2026-10-28-agy-gpu-7263.json`):
  - **German OCR, Flash-Lite.** lite>agy-flash-low pooled 119/134 → **0.89 [0.84, 0.94]**, against lite>opus 0.94.
    - Gap −0.04, P = 0.80 (the gate needs 0.90).
    - Wrong text 7.9% against a bar of 3.1% + 4%.
    - **keep**, as before. The "knife edge" of #7606 is no longer one: with 42 more books, agy sits clearly below the bar.
  - **French OCR, Flash-Lite.** lite>agy-flash-low 64/74 → **0.88 [0.81, 0.94]**. **switch → lite>agy-flash-low**, as
    before. The French Opus bar is still untested.
  - No other cell changes.
- **Against the served lite text** (German lite 0.70 [0.58, 0.81] in the table), the lane's output is a clear gain. The
  router's question is different: does it match Opus? It does not.
- **Cost.**
  - Judge: 178 Opus calls (157 served, 4 controls, 10 drafts, 7 timeouts behind the box's pace guard, re-run), $10.86
    list-price equivalent on the subscription. The milolomas meter read 86% → 87% of its week while the judge ran; the
    account is shared.
  - agy: the 250 top-up calls above. The lane's own calls were already spent: the table prices the route at 1.14 agy calls
    per accepted page.

**Rejected pages** (21 lane pages, `rejected-pages.json`; for a GPU-draft > agy retry, Derek 11:24Z, not Opus correction)
- German: 5 written corrections, 5 print drafts, 2 manuscript drafts.
- French: 2 written corrections, 5 print drafts, 1 unchanged draft, 1 manuscript draft.

**Caveats**
- **This is one box's shard.** The other box's lane writes to other books.
- **Two pages a book.** Books are the unit; the intervals are by book.
- **The German manuscript result is one book** (0/2).
- **Double counting.** The #7618 sampler (`lane-judge-sampler.mjs`, nightly from 2026-10-29) draws from the same lane. It
  does not know these 157 verdicts and may judge some of the same pages again. If its export also goes into rules.json, a
  page judged twice would count twice. Its store was deliberately not written to: it is the input of a cron.
- **The top-up is not production.** It is the same corrector without the apply guard, kept as its own source.

Files:
- `scripts/eval/route-judge-6740/lane-accept-7263.mjs`: draw, judge, drafts, score, evidence.
- `results/lane-accept-7263-2026-10-28/`: score.json, sample.json.gz with the judged texts, verdicts-opus.jsonl.gz and
  rejected-pages.json.
- `estimator/router-table/evidence/lane-accept-7263.score.json`.
