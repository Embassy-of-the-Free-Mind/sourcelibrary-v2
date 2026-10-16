---
stage: ocr
measure: [accuracy]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 180
n_pages: 180
verdict: "NO-GO as written for Opus-correcting the 24,834 stale Siku pages: the over-correction gate (made worse vs the page's own Kanripo leaf by > 0.5 pt on <= 10% of pages) failed. The experiment's prompt (v1) made 9 of 60 Kanripo-scored pages worse (15%, Wilson 8–26%). v1 plus one rule ('keep the page's own character forms; no notes of your own', v2) made 4 of the same 60 worse, but 5 of 40 on a fresh held-out draw (12.5%, 5–26%). Read beside the gate: nearly every 'worse' page is a swap between two forms of one character (髙/高, 㑹/會, 巳/已, 諡/謚) or a printed seal Kanripo leaves out; on the same pages the median Kanripo CER falls 3.5% → 2.1% (v2, n=60) and 3.2% → 2.6% (held-out, n=40). The gate was not moved; Derek decides."
status: undecided
decision: null
superseded_by: null
issue: [6561, 6567]
---
## 2026-10-15 · Opus-correct of the high-change stale Siku pages: pilot and the over-correction gate (#6561 item 1)

PRIOR ART: `2026-10-12-paddle-zh-correct-vs-redo-6561.md` (the correct prompt, the Kanripo scoring, Opus correct vs
re-read on table pages), `2026-10-12-stale-siku-retranslate-pilot-6567.md` (the stale census and the old-vs-new CER
that splits these 24,834 pages from the 50,387 being retranslated). Code: `scripts/eval/stale-correct-6561/`
(prep, overcorrect, prompt-v2, shard, review-sample) and the runner `scripts/eval/paddle-correct-6561/batch/run.mjs`.
Numbers: `scripts/eval/stale-correct-6561/results/`. Files only: nothing was written to `pages` or any collection.

**Frame (2026-10-15).** 56,097 pages still carry `translation_stale` (lane paddle-zh-2026-10). Of those, 24,834 pages
in 738 books changed by an old-vs-new Han CER >= 0.1 and are otherwise eligible (Paddle OCR, no human edit, book held
only by the lane). All 24,834 still have their stale English. 3,134 of them (12.6%) carry a trusted own Kanripo leaf
(`qa_screen` screened, dice >= 0.6). So most of this frame has no reference text, and an over-correction check can only
be run on the minority that does.

**Draws.** Pilot: 100 pages, one per book, seed 6561; 20 of them have a trusted own leaf. The gate needs more than
20, so a supplement was drawn: 40 pages with a trusted leaf, one per book, from books outside the pilot (seed 65612).
After v2 was written, a held-out draw: 40 more such pages from books in neither set (seed 65613).

**Method.** `claude -p --model opus` (Opus 5.5, CLI 2.1.286, subscription, account team@sourcelibrary.org), one page
per call: page image + the current Paddle text as a draft. Prompt: the #6561 correct prompt, hash-checked (v1). v2 adds
one paragraph before the reply format (`prompt-v2.mjs`, rule sha 0695a637bbfdf388). Scoring (`overcorrect.mjs`): the
Kanripo CER of the Paddle text and of the correction against the page's own leaf (`bodyCer`, the leaf's length as
`expected`, as in score.mjs). A page is "made worse" when after − before > 0.005.

**Results.**

| arm | pages scored | made worse > 0.5 pt | Wilson 95% | made better > 0.5 pt | median Kanripo CER before → after |
|---|---|---|---|---|---|
| v1, pilot + supplement | 60 | 9 (15.0%) | 8.1–26.1% | 25 | 3.52% → 2.55% |
| v2, same 60 pages | 60 | 4 (6.7%) | 2.6–15.9% | 28 | 3.52% → 2.11% |
| v2, held-out | 40 | 5 (12.5%) | 5.5–26.1% | 18 | 3.22% → 2.61% |

Gate: <= 10% made worse. v1 fails. v2 passes on the pages its rule was written from and fails on the held-out draw;
pooled, v2 is 9 of 100. **The gate is not met as written.**

**Beside the gate (not a re-scoring).**
- **v1's 9:** 5 are Opus normalising a printed variant form (髙→高, 䖏→處, 㑹→會, 内→內, 巳→已). 1 is Opus's own
  `<note>` commentary and a seal guess, scored as body text; that page's real fix, 立部→玄部 (the taboo form), was right.
  1 is a real misread (法書要錄 p.131: printed 間 written as `<unclear>問</unclear>`). 2 are small.
  Folding just those observed pairs gives 4 of 60 (post hoc, so not a gate).
- **v2's 4 on the same pages:** variant forms again (湏→須, 䖏→處, 巳→已, 決→决), plus one page with the same
  characters in a changed order.
- **v2's held-out 5:**
  - one is a printed seal 乾隆御覽之寶 that Kanripo leaves out;
  - one is a variant swap Kanripo writes the other way (賓→賔);
  - three are variant swaps (㑹→會, 諡→謚, 巳→已 ×3);
  - one 蓍→著 may be a real misread.
- **Content:** in the v2 pilot, 2 of 100 pages add more than 10% Han. The larger one (6992ce4a… p.76, a firearm diagram)
  restores a printed 5-column block that Paddle had dropped, checked by eye against the image. 29 pages shrink by
  more than 10%. These are mostly illustrations and diagrams, which the prompt turns into an `<image-desc>`.

**Throughput.** About 18 s a call; 4 in flight gave about 8 pages a minute. 320 calls in total, $0. First attempt lost:
main's `/root/.local/bin/claude` is a stale 2.1.31, where `opus` resolves to Opus 4.5 and calls hung until the
600 s kill. `run.mjs` now refuses a reply from a model that is not Opus 5.x. Run it with `CLAUDE_BIN=/usr/bin/claude`.

**Not done.** The invented-text half of the gate (Gemini review of the 100, Claude arbitrating every page it calls
invented): every agy Gemini model has answered "Individual quota reached" since 2026-10-14 13:06 UTC. The requests
are built and job stale-correct-6561-b runs them when agy answers.

*Replicated?* Partly: v2 was re-measured on a held-out draw, and it did not hold.
