---
stage: ocr
measure: [judged]
languages: [lzh, he, ar, la]
scripts: [Hani, Hebr, Arab, Latn]
canons: []
n_books: 159
n_pages: 180
verdict: "No router cell switches to an agy or GPU route. agy 3.8 Flash-low as corrector: Chinese Paddle dice < 0.90 15/29 after the name check (Opus 26/30 stays the hold route); guarded-Paddle tables + mixed 19/30, 9 wrong text; Hebrew 3 Flash 7/28, Arabic 3 Flash 13/29, Chinese 3 Flash 6/30. A GPU draft (stock GLM-OCR on gex45) corrected by agy Flash-low reads Latin print at 22/26 delivered (4 replies cut), level with lite > agy Flash-low (24/30) and short of lite > Opus (30/30). The served 3 Flash text itself is poor in all three cells: Hebrew 7/30 accepted with invented text on 15/30, Chinese 7/30, Arabic 10/30; agy correction does not repair it (worse 3-6, better 5-6 pages per cell)."
status: undecided
decision: "Evidence only, in rules.json; table rebuilt as router-table/2026-10-28-agy-gpu-7263 (before: 2026-10-28-backfill-all, #7612). chinese-flash3, hebrew-flash3, arabic-flash3 and zh-frame-6871 go from keep (UNTESTED) to HOLD (no measured route reaches P(acc >= 0.8) >= 0.9). Under Derek's 2026-10-28 11:24Z rule (agy/GPU routes only; keep the served route if none clears the bar) nothing moves, so no routing-table PR. 26 served 3 Flash pages carry judge-flagged invented or wrong-leaf text (score.json contain_candidates): listed for a by-eye check, not contained."
superseded_by: null
issue: [7263, 6740, 7567]
router_evidence: [zh-paddle-dice-lt090, zh-frame-6871, hebrew-flash3, arabic-flash3, chinese-flash3, latin-lite]
---
## 2026-10-28 · Router tests: agy Flash-low on the cells with no agy measurement, and a GPU draft on Latin (#7263)

PRIOR ART: `2026-10-26-router-tests-idle-quota-6740.md`, whose harness this extends (`scripts/eval/route-judge-6740/judge.mjs`, same judge prompt,
blind, one output a call, page image attached, two wrong-page controls a route). `2026-10-28-euro-print-gpu-draft-flash-correct-7567.md`
measured GPU draft → agy Flash-low against lite → Flash by CER on a reference panel. This run puts one GPU route on the router's own
instrument, the Opus judge against the image.

**Cells added to judge.mjs** (`RT`): `zh-frame-6871` (pages of the guarded Paddle lane, `ocr.pipeline paddle-zh-guarded-2026-10`, Paddle's
text, interior, ≥ 40 Han), `hebrew-flash3`, `arabic-flash3` and `chinese-flash3` (visible books not held, stored 3 Flash OCR, interior,
≥ 300 characters), and `latin-gpu`. `zh-dice` gains `paddle>agy-flash-low` on the 2026-10-26 pages (`draw --from`). One page per book,
seeded (salt `rt-<cell>`).

**latin-gpu.** The 30 pages of the 2026-10-26 latin cell (9 books). They were read on gex45 by stock GLM-OCR (gpu-queue task
`71-latin-gpu-7263`; vLLM, MTP 1, `read.py glm`, 6,000 tokens). That took 78 s; one page hit the token cap in a loop. GLM-OCR was the
open engine that did best on Latin print in #5924's gex45 bake-off; MinerU was about twice its median CER there. The read is kept in
`gpu-drafts.json.gz`. `cli-ocr.mjs read --draft-file` gives it to the agy corrector in place of the stored OCR. That flag is eval only:
apply refuses such a read.

**Correctors.** agy `gemini-3.8-flash-low` on the second pool (jamesdereklomas@), the #5924 one-page template, `--fresh`, nothing kept or
written. 180 agy calls. No new Opus read (Derek 09:50Z and 11:24Z): Opus is the judge only.

**Results** (`results/router-tests-2026-10-28/score.json`; k/n accepted, wrong-text pages; controls 2/2 rejected on every route scored):

