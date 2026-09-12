# Translation prompt v13 vs v15 — result (2026-09-12)

PRIOR ART: `results/vision-vs-gemini-2026-09-11.md` and `results/calibration-scorecard-*.md` — same house shape (result file next to the JSON the scorer wrote, criterion table, decomposition); this is the result of a different study and duplicates nothing.

**Recommendation: do NOT flip v15 as-is. Seed a v16 that keeps everything and narrows one sentence, then re-run the two gates that failed (~$1.30).** Details below; the decision is Derek's.

Preregistration: `../PREREGISTRATION-translation-prompt-v15.md`. Harness: `../translation-prompt-ab.mjs`. Raw arms: `translation-prompt-v15-arms.jsonl`. Score JSON: `translation-prompt-v15-report-2026-09-12.json`. Judge: `translation-prompt-v15-judge-{packet.jsonl,key.json,verdicts.json}`.

## Run

320 pages from 320 books, 8 strata × 40, both arms on **`gemini-3.1-flash-lite`** (flat, not production routing — Derek's call, see the preregistration's "As executed"; the open routing question is #4759). 640 calls, 0 errors, **$1.26** actual (estimate $1.47). Ran on Hetzner; the laptop's network is geo-blocked by Gemini.

## The decision rule, criterion by criterion

| # | criterion (pre-registered) | result | pass |
|---|---|---|---|
| 1 | paired CI on Δ verified-rate excludes zero, positive | Δ = +28.9 pp, 95% CI [+14.7, +44.7], 33 paired pages; sign test 13–0, p < 0.001 | **yes** |
| 2 | verified-note rate gain ≥ 3 pp | **66.7% → 96.3%** (+29.6 pp); v13 CI [52.6, 81.4], v15 CI [93.3, 98.7] | **yes** |
| 3 | note emission not down > 20% | original-notes/page 0.42 → 0.77 (**+82%**) | **yes** |
| 4 | body length not down > 10% | mean −26.1% — **but see below** | **no** (as written) |
| 5 | no regression gate fires | invented tags −95%, housekeeping −91.5%, glossary 0→0, em-dashes +0.14/page (n.s.), inline terms +22% | **yes** |
| 6 | blind judge: v15 worse ≤ 1.5× v13 worse | v15 worse **8**, v13 worse **1**, equivalent 21 (30 pairs) | **no** |

Verdict under the rule as written: **not established — do not flip.** The rule is not rewritten after the fact; what follows is the decomposition so the call is made on what the numbers are made of.

## What the two failures are made of

**Criterion 4 (body −26%) is two v13 catastrophes, not v15 loss.** Two pages (a Syriac page catalogued as Hebrew, a Tibetan folio that repeats one phrase) sent v13 into a runaway loop to the token cap — 96,108 and 138,013 characters of "and likewise examine the minds of all sentient beings". v15 wrote a `<warning>` on both. Those two pages are the whole gap: excluding them, mean body is 2,110 → 2,104 (**−0.3%**); median per-page ratio 0.994, IQR 0.95–1.03. Recorded as Amendment 1 in the preregistration (prospective: classify loops, report loop rate, gate on normal pages). On this criterion v15 is not worse; it is the arm that handles the pathological page correctly.

**Criterion 6 (judge 8:1 against v15) is half by-design and half a real side effect.**

| class | pairs | what |
|---|---|---|
| running header not reproduced (`Vorrede` → "Preface", `שער כ` → "Gate 20") | 4 (+1 mixed) | **#3825 item 4 by design** — headers belong to the transcription the reader already has. Corpus-wide: `<header>` on 24/320 v13 pages vs 2/320 v15. The judge brief did not exclude this class; it should have. |
| interpretive `<note>` not written ("the Nuncio, i.e. the Papal Ambassador", "Pietro Bembo, the cardinal", "references Quran 22:36", "wordplay in *qawāʾil*") | 3 (+1 mixed) | **Real side effect.** Across all 320 pages, interpretive (non-`original:`) notes fall **1.27 → 0.81 per page (−36%), in every stratum** (Arabic 2.85 → 1.30, Hebrew 2.15 → 1.52, Latin 0.82 → 0.63). The verbatim rule's "if you cannot copy it exactly, OMIT the note" is being read as licence to omit notes generally. |
| a clause dropped from the translation | 1 | one page (Greek print); no pattern found. |
| v13 worse | 1 | a Tibetan title collapsed. |

Excluding the by-design header class: **v15 worse 4, v13 worse 1** — still > 1.5×, still a fail, and the interpretive-note count says the judge is right.

## By stratum (verified-note rate; emission in parentheses)

| stratum | v13 | v15 |
|---|---|---|
| latin-print | 96.2% (0.7/pg) | 92.0% (0.6/pg) |
| german-print | 90.9% (0.3) | 97.6% (1.1) |
| greek-print | 76.7% (0.8) | 95.5% (1.1) |
| hebrew | **8.3%** (0.3) | 93.3% (0.8) |
| arabic | **28.6%** (0.2) | 100% (0.3) |
| cjk-print | 63.0% (0.7) | 98.5% (1.6) |
| bph-mss | 80.0% (0.1) | 100% (0.2) |
| tibetan-mss | 47.1% (0.4) | 95.2% (0.5) |

Fabrication is script-dependent, as expected, and it is far worse than the corpus 91% suggested: on Hebrew and Arabic v13's original-notes are **mostly fabricated**. v15 fixes that outright. Latin, already near ceiling, does not move (the −4 pp is 1 note in 25; the CI covers it).

## What v15 does well — keep all of it

- Verified-note rate 67% → 96%, while writing **more** original-notes, not fewer. The rule works and does not game the metric.
- Invented tags −95%, housekeeping-tag leakage −91%: items 1 and 4 land.
- Inline `<term>` supply +22% — the learn route's flashcard concern did not materialise.
- Refuses corrupted pages with `<warning>` instead of looping to the token cap (2/2).

## What to change — v16

One sentence, in the verbatim rule: make explicit that the OMIT instruction applies to the quoted phrase in an `original:` note only, and that interpretive notes (identifications, references, wordplay) are still wanted wherever a reader would need them. Everything else stays. Re-run only what failed: the 30-pair judge with the header class excluded from the brief, plus the interpretive-note count as a named outcome with a floor (say −15%). Cost ≈ $1.30 for the arms; the judge is subscription.

## Does this extrapolate to the strata that ship on full flash?

Measured on `gemini-3.1-flash-lite` only. Six of eight strata ship on `gemini-3-flash-preview` in production. I would **not** assume the magnitudes carry: the fabrication baseline on lite (8% verified on Hebrew) may be much better on full flash to begin with, which would shrink the gain; and the interpretive-note suppression may be smaller or larger on a model that follows instructions more literally. The *direction* is probably robust — the rule is a copy-or-omit instruction, and a more capable model should follow it at least as well — but that is a belief, not a measurement. #4759 is the place to settle whether those strata should be on lite at all; if they move to lite, this result applies to them directly.

## Files

- `translation-prompt-v15-sample.json` — the pinned draw
- `translation-prompt-v15-arms.jsonl` — 640 raw outputs with tokens and cost
- `translation-prompt-v15-report-2026-09-12.json` — the scorer's output
- `translation-prompt-v15-judge-packet.jsonl` / `-key.json` / `-verdicts.json` — the blinded pairs, the unblinding key, and the six lean-worker verdict sets, unblinded and tallied
