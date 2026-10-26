---
stage: ocr
measure: [judged]
languages: [lzh, de, la, fr]
scripts: [Hani, Latn]
canons: []
n_books: 270
n_pages: 270
verdict: "Six of the router table's test-next cells, 30 pages each, one page per book, judged by the one Opus judge against the image. No cell switches under the 2% absolute wrong-text bar. Chinese Paddle dice < 0.90 goes from UNTESTED to HOLD → Paddle > Opus: as judged 29/30, 26/30 after a name check against Kanripo (the judge accepted 五殺大夫 where the leaf prints 五羖大夫), agy Flash high 17/30, Paddle alone 14/30. German Flash-Lite OCR keeps lite > Opus (28/30, 1 wrong text); lite > agy Flash-low ties at 28/30 with 2 wrong text. German 3 Flash OCR: the draft alone 29/30 with 0 wrong text, Opus 29/29. Latin lite > agy Flash-low 24/30 against Opus 30/30 on the pilot's pages: keep Opus. Latin 3 Flash is HOLD (3 Flash 21/30, agy Flash-low 23/30). French Flash-Lite > agy Flash-low 27/29 switches only under the relative wrong-text bar. German translation, 30 more pages: Opus CLI 23/30, 3 Flash 19/30, Flash-Lite 11/30; still HOLD. Tibetan did not run (no Derge index on gex45)."
status: undecided
decision: "Proposals only: router table rebuilt as scripts/eval/estimator/router-table/2026-10-26-router-tests.md/.json (before: 2026-10-26.md). No routing-table edits (#6740)"
superseded_by: null
issue: [6740, 7376, 7417, 6561, 5924, 7263]
---
## 2026-10-26 · Router tests on idle quota: six test-next cells, judged against the image (#6740)

