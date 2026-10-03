## 2026-10-03 · Can a reference-free check find the pages the reference judges marked as reversed, omitted or invented? (#5695 extra test)

**Question.** A published human translation exists for perhaps 5 % of our pages. Can a check that sees only the source page and our English screen the rest of the library for reversed or dropped meaning?

**Answer.** No, not as a screen. The best detector (D3, a direct contradiction check on Flash-Lite) finds 83 % of the pages the judges marked as reversed, but it flags half of all pages and 18 % of its flags are judged reversals (base rate 11 %). It is a sampler that doubles the yield of a reading pass, not a filter.

**Design.**
- **Labels.** The served English of every #5695 track (T1 Latin, T2 Greek, T3 vernaculars, T4 Hebrew/Aramaic/Arabic/Persian, T5 Sanskrit/Pali/Chinese) and arm A of the Tengyur reference run (#5497): 434 pages, each scored by two blind Opus judges who had a published translation. A page is **positive** when either judge quoted a reversal of meaning (47 pages, 10.8 %). Omission (both judges), unreadable-fill invention and fidelity ≤ 3 are secondary targets.
- **Sample: 150 pages, case-control.** All 47 positives, plus 103 pages drawn at random from the other 387, in proportion to each track. Precision and flag rate are reweighted to each track's own reference set, so they are quoted at the 10.8 % base rate and not at the enriched 31 %. Recall and the false-alarm rate need no reweighting. `set.jsonl` has the pages, labels and weights; no reference text is stored.
- **Detectors.** The model never sees a reference or a label. `gemini-3.1-flash-lite`, thinking off, temperature 0, through `gemini-script-client` (metered, `triggeredBy: xlref-backtrans`). Notes, glosses and summaries are stripped from the English first.
  - **D1, negation counts ($0).** Negation words in the source against negation words in the English, per page and in a sliding 30 % window; a word list per language. No role cue was built.
  - **D2, back-translation.** Flash-Lite translates our English back into the source language. The result is compared with the source by chrF and BLEU-4, and a second call lists where the back-translation contradicts the source.
  - **D3, direct check.** Flash-Lite reads the source and the English and lists contradictions, omissions and additions, with quotes, a kind and a certainty. It does not rewrite.
- **Rules fixed before the results.** D1 is built only if a 20-page Latin check reaches AUC ≥ 0.70 (it did: 0.92). Stop after the first 60 pages if neither D2 nor D3 beats the base rate (both did: precision 0.20–0.21 against 0.11). The flag is "at least one contradiction listed"; the stricter cuts are shown beside it.
- **Positive control.** The judge gate's own `plant()` (one negation dropped or added) in the English of 30 pages that both judges passed, scored against the same page unplanted.
- **Spend.** $0.48 of the $5 envelope (540 calls).

**Result 1 — judged reversals** (150 pages; 47 positive; precision and flag rate at the 10.8 % base rate, 95 % CIs).

| detector | recall | false alarms on other pages | pages flagged | precision | × base rate |
|---|---|---|---|---|---|
| **D3 direct: any contradiction** | 39/47 = **83 %** [70–91] | 47/103 = 46 % | 50 % [41–58] | **18 %** [15–22] | 1.7 |
| D3 direct: a high-certainty contradiction | 31/47 = 66 % [52–78] | 29/103 = 28 % | 32 % [25–40] | 22 % [17–29] | 2.0 |
| D3 direct: two or more contradictions | 8/47 = 17 % [9–30] | 3/103 = 3 % | 5 % [2–8] | 41 % [19–100] | 3.8 |
| D2 back-translation: any contradiction | 34/47 = 72 % [58–83] | 44/103 = 43 % | 46 % [38–54] | 17 % [14–22] | 1.6 |
| D2 back-translation: high certainty | 30/47 = 64 % [50–76] | 38/103 = 37 % | 40 % [32–48] | 17 % [13–22] | 1.6 |
| D2 and D3 both, high certainty | 22/47 = 47 % [33–61] | 17/103 = 17 % | 20 % [14–26] | 26 % [17–38] | 2.4 |
| D1 negation counts differ by 2 or more | 29/47 = 62 % [47–74] | 59/103 = 57 % | 58 % [51–64] | 12 % [9–14] | 1.1 |

- As a ranking, D3's count of contradictions has AUC 0.71, D2's 0.64, D2's chrF 0.64, BLEU-4 0.57, D1 0.54. Chance is 0.50.
- Against reversals that **both** judges quoted (28 pages, base rate 6.5 %): D3 recall 89 % [73–96], precision 12 % [10–14].
- **Right page, wrong spot.** Of the 39 reversal pages D3 flagged, its quote matched the judges' quote on 16 (word-overlap match, a floor). On the others it flagged the page for something else.
- **Back-translation adds nothing over the direct check** and costs 3.4 times as much. The string metrics are weakest: on Greek, chrF ranks reversed pages *below* clean ones (AUC 0.38).

**Result 2 — by language group** (reversal, either judge; "hits" = flagged positives / positives, "alarms" = flagged others / others).

