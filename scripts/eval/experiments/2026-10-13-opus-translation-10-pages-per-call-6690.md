---
stage: translation
measure: judged_vs_reference
languages: [fa, sa, lzh, grc, he]
scripts: [Arab, Deva, Hani, Grek, Hebr]
canons: []
n_books: 5
n_pages: 50
verdict: "Opus at 10 pages per call scores 0.30 lower than Opus at 1 page per call (−0.30 [−0.54, −0.08], 50 pages, cross-family judge). It is worse on 23 pages and better on 10. The loss is mostly small omissions, not text moved between pages. It costs about 2.7× less subscription usage per page (list-equivalent)."
status: superseded
decision: "Keep Opus translation at 1 page per call where it is routed (#6545). Do not use 10 pages per call to stretch Opus capacity unless a same-round check shows it still beats 3.8 Flash (#6690)."
superseded_by: "2026-10-15-opus-10-per-call-vs-flash-same-round-6690.md"
issue: [6690, 6545]
---
PRIOR ART: `2026-10-12-pro-opus-correction-hardest-languages-6545.md` (the one-page OPUS arm, its prompt, pages, references and judge rubric). `scripts/batch/claude-ocr.mjs` (the sealed 10-page Opus call and its all-or-nothing page-marker split, built for OCR in #6559 and #6388). `translate-core.mjs` `buildBlockTranslationPrompt` (production's multi-page request). Scripts: `scripts/eval/opus10-6690/`. Numbers: `scripts/eval/results/opus10-6690/scores.json`.

## 2026-10-13 · Does Opus translation hold its quality at 10 pages per call? (#6690)

**Decision it changes:** how much translation Opus can take on. #6545 routed Persian, Sanskrit, Chinese, Greek and Hebrew to Opus "where capacity allows". For OCR, Opus held its accuracy at 10 pages per call (#6388, PR #6443). If translation holds too, the same subscription covers several times more pages.

### Design

- **Pages:** 50, in five runs of 10 consecutive pages, one book per language. Each run starts at a #6545 panel page (the anchor) and takes the 9 pages after it.

  | run | book | pages | published translation |
  |---|---|---|---|
  | Persian | Saʿdī, *Golestān* ch. 5 | 76–85 | Rehatsek 1888 (literal) |
  | Sanskrit | *Arthaśāstra* II.27–30 | 160–169 | Shamasastry 1915 (literal) |
  | Chinese | *Sanguo yanyi* ch. 4, with Mao's commentary | 22–31 | Brewitt-Taylor 1925 (free) |
  | Greek | Plato, *Republic* IX 571c–578b (Burnet) | 367–376 | Jowett 1892 (free) |
  | Hebrew | *Sefer ha-Yirah*, 1627 print | 37–46 | Kerber 2007 (literal; Vilna recension) |

- **Arms.** Both arms are Opus 5.5 via `claude -p` on the subscription, with no tools and the same pinned v13 translation prompt. Neither gets a previous-page translation as context.
  - **O1, one page per call.** The #6545 OPUS request: `buildTranslationPrompt` plus #6545's marker suffix. On the 5 anchor pages the request is byte-identical to #6545's, so the #6545 output is reused. The other 45 pages are new calls.
  - **O10, ten pages per call.** Production's block request (`buildBlockTranslationPrompt`, a `<translation page="N">` block per page) with the same marker suffix. A reply counts only if its blocks are exactly the 10 pages sent, in order; otherwise it is retried once and then refused whole (claude-ocr.mjs's rule).
  - The Persian run went first as a pilot. It split cleanly, so the other four followed unchanged.