PRIOR ART: `2026-10-26-router-table-beta-binomial-6740.md` (#7417) ranked the cells. `2026-10-25-route-judge-qualitative-pilot-6740.md`
(#7376) is the instrument. The cells were added to its harness, `scripts/eval/route-judge-6740/judge.mjs`, in the
same shape; this is not a second harness.

**Instrument.** One judge, Opus through `claude -p`, reads one output at a time against the page image. The prompt is
the pilot's. The one change: on zh-dice the Kanripo leaf goes in as a REFERENCE (another edition; the image decides).
Each route has two wrong-page controls, and every control passed.

**Draws.** Seeded, one page per book, books not held. The exception is the Chinese Paddle lane: every one of its books
carries an OCR-only lane hold (`paddle-zh-5600-ocr-only` and the like). Those holds keep translation off; they are not
containment. They were allowed and every other hold was not.

**Correctors.** Each corrector read the STORED draft and the image:
- Opus: `correct.mjs`, one page a call, since there is one page per book.
- agy: `cli-ocr.mjs` correct mode, on the #5924 one-page template rebuilt from the live prompt (`fc-prompt.mjs`, hash check passed).

Both ran with `CANDIDATE_READS=off --fresh`. Their reads stay in the job's scratch. Nothing was written to pages,
books, page_revisions or R2.

**Results** (`results/router-tests-2026-10-26/score.json`; k/n accepted, [90%] from the router table's posterior):

| cell | route | accepted | [90%] | wrong-text pages | top defects |
|---|---|---|---|---|---|
| Chinese Paddle, dice 0.6–0.90 | paddle | 15/30 judged; 14/30 after names | 0.47 [0.33, 0.61] | 12/30 | O6 18, O11 14 |
| | paddle > agy Flash high | 19/30; 17/30 | 0.57 [0.43, 0.71] | 8/30 | O6 16, O5 10 |
| | paddle > Opus | 29/30; **26/30** | 0.85 [0.74, 0.94] | 0/30 + 1 name | O6 9, E2 7, O8 7 |
| German OCR, Flash-Lite | lite | 21/30 | 0.69 [0.55, 0.81] | 5/30 | O8 18, O6 16 |
| | lite > agy Flash-low | 28/30 | 0.93 [0.84, 0.99] | 2/30 | O8 14 |
| | lite > Opus | 28/30 | 0.93 [0.85, 0.99] | 1/30 | O8 5 |
| German OCR, 3 Flash | 3flash | 29/30 | 0.94 [0.86, 0.99] | 0/30 | O8 22, O6 12 |
| | 3flash > agy Flash-low | 26/30 | 0.87 [0.76, 0.95] | 1/30 | O8 18 |
| | 3flash > Opus | 29/29 | 0.99 [0.96, 1.00] | 0/29 | O8 11 |
| Latin print, lite (pilot pages) | lite > agy Flash-low | 24/30 (9 books) | 0.79 [0.59, 0.94] | 4/30 | O6 16 |
| Latin print, 3 Flash | 3flash | 21/30 | 0.70 [0.57, 0.82] | 4/30 | O8 16, O6 14 |
| | 3flash > agy Flash-low | 23/30 | 0.78 [0.65, 0.89] | 3/30 | O6 11 |
| French OCR, Flash-Lite | lite | 22/30 | 0.72 [0.58, 0.84] | 6/30 | O8 9, O6 8 |
| | lite > agy Flash-low | 27/29 | 0.93 [0.84, 0.98] | 2/29 | O8 10 |
| German translation, 2nd draw | flash3 | 19/30 (pooled 41/60) | 0.68 [0.58, 0.77] | 5/30 | T7, T5 |
| | flash-lite | 11/30 (pooled 26/60) | 0.44 [0.33, 0.54] | 9/30 | T9 3 |
| | opus-cli | 23/30 (pooled 49/60) | 0.81 [0.72, 0.88] | 4/30 | T9 2 |

**Name check (Chinese).** One Opus call per page with an accepted candidate gave the checker the image, the Kanripo
leaf and the page's accepted candidates, blind (27 pages). The checker named every person and place on the leaf.
`score` then flags a name the checker reads on the image that a candidate does not contain.

Strictly character by character, Opus drops from 29 to 17. Most flags are glyph variants, not wrong names (荆/荊,
温/溫, 恵/惠, 逹/達). The checker copied Kanripo's form as "the image's".

Classed by eye, two flags are different characters:
- **釋齊巳 / 齊已 / 齊己.** 己, 已 and 巳 are one glyph in this woodblock type, so this one is not separable from the image.
- **五羖大夫 → 五殺大夫** (`6a3c65e1…:150`). The leaf prints 羖 (checked on the image). Paddle misread it, and all three
  routes kept it. The judge accepted the Opus page anyway. This is the 章德懋 → 童德懋 shape again.

The variant list is in `judge.mjs` (`GLYPH_VARIANTS`). Both counts are in score.json:
`accept_after_name_check` (the headline) and `accept_after_name_check_strict`.

Kanripo's CER agrees with the judge's order on 30/30 page pairs. That holds on this cell too, where the judge was
given Kanripo.

**Pages made worse by the corrector:**
- Opus: 1 of 30 on Chinese; 0 on German lite, German 3 Flash and Latin.
- agy Flash high on Chinese: 4/30 worse, 3/30 with wrong text added.
- agy Flash-low on German 3 Flash: lost acceptance on 3/30 pages it should have left alone.

**Decisions** (rules.json unchanged; build.py now pools a route's evidence across score files):

| cell | before | after |
|---|---|---|
| Chinese Paddle, dice < 0.90 | keep (UNTESTED) | **HOLD → paddle > Opus** (P(acc ≥ 0.8) 0.81) |
| German OCR, Flash-Lite | keep (UNTESTED) | keep lite > Opus (agy Flash-low ties on acceptance, fails the 2% bar on 2/30) |
| German OCR, 3 Flash | keep (UNTESTED) | keep 3flash > Opus (the draft alone is 29/30, 0 wrong text; P(acc_3flash ≥ best − 0.05) under 0.9) |
| Latin print, Flash-Lite | keep lite > Opus | keep (lite > agy Flash-low 24/30, 4 wrong text) |
| Latin print, 3 Flash | keep (UNTESTED) | **HOLD → 3flash > agy Flash-low**; 3flash > Opus untested, now test next #1 |
| French OCR, Flash-Lite | keep (UNTESTED) | keep lite > Opus (untested); **switch to lite > agy Flash-low under the relative bar** |
| German translation (both) | HOLD → Opus CLI | HOLD → Opus CLI: the second draw was weaker (23/30), P(acc ≥ 0.8) 0.77 → 0.58 |

**Contain candidates.** Seven SERVED pages where the judge says the text is not on the leaf (score.json
`contain_candidates`). Three are wrong-leaf (I1): French lite p.554 and p.168, and German flash-lite English p.218.
Four are invented (O1). These are judge findings, not by eye, and this job may not write data, so none is contained.
They are listed on #6740 for a by-eye check.

**Did not run.**
- Tibetan, 30 more Kangyur folios. New folios need the Derge alignment index (`/root/tibetan-eval`), which is not on
  gex45. They would also have needed about 1.6 more Claude points than the cap left.
- Latin 3 Flash > Opus and French lite > Opus: not in the brief's test 7.

**Spend.** Account dereklomas@gmail.com went from 80% to 88% weekly, shared with this session and a #6420 audit round.
Calls: 507 Opus judge calls (60 more were reused from the pilot), 93 Opus corrections, 30 Opus CLI translations,
27 name checks, 182 agy calls (Flash low and high only).