| cell | route | accepted | wrong text | top defects | measured before (2026-10-26 / v2) |
|---|---|---|---|---|---|
| Chinese Paddle, dice < 0.90 | paddle > agy Flash-low | 19/29 judged, **15/29 after the name check** | 9/29 | O5 4, O6 3 | paddle 14/30, > agy Flash high 17/30, > Opus 26/30 |
| Chinese tables + mixed, guarded Paddle | paddle > agy Flash-low | **19/30** | 9/30 | O6 8 | paddle 5/9 (partial, below) |
| Hebrew, 3 Flash | 3 Flash (served) | **7/30** | 22/30 | O1 15, O6 10, O5 8 | — |
| | 3 Flash > agy Flash-low | 7/28 | 18/28 | O6 10, O1 10 | |
| Arabic, 3 Flash | 3 Flash (served) | **10/30** | 17/30 | O6 11 | — |
| | 3 Flash > agy Flash-low | 13/29 | 13/29 | O6 10 | |
| Chinese, 3 Flash | 3 Flash (served) | **7/30** | 21/30 | O6 17, O5 12 | — |
| | 3 Flash > agy Flash-low | 6/30 | 22/30 | O6 16 | |
| Latin print, lite cell | GLM-OCR > agy Flash-low | **22/26** (4 replies cut) | 2/26 | O6 2 | lite > agy Flash-low 24/30, lite > Opus 30/30 |

**Print vs manuscript** (Derek 11:55Z; `script-split.json`, each verdict with its page's `script_type`, or the `<script>handwritten` tag when the field is unset):
- **Manuscript.** Every judged page of zh-dice and zh-frame-6871 is `handwritten`; these are the Siku Quanshu manuscript copies, so their k/n above are manuscript k/n.
- **Print.** Every judged page of the Hebrew, Arabic and Chinese 3 Flash cells and of latin-gpu is print (`printed`, `mixed`, or no field and no handwritten tag). The 3 Flash frames left out `<script>handwritten` pages.
- No cell has both kinds, so no k/n splits further.

**Made worse by the agy corrector** (paired with the served draft): Hebrew 3 worse / 5 better of 28, Arabic 4 / 6 of 29 (3 accepts gained),
Chinese 6 / 5 of 30 (wrong text added on 3).

**Name check (zh-dice).** I checked 18 of 19 accepted pages with new Opus calls. The 2026-10-26 checks are tied to that run's
candidates, so they could not be reused. 3 pages drop a name the leaf prints: 丁文杲 → 丁文果, 楚懐 → 楚懷 with 武闗 → 武關, and
榮駕鵞 → 榮駕鵝. The last two are glyph variants not in `GLYPH_VARIANTS`.

**Deviation: zh-dice was judged without the Kanripo leaf.** The committed `kanripo-align.jsonl.gz` carries no leaf text. I rebuilt it with
`refs` only after the verdicts. The name check then ran with the leaf, as in the 2026-10-26 protocol. The 2026-10-26 routes were judged
WITH it.

**Router table** (`router-table/2026-10-28-agy-gpu-7263.md`, before: `2026-10-28-backfill-all`, #7612's table):

| cell | before | after |
|---|---|---|
| latin-lite | HOLD → agy Flash-low read | unchanged (GLM-OCR > agy 22/26, in book group 5924-latin) |
| zh-paddle-dice-lt090 | HOLD → paddle > agy Flash high | unchanged (Flash-low 15/29 named) |
| chinese-flash3 | keep (UNTESTED) | HOLD (the served text 7/30; agy 6/30) |
| hebrew-flash3 | keep (UNTESTED) | HOLD (served 7/30; agy 7/28) |
| arabic-flash3 | keep (UNTESTED) | HOLD (served 10/30; agy 13/29) |
| zh-frame-6871 | keep (UNTESTED) | HOLD (agy 19/30, 9 wrong text) |

HOLD's arrow names the best measured route. In a cell where only the agy route and the draft are measured, that arrow is not a
recommendation. Under Derek's 11:24Z rule the served route stays.

**Did not finish.** The judge stops when this box's Claude account reaches 85% of its week, and it reached that at 11:54Z. The zh-frame
Paddle draft has 9 of 30 pages judged and no controls, so it does not count, and it has no `evidence` entry. The account resets on
2026-10-30 at 12:00Z.

**Contain candidates (judge, not by eye).** 26 SERVED 3 Flash pages carry an invented or wrong-leaf defect at wrong-text severity:
Hebrew 16, Arabic 7, Chinese 3 (`score.json contain_candidates`). One Hebrew page is labelled `<language>Arabic</language>` on a Hebrew
cursive leaf. No page was contained: the account was at its cap, so no by-eye check could run. They are listed on #7263 for one.

**Spend.** $0. agy: 180 corrections (second pool). Opus (claude -p, milolomas200921@): 285 judge calls (283 verdicts) and 18 name checks. The account
went from 82% to 85%, shared with this session. gex45 GPU: 78 s.