- **References.**
  - Anchor pages keep their #6545 reference.
  - Persian, Sanskrit, Chinese and Greek: each new page gets a slice of the published translation. The slice is located by word overlap with both arms' English pooled, so neither arm is favoured, then widened by 40% at each end. The judge is told the excerpt may run into the neighbouring pages.
  - Hebrew: the 1627 print orders its sections differently from Kerber's Vilna text. Each page gets the Kerber sections it holds, listed by hand.
  - Spot checks: the slices run in page order and contain the expected landmarks (the Kashgar story, Shaodi's poem, the ship-superintendent chapter, the "lamentation" sentence of 578a).
- **Judge:** one judge, `gemini-3.8-flash-high` via `agy -p`, from the other model family as the issue asks. One item per call; each item holds the page with both arms, blind and shuffled. The rubric is #6545's `JUDGE-PROMPT-PRO.md`, unchanged: fidelity 1–5, omission, invention (including "boundary": text from the neighbouring page), reversal, page span, and error spans. Each item also carries the end of the previous page's source and the start of the next page's.
- **Controls** (all in the same round):
  - 10 planted errors in O1 copies (5 negations, 3 dropped clauses, a number, a name), shown beside O10. A catch must be located at the planted span.
  - 10 repeats with the labels reshuffled.
- **Bleed, measured two ways.**
  1. The judge's boundary inventions and seam-related accuracy spans.
  2. A mechanical count. A sentence of one arm's page is "moved" when ≥ 60% of its content words appear on the other arm's neighbouring page and < 40% on its own page. It is counted in both directions. On a synthetic test (6 sentences moved across 3 turns) it flagged all 3 turns and 4 of the 6 sentences.
- **Intervals:** 95%, 2,000 bootstrap draws by page. A second interval resamples books first and then pages within them, because pages of one book are not independent.

### Result

**Reads.**
- O10: 5 of 5 block replies split into exactly their 10 pages on the first try. No retry, no refusal, no fallback.
- O1: 45 of 45 new pages read.
- The judge returned all 70 items.

**Fidelity** (judge gemini-3.8-flash-high):

| | n | O1 | O10 | O10 − O1 [95% CI by page] | O10 better / worse / tie | omission flagged O1 / O10 | accuracy spans per page O1 / O10 |
|---|---|---|---|---|---|---|---|
| **all** | 50 | **4.78** [4.64, 4.90] | **4.48** [4.32, 4.64] | **−0.30 [−0.54, −0.08]**; by book then page [−0.60, −0.02] | 10 / 23 / 17 | 4% / 22% | 0.34 / 0.98 |
| Persian | 10 | 4.9 | 4.8 | −0.1 [−0.4, +0.2] | 1 / 2 / 7 | 0% / 0% | 0.3 / 0.2 |
| Sanskrit | 10 | 4.6 | 4.3 | −0.3 [−0.8, +0.3] | 3 / 6 / 1 | 10% / 40% | 0.6 / 1.5 |
| Chinese | 10 | 4.6 | 4.3 | −0.3 [−0.9, +0.4] | 4 / 6 / 0 | 10% / 30% | 0.6 / 1.4 |
| Greek | 10 | 4.8 | 4.7 | −0.1 [−0.5, +0.3] | 2 / 3 / 5 | 0% / 10% | 0.2 / 0.5 |
| Hebrew | 10 | 5.0 | 4.3 | −0.7 [−1.1, −0.3] | 0 / 6 / 4 | 0% / 30% | 0.0 / 1.3 |

- **Reversals:** none in either arm. Major accuracy spans: none in O1; 2 in O10.
  - Hebrew p.40: "A commandment is worth keeping whatever harm may come." The source says the commandment *guards you* from all harm, as O1 has it.
  - Chinese p.30: an interpolated narrative sentence.
- **Pages worse.** On all 23 pages where O10 is worse, it gets 4 against O1's 5, except two pages that get 3.
- **What O10 loses** (the judge's spans, checked by eye on four pages) are small items:
  - a dropped qualifier ("Commandant of Cavalry" for 越騎校尉, losing *Yue*);
  - a term or a list item left out (*saṃmohana* from the arts taught; *puccham*, "tail", from the hides rendered annually);
  - commentary left untranslated in `<unclear>` (Chinese);
  - a wrong reading ("until the middle of the month" for רובו של חדש, "most of the month"; "four times the shank" for चतुर्हस्त उत्सेधः, "height four cubits").

  O1 has some of these too, and is the worse arm on 10 pages. One example is "ten armed men" for 武士十八人 on Chinese p.22.
- **Shorter English.** O10's page body (notes and summary removed) is a median 0.91 of O1's (p10 0.82). O10 also writes about half as many `<note>`s (158 against 298) and far fewer inline `<gloss>`es. On the shortest page (Arthaśāstra p.168, 0.65) the difference is mostly apparatus. But the judge also found three content slips there.
- **Position in the block does not matter much.** O10 − O1 by page position: first −0.0 (n = 5), 2nd–5th −0.3, 6th–9th −0.4, 10th −0.2. Quality does not fall away towards the end of a call.

**Page-boundary bleed (text moved between pages): small.**
- **Mechanical count:** 0 moved sentences in either direction across all 45 page turns.
- **Judge:** boundary inventions on 3 pages of O10 and 4 of O1. Seam-related accuracy spans (a straddling verb rendered on the wrong side, a catchword or a hanging clause dropped or welded) number 12 on 7 pages of O10, against 7 on 6 pages of O1.
  - The clearest case is Greek pp. 371–372: O10 put θρέψει, the first word of p.372, at the end of p.371, and the judge marked it on both pages.
  - So bleed in O10 happens at the scale of a word or clause at the turn. It is not whole sentences, and it is not the main source of the gap.

**Usage per 100 pages**, from the CLI's own usage block per call:

| | calls | output tokens | cache-write tokens | list-price equivalent | seconds per page |
|---|---|---|---|---|---|
| O1 (45 pages measured) | 100 | 202 K | 1.25 M | $14.20 | 22.8 |
| O10 (50 pages) | 10 | 174 K | 0.22 M | $5.29 | 16.4 |

- O10 uses about **2.7× less** per page at list price. Most of O1's extra cost is the CLI's fixed prompt overhead, written to cache on every call. Output per page is only 1.16× higher in O1.
- The OCR figure (~8×, #6443) does not carry over, because translation is dominated by output.
- **Weekly-meter percent per 100 pages: not measurable on this account today.** The meter is an integer and the account is shared.
  - From 15:55 to 16:30 UTC, both arms ran ($9.04 list) and the weekly meter rose 2 points (4 → 6).
  - From 16:30 to 17:20 UTC this job made no Claude call, and the meter still rose 3 points (6 → 9) from other jobs.
  - Upper bound, attributing the whole arm window to the arms: O1 ≤ 4.7 and O10 ≤ 1.8 weekly-points per 100 pages. The true figures are lower by an unknown share.
  - If the meter tracks list-equivalent usage, the ratio between the arms is the 2.7× above.

**The judge.**
- Planted errors: located 10 of 10, and scored lower than the same page's unplanted O1 on 8 of 10. The two misses were dropped clauses on pages where O1 itself had a 3 or a 4.
- Repeats: 16 of 20 scores identical, mean absolute difference 0.20. The sign of O10 − O1 matched on 8 of 10 repeated pages.

### Threats and limits

- **One judge, one family:** Gemini, the other family from both arms. The arms are the same model, so self-preference cannot favour either. There is no second judge to check the size of the gap. #6545 found its Opus and Pro judges agree only moderately (alpha ≈ 0.6).
- **n = 50 pages in 5 books.** Per-language intervals are wide, and only Hebrew's excludes 0 on its own. The pooled result holds under the book-level bootstrap, but only just (upper end −0.02).
- **References for 45 of the 50 pages were cut by script** (40 pages), or listed by section by hand from a different recension (Hebrew, 9 pages). The same reference serves both arms on each page, so the paired difference is fair. Absolute levels are less certain than #6545's.
- **Hebrew's −0.7.** Its pages are two-column prints whose OCR order does not follow reading order. O1 often noted the column order; O10, working across ten such pages, welded clauses across column breaks. The loss may be specific to this layout.
- **Not tested here:**
  - 3.8 Flash on these pages. Whether Opus at 10 per call still beats 3.8 Flash (+0.47 to +0.52 at one per call in #6545, under a different judge) needs a same-round arm.
  - 5 pages per call.
  - A previous-page context for O1.
- **Weekly percent:** see above. Only list-equivalent usage is measured exactly.

### Routing

- **Keep Opus translation at one page per call** where #6545 routes it. Ten per call is about 2.7× cheaper, but it loses 0.30 on the judge's 1–5 scale, mostly through small omissions, and Hebrew loses 0.7.
- **Before using ten per call to stretch capacity,** add a 3.8 Flash arm to these 50 pages and judge all three arms in one round. If O10 still clearly beats 3.8 Flash, ten per call is the better use of a limited Opus allowance than leaving pages to 3.8 Flash. The interval here does not settle that.

*Measure:* judged against a published translation by one cross-family AI judge. It is not accuracy in the sense of eval-design §2. *Grade:* moderate-to-low. 50 pages in 5 books, one judge, script-cut references, and a judge that passed its plant and repeat controls. *Replicated?* No.

*Cost:* $0. Opus through `claude -p` and Gemini through `agy -p`, both on the subscription. No API key, no database write.

*Files:* `scripts/eval/opus10-6690/` (load-runs.mjs, run-claude.py, build-refs.py, build-packet.py, score.py), `scripts/eval/results/opus10-6690/{scores.json, key.json}`. The arm outputs, references and judge packets quote published translations and stay on the box (`$JOB_SCRATCH/w/`).
