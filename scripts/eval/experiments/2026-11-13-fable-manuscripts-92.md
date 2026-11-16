---
stage: ocr
measure: accuracy
languages: [en, la, fr, ar, zh, grc, he, syr]
scripts: [Latn, Arab, Hani, Grek, Hebr, Syrc]
canons: []
n_books: 91
n_pages: 114
verdict: "Fable 5.2 (effort high) reads handwritten manuscript pages better than Opus 5.5. On 75 expert-transcribed pages (Set A) its mean page CER is 7.0% in each of two draws, against 9.4–9.5% for Opus at medium effort: paired FABLE − OPUS2 −3.2 points [−5.1, −1.7] (d1, n = 73) and −2.8 [−4.3, −1.5] (mean of two draws, n = 71). Fable's own draw-to-draw spread is 0.0 [−0.4, +0.3]. The gain is almost all on medieval Latin (−6.5 to −8.7 points) and Maghrebi Arabic (−4.3 to −6.1); on 18th–19th c. English and early modern French it is under one point. Fable also beats Opus at xhigh effort (−2.4 [−3.8, −1.2], n = 75), and xhigh beats medium by only −1.1 [−2.2, −0.2]. Fable failed no page; Opus medium restarted or duplicated 2–3 of 75. On our own pages (Set B, 39, model-built keys, DIRECTIONAL) all three readers are level under every key. By eye, the Set A gap is mostly real reading, but in 3 of 10 Fable draws on the hardest Latin pages it filled an illegible spot with fluent, on-topic Latin that is not on the page; the other draw read the same spot correctly."
status: informational
decision: "Fable 5.2 is the strongest reader of handwriting measured here and the candidate for a router cell on medieval Latin and Arabic manuscript pages. Not routed by this file: it costs about 1.5× Opus medium per page ($0.10 against $0.07 list, 3,500 against 1,800 output tokens, 34 s against 19 s), its invented fills need a check that page CER does not give (two draws compared, or a by-eye sample), and Set B could not test it because its keys are worse than the reader. On English and French hands, Opus medium is as good and cheaper."
superseded_by: null
feeds: route
defect_rates: "none — page CER against expert references only; no severity judge was run (by-eye checks of the largest gaps and of invented fills are in scripts/eval/results/fable-mss-92/byeye-setA.md)"
issue: [92, 270, 6544]
---
PRIOR ART: v2#6544 (`scripts/eval/mss-thinking-6544/`: the October scorer, imported unchanged, its Set A and Set B, keys and stored reads), `scripts/eval/replicate-6547/` (the sealed one-image `claude -p` runner, whose call shape `scripts/eval/fable-mss-92/run-arm.py` keeps), `scripts/eval/pro-translate-6545/claude-arm.py` (PR #87: `--effort` and per-row cost/token/modelUsage). Nothing rebuilt; no Gemini called.

## 2026-11-13 · Is Fable 5.2 a better reader of manuscript pages than Opus 5.5?

**Decision this informs.** Which model reads handwritten pages, and whether Fable is worth a router cell for them.

