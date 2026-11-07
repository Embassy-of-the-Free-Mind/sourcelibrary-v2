---
stage: ocr
measure: [judged]
languages: [deu, lat, fra, ara]
scripts: [Latn, Arab]
canons: []
n_books: 19
n_pages: 76
verdict: "A custom agent listing only read_file cuts agy's one-word overhead from 7,850 to about 3,100 input tokens a turn and removes the denied-shell turn. Input tokens per page: print at 4/call 8,738 -> 4,909, correction 30,331 -> 16,941, Arabic at 1/call 19,255 -> 15,617. Usable: 54/56 -> 55/56, 20/20 -> 20/20, 12/20 -> 14/20, controls 4/4 in each. These samples would catch a large quality drop, not a small one. The agent's instruction to open each file once matters: 6 of 14 calls re-read their images without it, 2 of 14 with it."
status: adopted
decision: "cli-ocr.mjs narrows the tool list by default (--all-tools restores it), for plain reads and the correction template. Translation and the one-image calls are not switched: not tested here."
superseded_by: null
issue: [8330, 7558]
feeds: cost
landed: scripts/batch/cli-ocr.mjs
router_evidence: "none — same model, prompt and route in every arm; this tests the tool list a call is offered, not a route"
defect_rates: "none — the #7522 judge reports usable and fault counts by page, not misleads per 1,000 words; the comparison is against the live setup on those counts"
---

PRIOR ART: `2026-10-27-agy-ocr-pace-read-file-correct-lane-7558.md` (its harness, draw, judge and token accounting are
reused; `prep.mjs` and `score.mjs` gained `--arms`). The method comes from the greenroom project (`~/pri/agy.mjs`).

## 2026-11-07 · Does agy OCR need its ~60 tools? (#8330)

**Why.** agy sends about 60 tool definitions with every turn, and an OCR call has at least two turns. The lanes use one
tool. agy has no `--tools` flag, but a custom agent in the call's workspace (`.agents/agents/<name>.md`, `tools: [...]`,
selected with `--agent`) has its own list. The tool gate stays on every call: the gate is the safety layer, and the
agent only decides what is offered.

**Overhead, one-word prompt, agy 1.5.3, plan mode.** Default 7,850 input tokens; `tools: []` 2,897; `tools: [read_file]`
3,102. `--disable-slash-commands` saves about 800 but voids plan mode, so it was not used.

**Method.** Every arm read fresh (`--fresh`, `CANDIDATE_READS=off`) on gemini-3.8-flash-low. The judge was #7522's
`judge.mjs`: Opus through `claude -p`, blind, one page per call with its neighbours. Each set carried 4 planted
controls in a copy of a narrowed arm's read. Nothing was applied. Most of the print reads ran on the laptop; the last
20 pages of `narrow4` and all of the correction and Arabic rounds ran on the main box, also agy 1.5.3.

| set | arm | usable (Wilson 95%) | omission | addition | order | pages with a misread | input tok / page | denied turns | image opens per image |
|---|---|---|---|---|---|---|---|---|---|
| German/Latin print, 56 pages, 4/call | production | 54/56 [88–99] | 3 | 3 | 0 | 32 | 8,738 | 1 | 57 opens / 56 |
| | narrowed | 54/56 [88–99] | 2 | 0 | 2 | 38 | 5,404 | 0 | 80 / 56 |
| | narrowed, open once | 55/56 [91–100] | 0 | 0 | 0 | 37 | 4,909 | 0 | 64 / 56 |
| Correction template, 20 pages | production | 20/20 [84–100] | 0 | 0 | 0 | 7 | 30,331 | 21 | 20 / 20 |
| | narrowed, open once | 20/20 [84–100] | 0 | 0 | 0 | 6 | 16,941 | 0 | 23 / 20 |
| Arabic manuscripts, 20 pages, 1/call | production | 12/20 [39–78] | 4 | 4 | 1 | 15 | 19,255 | 0 | 21 / 20 |
| | narrowed, open once | 14/20 [48–86] | 2 | 4 | 0 | 13 | 15,617 | 0 | 23 / 20 |

Paired by page, production to narrowed-open-once: print 1 worse, 2 better; correction 0 and 0; Arabic 2 worse, 4
better. Results: `agy-read-file-7558/results/narrow-8330/`.

**What this can and cannot show.**
- 20 pages detect a collapse, not a gap of a few points; 56 pages detect a drop of about ten points. The test shows no
  sign of harm. It does not show the arms are equal.
- Pages with a misread rose from 32 to 37 on print, and fell by one or two on the other sets. That is within what a
  repeat judge run moves (#7558 saw 34–37 on these pages), so it is not read as a change.
- The Arabic gain from 12 to 14 is not a finding. The arms did not differ on the median call.
- Correction's 8 and 9 UNCHANGED answers were judged as the stored draft, because that is what the lane keeps.

**Open-once wording.** The first narrowed arm re-read its images on 6 of 14 calls, each costing a whole turn. A plain
instruction in the agent body brought that to 2 of 14. The production arm did it on 1 of 14.

**Runaway calls, a separate finding.** Output means in all arms are driven by a few calls of 11K–55K output and
thinking tokens, while medians are flat (Arabic 496 vs 511, print 3,184 vs 3,155). They appear in production arms too
(print production max 36,967), so narrowing does not cause them, but 2 of 20 Arabic narrowed calls did it against 0 of
20 production, too few to tell. Input tokens are what this test can claim; total tokens are noisier.

**Not tested.** Translation (`tools: []`, 2,897 overhead) and the one-image calls (`gatedImageCall`) still send every
tool. Whether the subscription pool charges these tokens in proportion was not measured; #7518 found 4/call translation
cost 0.55 of 1/call in quota, which suggests it broadly does.