| group | pages | base rate | D3 any: hits, alarms, precision | D3 high: hits, alarms, precision | D2 high: hits, alarms | D1: hits, alarms |
|---|---|---|---|---|---|---|
| Latin | 25 | 11 % | 5/8, 7/17, 16 % [6–32] | 4/8, 2/17, 35 % [12–100] | 4/8, 3/17 | 6/8, 3/17 |
| Greek | 29 | 16 % | 10/12, 6/17, 31 % [19–55] | 7/12, 5/17, 27 % [14–55] | 11/12, 6/17 | 5/12, 8/17 |
| German, French, Italian, Dutch, Spanish | 16 | 2 % | 1/1, 7/15, 4 % [2–8] | 1/1, 5/15, 5 % [3–12] | 0/1, 5/15 | 1/1, 4/15 |
| Hebrew, Aramaic, Arabic, Persian | 21 | 19 % | 9/10, 7/11, 25 % [18–40] | 7/10, 4/11, 31 % [17–65] | 6/10, 9/11 | 6/10, 5/11 |
| Sanskrit, Pali, Chinese | 24 | 14 % | 7/9, 7/15, 21 % [13–38] | 6/9, 4/15, 29 % [14–66] | 4/9, 8/15 | 5/9, 12/15 |
| Tibetan (Tengyur draft) | 35 | 6 % | 7/7, 13/28, 13 % [9–19] | 6/7, 9/28, 15 % [9–27] | 5/7, 7/28 | 6/7, 27/28 |

- No group reaches a precision whose interval clears 50 %. In the vernaculars, where reversals are rare (1 in 59), 24 of 25 flags are false.
- Per-language counts for all 16 languages are in `results.json` (`by_lang`); most have fewer than 5 positives and support no rate.
- **D1 is a Latin result only.** On the whole Latin track (71 pages): AUC 0.85, recall 6/8, false alarms 14/63, precision 30 % at a 28 % flag rate. The rule was chosen after seeing the 8 positives, so recall is in-sample; the false-alarm rate on the 51 pages not seen is 14/51. Everywhere else D1 is at chance (Greek AUC 0.48, Sanskrit/Pali/Chinese 0.49, Tibetan 0.52), which repeats #5713.

**Result 3 — omission, invention, low fidelity.**
- Omission (both judges, 34 pages): D3's own omission list is precise but nearly blind: recall 5/34 = 15 %, precision 50 % [15–89] at a 5 % flag rate.
- Unreadable-fill invention (25 pages): D3's addition list finds 4/25. D2's contradiction flag finds 21/25, at 22 % precision and a 46 % flag rate.
- Fidelity ≤ 3 (48 pages in the sample): D3 recall 75 %, precision 27 % [20–34]; D2 recall 73 %, precision 30 % [23–38].

**Result 4 — positive control (30 planted negation flips).**
- D3 flagged 28/30 = 93 % [79–98] and quoted the planted spot on 25/30 = 83 % [66–93]. The same 30 pages unplanted were flagged 10/30.
- D2 flagged 24/30 = 80 % [63–91]; unplanted 9/30.
- So the instrument sees a blunt flip in the English. Real reversals are harder than plants (83 % page recall, about 34 % at the judges' spot), and the false alarms are the binding problem, not blindness.

**Cost.** D3 $0.00062 per page = **$62 per 100,000 pages** (realtime; about half on the Batch API). D2 $208 per 100,000. D1 $0.

**Gallery.** `gallery.md`: 5 catches, 5 false alarms, 5 misses with quotes, each read by eye. Of the five false alarms, three are the detector misreading the source (two on the first word of a page cut mid-sentence), one is a quibble and one is a real error the judges did not quote. One miss is an OCR error (*τρία* read as *βία*): no check that reads the OCR text can see those, and T2 found that 16 of 22 low Greek pages start in the OCR.

**Threats, with numbers.**
- The labels are judges, not truth: `measure` is agreement with two Opus judges who had a reference. One of five false alarms read by eye was a real error, so true precision is somewhat above 18 %, not near 50 %.
- 47 positives. Recall is ± 10 points; per-group rates are ± 25 or worse.
- Positives are served pages from six reference sets, which over-draw canonical texts and early print. The base rate in the whole library is not known; precision scales with it.
- T1 and T4 results were read from their PR branches (#5721, #5735), not yet on main at run time.
- One prompt per detector, one model. Flash or a thinking budget was not tried: the brief capped this at D1–D3 on Flash-Lite. Flash would cost about 4 times as much.
- D1's word lists are rough for Sanskrit, Pali, Persian and Tibetan (sandhi, verb prefixes, lexicalised compounds), and the tuned Tibetan version in `negcheck.py` was already at chance.

**Decisions proposed (not implemented).**
1. **Do not screen the library with D2 or D3.** Default: no. At a 50 % flag rate and 18 % precision a flag carries almost no information for a reader, and a badge built on it would be wrong four times in five.
2. **Use D3 as a sampler, not a gate.** Default: yes, where it is free to do so: when a QA pass or a new reference set needs pages likely to hold a reversal, draw from D3's high-certainty flags (2 times the yield of a random draw, $62 per 100,000 pages). No stored flag, nothing shown to readers.
3. **Latin negation count: hold-out test before any use.** Default: run it at $0 on the next Latin reference pages. It is the only $0 signal that separated anything (AUC 0.85), and it caught the abbreviation case (*nō* dropped) that both model checks missed, but its rule was picked on 8 positives.

**Replicated?** Partly. The Tibetan negation result repeats #5713 (at chance). D2 and D3 have one run each; the first 60 pages and the full 150 agree (D3 precision 0.21, then 0.18).

**Artifact.** `scripts/eval/results/xlref-backtrans-2026-10/`: `set.jsonl` (pages, labels, weights), `raw/` (every model output, one JSONL per detector; `plants.json`, `cost.json`), `results.json` (all detectors × targets, by track, by language, planted control, per page), `results-first60.json` (the stop-rule sample), `d1-latin-check.json`, `gallery.md`. Code: `scripts/eval/translation-vs-reference/backtrans/` (`build-set.mjs`, `run-detectors.mjs`, `negation.mjs`, `d1-negation-check.mjs`, `score.mjs`).
