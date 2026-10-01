## 2026-09-25 (late) — Seam FIDELITY judge: source beside both translations, gated lane vs production (#4681) — production ahead on fidelity; the page break is a defect hotspot for BOTH

Every earlier seam decision (#4912, #4968, #5020, #5053, the rejudge above) used a judge that saw only the
English on both sides of the break: it can score smoothness, never faithfulness, and it rewarded an omission
and two fabricated bridges. This draw gives the judge the OCR of the same two page-excerpts (arm-independent,
so blinding holds) and asks for a defect list per side — OMISSION, ADDITION, MISTRANSLATION, UNTRANSLATED,
DUPLICATION, each quoted against the source — BEFORE a fidelity verdict; fluency asked separately. Lane =
the same nine shadow runs re-choosing repair vs draft with the #5085 gates (`--regate`). 111 junctions
(63 S1/P, 48 A/A), 8 Opus judges (fidelity reading of early modern Latin/German needs a translator, not a
reader of English), subscription, $0 API. Tag `translation-batch-seam-fidelity`; harness flags `--regate
--with-source`, `--score --field=fidelity|fluency`.

| pair | fidelity (a / b / tie) | fluency (a / b / tie) | breaks with ≥1 defect |
|---|---|---|---|
| A/A, S1 vs S2 | 14 / 14 / 20 | 12 / 9 / 27 | S1 71%, S2 60% |
| lane S1 vs production P | 18 / **25** / 20 | 15 / 19 / 29 | lane 76%, production 75% |

Defect counts, S1/P breaks: lane 83 (39 mistranslation, 17 omission, 10 duplication, 9 untranslated, 8
addition); production 69 (28 / 14 / 12 / 5 / 10).

**Instrument check:** the A/A row splits 14–14 — the judge does not invent a preference between identical
arms. 14 random defect claims read against the source: 9 real, 3 real-but-minor, 2 not defects (a name
rendered as "Arnauld"; "in pago" as "territory") — ~80% precision, both arms alike, so counts overstate by
about a fifth.

**Read:** on fidelity at the seam production is ahead, 25–18 (58% of decided; the A/A floor is dead even),
and the lane makes more mistranslations. Not shown non-inferior. And the larger finding: **three in four
mid-flow page breaks carry a fidelity defect in production too.** By source mechanism: where the page ends
on a split word ("Damna-|mnatur") or a catchword repeated on the next page, production is defective at
10 of 12 breaks, the lane at 10 of 12 — the translator translates the catchword twice, splits the word
into two, or drops it. Those are mechanical and fixable before any model sees the page. Issue filed.
