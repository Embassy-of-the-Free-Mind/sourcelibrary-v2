---
stage: ocr
measure: judged
languages: [ta, pi, sa]
scripts: []
canons: []
n_books: 64
n_pages: 64
verdict: "Tamil print: no arm clears (accept agy 15/40, IA draft>agy 15/39, Surya draft>agy 13/40; all inside each other's intervals). Romanized Pali/Sanskrit series: the live English route gpu2>agy beats agy alone (accept 11/24 vs 5/24; 7 gained, 1 lost, p 0.07; misleads 14.2 vs 21.1 per 1,000 words)."
status: undecided
decision: "No route moves. Tamil stays held: no Tamil agy lane at 500K pages until a foreign-token guard exists and a stronger corrector is tested. The romanized series volumes may stay on the English route gpu2>agy; recorded as the held slice cell romanized-indic-series-225, not in english-gpu-7263."
feeds: "route"
supersedes: []
superseded_by: null
issue: [225]
router_evidence: [tamil-lite, romanized-indic-series-225]
defect_rates: "scripts/eval/route-judge-6740/results/indic-ocr-cells-225/defect-rates.json"
---
PRIOR ART: 2026-10-25-untested-language-cells-6553.md — the only earlier Tamil test (10 live pages, agy CER 2.8 vs lite 3.5; the router's agy 9/10). This run replicates that cell at 40 pages on the new #225 shelves and adds two drafts. The romanized series had never been measured; english-gpu-7263's 45/45 (#7263) is English prose, not diacritic-dense Indology.

## 2026-11-13 · Tamil print and romanized Pali/Sanskrit: which OCR route for the #225 Indian shelves? (#225)

**Who reads this.** The session that opens an OCR lane for the ~2,800 printed Tamil books (~500K pages) and the 121
series volumes imported under #225, all hidden and held `indic-print-2026-11`.

**Design.** Route question; one page per book; one output a call; blind Opus route judge (`judge.mjs judgePrompt`,
claude-opus-5-5 via `claude -p`, page image attached). Every agy call on one account, gemini-3.8-flash-low.
`paired-arm.mjs check` passed R1–R5 before the first judge call (5 arms, wrong-page control per arm, 12 repeat rows).
188 Opus verdicts, ~170 agy calls, $0 (subscriptions; gex45 GPU already rented).

- **tamil** (cell `tamil-lite`): 40 books of campaign `indic-tamil-print-2026-11`, 20 Kovilur Andavar Library, 20
  University of Toronto (drawn from the 133 imported), spread 1845–1928, one middle-third text page each, chosen with
  the image open. Arms: `agy` (reads the image alone, the router's current answer), `ia>agy` (the Internet Archive's own
  OCR of the leaf as draft, agy corrects), `surya>agy` (Surya 2 on the gex45 GPU drafts, agy corrects). Baseline agy.
  Draw: `indic-cells-225/draw.mjs` (seed in `draw-tamil-*.json`).
- **series** (slice cell `romanized-indic-series-225`): 24 PTS / HOS text-edition volumes of campaign
  `indic-translation-series-2026-11` whose pages are mainly romanized Pali or Sanskrit, one diacritic-dense page each
  (`series-census.json`, `series-choice.json`). Arms: `gpu2>agy` (the bound English print route: LightOnOCR + Surya 2
  drafts and their word diff, agy reconciles) and `agy` alone. The judge note made every dropped or wrong diacritic a
  defect (ā→a, ṃ→m, ṣ→s, ç→c): a stricter scale than english-gpu-7263's.

Score files: `results/indic-ocr-cells-225/paired-score.json` (paired-arm.mjs), `score.json` and `defect-rates.json`
(`indic-cells-225/score-file.py`), router copy `estimator/router-table/evidence/by-script/indic-ocr-cells-225--score.json`.

### Invented text first

No arm invented a passage (fluent Tamil or Sanskrit not on the leaf). Smaller fills the judge marked:

- **O1, unmarked fills.** `surya>agy` 6af70f112922fe47457b1ef4 (Kovilur, 1856, p. 13): words under a library stamp
  guessed, 4 spans. `ia>agy` 6af6fdf42922fe474579314b: 2 invented words. `ia>agy` 6af720cf2922fe47457d4a53: cut-off
  line ends filled silently.
- **O2, foreign tokens glued inside Tamil words.** agy adds them: agy 7/40 pages, ia>agy 7/39, surya>agy 3/40; 0/40
  Surya drafts and 0 IA drafts carry them. 15 of 17 are on Toronto pages (e.g. 6af7213e2922fe47457d7bf7, *Veṅkaik
  kōvai* 1875 p. 28: "feed" inside a Tamil word in all three arms). `reread-lane-gate` `foreignScriptReason` does not
  catch Latin glued to Tamil, so **a guard is needed before any Tamil agy lane**.

### tamil, judge opus

| arm | accept (Wilson 95%) | by-book 95% | wrong text | misleads /1k words | wrong text /1k | fidelity | control |
|---|---|---|---|---|---|---|---|
| agy | 15/40 (0.24–0.53) | 0.225–0.525 | 22/40 | 18.7 | 10.1 | 3.48 | pass |
| ia>agy | 15/39 (0.25–0.54) | 0.231–0.538 | 16/39 | 15.4 | 6.9 | 3.62 | pass |
| surya>agy | 13/40 (0.20–0.48) | 0.175–0.475 | 19/40 | 15.2 | 6.4 | 3.73 | pass |

- agy → ia>agy: on 39 shared pages better 9/39, worse 3/39; accept gained 5, lost 4 (sign test p 1).
- agy → surya>agy: on 40 shared pages better 14/40, worse 5/40; accept gained 5, lost 7 (sign test p 0.77).
- Noise floor: the same arm judged twice flips accept on 1/6 pages.
- ia>agy has 39 pages: one page came back empty from agy (Gemini filter cut, 6af721422922fe47457d7caf).
- Surya split by library: Kovilur 8/20 accepted (wrong text 7), Toronto 5/20 (wrong text 12).
- Words are whitespace tokens of the judged text (Tamil agglutinates, so per-1k rates compare arms with each other,
  not with Latin-script cells; `non-latin-text-operations.md`).

**Reading.** All three arms accept about 0.37 of pages and about half carry wrong text. A draft lowers the defect rate
per 1,000 words a little (wrong text 10.1 → 6.4–6.9) and the per-page fidelity is higher with a draft, but accept does
not separate and the paired gains and losses cancel. The #6553 9/10 for agy does not replicate on these 1845–1928
prints: 15/40 here.

### series, judge opus

| arm | accept (Wilson 95%) | by-book 95% | wrong text | misleads /1k words | wrong text /1k | fidelity | control |
|---|---|---|---|---|---|---|---|
| gpu2>agy | 11/24 (0.28–0.65) | 0.25–0.667 | 1/24 | 14.2 | 0.15 | 3.75 | pass |
| agy | 5/24 (0.09–0.40) | 0.042–0.375 | 1/24 | 21.1 | 0.15 | 3.58 | pass |

- agy → gpu2>agy: on 24 shared pages better 7/24, worse 4/24; accept gained 7, lost 1 (sign test p 0.07).
- Noise floor: the same arm judged twice flips accept on 0/6 pages.

**Reading.** Wrong text is rare in both arms (1/24); the defects are diacritics. agy alone both drops printed marks
(pāṇinaṃ → m) and *adds* marks the page does not print, silently normalising the edition's spelling toward the
textbook form (dānam → dānaṃ, upādarūpānaŋ → upād-, uggaha-minittañ "corrected" to nimitta). The GPU drafts anchor the
corrector to what is printed: the gpu2>agy finals carry more diacritics than the LightOnOCR draft alone (drafts run
~20% shorter than finals), and the misleads rate is a third lower. Example: 6af6f8defbe7a128b56245e9 (*The Mahāvaṃsa*,
PTS 1908, p. 186): gpu2>agy accepted, agy alone rejected for dropped ṃ and shortened ī.

### Recommendation

- **Tamil:** no route clears. Do not open a Tamil agy lane at 500K pages yet; the books stay held. Next: (1) a
  foreign-token guard for Latin glued inside Tamil words, (2) a test of a stronger corrector (Opus over the Surya or IA
  draft), which is the arm this run did not have. A Tamil profile for `surya-print-lane.mjs` was not built: Surya was
  run raw for this test, and a lane profile waits on an arm worth building it for.
- **Series:** the romanized volumes can stay on the English print route `gpu2>agy-flash-low+diff`. They route by their
  language field (13/24 drawn are labelled English, 11 Pali, which this run did not route), so the evidence is a held
  slice cell, `romanized-indic-series-225`, kept out of english-gpu-7263 so it does not move the English cell.
- **Catalogue note:** `fournewyorkboys00davigoog` sits in campaign `indic-translation-series-2026-11` but is not a
  series volume (`series-census.json`).

### Writes

The best accepted read of each judged page was written as its OCR text with provenance (`ocr.source`, engine, route,
evidence `route-judge:indic-ocr-cells-225`, content hash): 29 pages via `indic-cells-225/write-best.mjs` (run
`indic-ocr-cells-225-2026-11-13`, undo with `revert-run.mjs`) and 6 via `cli-ocr.mjs apply`; p. 100 of one series book
skipped by the cli-ocr script guard (Devanagari). 35 of 64 judged pages now have OCR (`writes.json`). All 64 books
stay `visible: false`, held `indic-print-2026-11`.

### Replicated?

Partly. Tamil agy replicates the #6553 cell at 4× the pages and does not reproduce its 9/10. One judge family only
(Opus); a Gemini second judge was not run because no decision rests on a single close margin: the Tamil arms do not
separate, and the series margin (7 gained, 1 lost) is above a 0/6 noise floor.