**Design (posted on #92 before any score, issuecomment-6846882395).** Arms: FABLE = `claude-fable-5-2 --effort high`, OPUS2 = `claude-opus-5-5 --effort medium`, OPUSX = `claude-opus-5-5 --effort xhigh`. All three use the October diplomatic prompt and the sealed one-image runner, through subscription `claude -p`. Every row's `modelUsage` named the requested model (Set A 428 rows, Set B 112; none wrong). The rule for "Fable reads better" has three parts:
- the paired FABLE − OPUS2 gap is negative under both d1-vs-d1 and mean-of-two-draws;
- its 95% interval, resampled by work, excludes 0;
- the gap is larger than either arm's own d1 − d2 spread.

The smallest gap the test can detect at this n is about 2–2.5 points.

### Sets
- **Set A**, 75 scored pages in 52 works with expert references (October's 76, minus one). The excluded page is `rasam|BULAC_MS_ARA_417_0069`: this box's copy of its image is a truncated 65,536-byte JPEG, which shows grey below a strip of paper. October read the full file on main. The fault was found by eye, and it is the only bad file of the 76. The four strata are Bentham English (20), CREMMA medieval Latin (18), HTRomance early modern French (20) and RASAM Arabic (17).
- **Set B**, 39 of our own manuscript pages (October's 40). They were scored against KEY-O, KEY-G and KEY-F, which models built, so this set is **DIRECTIONAL**. Page `699067ef…:260` was dropped because no key can judge it: KEY-G and KEY-F carry another leaf's text, and KEY-O is all `[?]` (see by eye). Twelve of our R2 images no longer match their October hashes, so the October request images were used, not fresh fetches.

### Set A results (mean page CER %, 95% CI by work)

| arm | d1 | d2 | failed (d1/d2) | s/page | output tok | list $/page |
|---|---|---|---|---|---|---|
| FABLE | 6.9 [5.2, 9.1] | 7.0 [5.2, 9.2] | 0 / 0 | 34 | 3,470 | 0.103 |
| OPUS2 | 9.4 [6.8, 12.5] | 9.5 [6.8, 13.0] | 2 / 3 restarted | 19 | 1,815 | 0.070 |
| OPUSX | 9.3 [6.6, 12.7] | 10.1 [5.6, 15.1] (36 pages) | 0 / 0 | 62 | 5,690–6,145 | 0.147–0.158 |
| stored Opus (Oct, default effort) | 9.9 [7.2, 12.9] | — | 1 restarted | 23 | — | 0.072 |
| stored Gemini 3.1 Pro (Oct) | 14.1 [9.6, 19.2] | — | 3 restarted | 152 | — | — |

- **Seconds** come from the CLI's `duration_ms`, which excludes the pace guard's wait for a slot. They are taken from d2 rows, n = 75. Many d1 rows lack the field, and their wall time includes slot waits of up to 40 minutes.
- **List price** is the CLI's `total_cost_usd`. The arms ran on the subscription, so no money was spent.
- **"Failed = 1.0" column:** FABLE 6.9 / 7.0, OPUS2 11.8 / 13.2, OPUSX 9.3.

Paired differences, on pages both arms read:

| pair | gap (pts) | n |
|---|---|---|
| **FABLE − OPUS2, d1** | **−3.2 [−5.1, −1.7]** | 73 |
| FABLE − OPUS2, d2 | −3.4 [−5.5, −1.7] | 72 |
| **FABLE − OPUS2, mean of two draws** | **−2.8 [−4.3, −1.5]** | 71 |
| FABLE − OPUSX, d1 | −2.4 [−3.8, −1.2] | 75 |
| FABLE − OPUSX, mean of two (OPUSX d2 partial) | −2.5 [−4.4, −0.8] | 36 |
| OPUSX − OPUS2, d1 | −1.1 [−2.2, −0.2] | 73 |
| OPUS2 − stored Opus, d1 / d2 | −0.3 [−1.7, +1.0] / 0.0 [−1.4, +1.4] | 72 |
| FABLE − stored Pro, d1 | −7.1 [−10.3, −4.2] | 72 |

**Draw-to-draw spread (d1 − d2):**
- FABLE: −0.0 [−0.4, +0.3], mean |page change| 0.8 points;
- OPUS2: +0.1 [−0.7, +1.1], mean |page change| 1.7;
- OPUSX: +0.2 [−1.7, +1.6], 36 pages.

The FABLE − OPUS2 gap is about 3 points against a spread near 0, so it passes the rule on all three parts. Fable is also the more stable reader of the two.

**By stratum (FABLE − OPUS2, mean of two draws):**
- Bentham English: −0.2 [−0.5, −0.1] (n 20);
- CREMMA Latin: −6.5 [−11.9, −2.1] (n 14);
- HTRomance French: −0.6 [−1.3, −0.0] (n 20);
- RASAM Arabic: −5.2 [−7.7, −2.9] (n 17).

The lead rests on two strata, not one.

**Best-of-two (ORACLE, not achievable without a reference):** FABLE 6.5, OPUS2 9.5, OPUSX 8.8.

### Set B results (DIRECTIONAL, model-built keys)

| pair | KEY-O | KEY-G | KEY-F |
|---|---|---|---|
| FABLE − OPUS2 | +1.3 [−0.0, +2.8] (36) | −0.7 [−2.0, +0.3] (36) | 0.0 [−1.6, +1.7] (35) |
| FABLE − OPUSX | −0.1 [−1.4, +0.9] (30) | −1.0 [−2.4, +0.1] (30) | −0.9 [−2.3, +0.2] (30) |

All the readers come out level. The keys cannot rank a reader that reads more than the models that built them. On both Hebrew pages checked by eye, Fable's read was better than every key. OPUSX Set B stopped at 32 of 40 pages, when the account hit its weekly limit.

### By eye (`results/fable-mss-92/byeye-setA.md`)
Kind of evidence: Opus 5.5 reading each page image against the reads. This is one model's judgment, not a reference.
- **The five largest FABLE − OPUS2 page gaps** all favour Fable, and all are CREMMA Latin pages. The gap is mostly real reading. Opus left whole lines as `[?]` on two pages, and Opus's misreads were in places Fable read correctly. Part of the gap is an artefact:
  - Opus expanded abbreviations against the diplomatic prompt;
  - Opus padded abbreviated words with `[?]`;
  - on one page Opus skipped whole lines.
- **Recitation and invention.** No Fable read is longer than 1.3× its reference, and there are no recited famous passages. But Fable filled hard spots with fluent, on-topic Latin that is not on the page in three draws on three pages (Vat. Pal. lat. 373 3r d1 and 4r d2, CCCC 165 p.29 d2). On 4r d2 it wrote "Gregorius" where the page names Bradwardine. In each case the other draw read the spot correctly. Two draws disagreeing is the visible tell, and a single-draw CER hides it.
- **Fable declined nothing.** It returned two empty reads. One was the truncated image (empty is correct there). The other was a timeout on an ordinary page, re-run and read well.
- **Set B Hebrew.** Fable read both pages faithfully, and better than the keys. While checking these, the *served* transcription of both pages turned out not to be the leaf's text: a fluent Zohar passage, and a list of zodiac signs. This was contained in the same run (#270: books held, English withheld by eye, label `contained`).

### Caveats
- OPUSX has one full draw on Set A and 36 pages of a second, and 32 of 40 pages on Set B. The run stopped at team@ 85% weekly, as the brief required.
- **Infra failures re-run, not scored.** The re-runs recovered these errors: Cloudflare 403s at auth, the CLI not yet knowing the id `claude-fable-5-2`, pace-guard refusals, and 900 s timeouts that were slot waits. The scorer counts any such error still standing as "not run", never as a failed read (`INFRA` in `score-92.py`).
- Two H318 pages were excluded, as in October.

### Reads (kept in scratch, archived to R2 with it)
- `$JOB_SCRATCH` = `/data/scratch/sl/jobs/fable-ocr-mss-92`:
  - `setA/out/{FABLE,OPUS2,OPUSX}-d{1,2}.jsonl(.gz)`
  - `setB/out/{FABLE,OPUS2,OPUSX}-d1.jsonl(.gz)`
  - by-eye packets in `byeye/`
- The design text is `design.md`.
- Scores: `results/fable-mss-92/score-set{A,B}.{json,txt}`. They hold numbers only, with no reference text.
- Reproduce: `python3 scripts/eval/fable-mss-92/score-92.py --set setA --root $JOB_SCRATCH --json out.json`
