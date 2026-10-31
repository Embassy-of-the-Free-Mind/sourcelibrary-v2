---
stage: translation
measure: [accuracy, judged]
languages: [zh, sa, la, de, fr]
scripts: [Hani, Deva, Latn]
canons: []
n_books: 40
n_pages: 40
verdict: "A life-words block (v21) took the unlicensed 'life force' / 'vital energy' glosses on 3.8 Flash from 7/35 target pages (noise arm 4/35) to 0/35, p 0.016. It kept 'life force' on all 5 pages whose source says Lebenskraft or vis vitalis. Judged fidelity did not fall: v21 − v13a +0.20 [+0.03, +0.38], v21 − pooled v13 +0.10 [−0.05, +0.25]. The pre-registered rule passed on all four clauses."
status: adopted
decision: "Translation prompt v21 (v13 + the life-words block) is the default from 2026-10-31; v13 is the rollback"
superseded_by: null
issue: [7458]
---
<!-- PRIOR ART: 2026-10-26-translation-prompt-v19-cognates-4741.md (the same one-block design against v13a/v13b; it measured cognate terms in Latin, not apparatus vocabulary). -->

## 2026-10-31 · Does a life-words block stop the translator from glossing breath as "life force"? (#7458)

**Question.** The model's own `<gloss>`, `<note>` and `<term>` apparatus says "life force" or "vital energy" on 17,696
stored pages (count 2026-10-26, #7458). `<gloss>vital energy</gloss>` alone is on 4,550 pages, nearly all of them 氣.
That imports a modern vitalist reading into sources that say breath, vapour or lifespan. Does one block in the prompt
stop this on new writes, and does it cost anything elsewhere?

**The block** (`LIFE_WORDS` in `scripts/maintenance/translation-prompt-v21-life-words.mjs`, inserted before
`**Instructions:**`):
- render 氣 as breath, vapour or air, or keep `<term>qi</term> <gloss>breath, vapour</gloss>`;
- render prāṇa as breath, āyus as lifespan, and 命 as life, lifespan or allotted fate;
- render pneuma, spiritus, ruach, rlung and srog as the source uses them;
- write "life force", "vital force" or "vital energy" only where the source names such a force itself (vis vitalis,
  Lebenskraft, force vitale).

**Design.** Rule pre-registered in `scripts/eval/PREREGISTRATION-gloss-life-words-7458.md`, committed (79169b122)
before any arm ran. Runner: `scripts/eval/gloss-life-words-7458/run.mjs`.
- **Arms:** `v13a` (the live default as production sends it: page-break rules, previous page's English, neighbouring
  OCR), `v13b` (the same again, as the noise floor) and `v21`.
- **Engine:** agy `gemini-3.8-flash-low`, one page per call, $0. In the week to 2026-10-31 this engine wrote 73% of new
  translations (94,815 of 130,798) and 826 of the 976 flagged pages. Opus wrote the rest, and the paid lite lane wrote
  under 1%.
- **Pages:** 40, one per work, live books only, seed 7458.
  - 35 target pages: the stored English has an unlicensed life phrase in its apparatus. Chinese 12 (OCR has 氣),
    Sanskrit 9, Latin 7, German 7.
  - 5 controls: the OCR itself says Lebenskraft (3) or force vitale (2).
- **Mechanical measure:** `lifeWordFindings` (`scripts/lib/life-word-gloss.mjs`).
- **Judges:** 5 blind Opus subagents, 8 pages each, with the page image opened, the OCR, and the three translations
  under shuffled letters (`JUDGE.md`). Per translation they gave fidelity 1–5, life-word renderings right and wrong,
  and serious errors.

### Results

**P1, effect (mechanical): pass.** Target pages with an unlicensed life phrase in gloss, note or term:

| | stored English | v13a | v13b | v21 |
|---|---|---|---|---|
| all target pages (35) | 35 | 7 | 4 | **0** |
| Chinese (12) | 12 | 5 | 3 | 0 |
| Sanskrit (9) | 9 | 2 | 1 | 0 |
| Latin (7) | 7 | 0 | 0 | 0 |
| German (7) | 7 | 0 | 0 | 0 |

- v21 vs v13a: 7 discordant pages, all favouring v21 (exact two-sided p = 0.016).
- v13b vs v13a: 4 vs 1 (p = 0.38).
- The stored English is flagged on every page because these pages were drawn for it. 3.8 Flash under v13 already
  does it far less often than the older writers did (7 and 4 pages of 35, against 35).

**P2, judged life-word accuracy on target pages: pass.**

| | right | wrong | accuracy | pages with a wrong one |
|---|---|---|---|---|
| v13a | 136 | 20 | 0.872 | 13 |
| v13b | 153 | 7 | 0.956 | 7 |
| v21 | 151 | 5 | 0.968 | 5 |

The two v13 runs differ by nearly as much as v21 differs from the better of them. Read this as "no worse, probably
better", not as a measured gain.

**P3, no regression: pass.**
- Judged fidelity means: v13a 4.23, v13b 4.43, v21 4.43.
  - v21 − v13a: +0.20, 95% bootstrap [+0.03, +0.38]; the bound was ≥ −0.15.
  - The floor, v13b − v13a: +0.20 [+0.05, +0.35]. v13a was simply the weaker draw.
  - v21 − mean(v13a, v13b): +0.10 [−0.05, +0.25].
- Pages with a serious error: v13a 10, v13b 8, v21 12. The rule allowed v13a + 2 = 12, so this is at the limit.
  - Of v21's 12, one comes from the block: on zh-4, yin and yang are glossed "receptive breath" and "active breath".
  - The rest are unrelated to it:
    - a page header turned into a book title;
    - a garbled Sanskrit line and numeral slips;
    - a cropped margin note;
    - a continuity `<meta>` that quotes the previous page (the #7085 defect v18 fixes);
    - errors that the v13 arms share (zh-1, zh-2, la-2, ctl-3, sa-3, sa-4).

**P4, controls: pass.** All three arms keep "life force" / "vital force" on all 5 pages where the source names
Lebenskraft or force vitale. The judges marked none of those renderings wrong.

### What the judges saw, by eye

- v13 arms wrote, for 氣:
  - `<term>qi</term> <gloss>vital energy</gloss>` (補氣, zh-10, both runs);
  - "the vital energy endures" for 氣久 (zh-5, both runs);
  - `<gloss>vital cosmic energy</gloss>` for 天地之氣 (zh-9).
- v13 arms wrote, for prāṇa:
  - `<gloss>vital life force</gloss>` for prāṇa-śakti (sa-6);
  - `<gloss>vital force</gloss>` for prāṇasya (sa-8).
- **The template can overreach.** v21 glossed 胃氣 (stomach qi) as `<gloss>breath, vapour</gloss>`, where the judge
  wanted the medical sense (zh-12). It also carried "breath" over to yin and yang (zh-4). These are the cost of naming
  one gloss: a reading that is literal where the context is technical. They are rarer than the error they replace
  (2 pages, against 13 and 7 with a wrong life word).

### Decision

All four pre-registered clauses hold, so v21 is seeded and made the default. That is the `--promote` step of
`translation-prompt-v21-life-words.mjs`. It refuses unless v13 is the single default with its registered hash. It
stamps both rows. **Rollback:** set `is_default` true on v13 and false on v21.

### Limits
- One engine. Opus (27% of this week's writes, 3.8 flagged pages per 1,000 against Flash's 8.7) and lite were not
  run. The block is a vocabulary instruction and changes no structure, so this was not tested further.
- 40 pages, one draw, one judge per page. The noise floor on the judged measures is as wide as the effects, so only
  the mechanical measure is a measured gain.
- **Stacking:** the #7499 v20 candidate (unmerged, on `job-prompt-bench-7499`) and PLAIN are built from v13. If either
  is adopted, it should carry this block: `buildV21()` anchors on `**Instructions:**`, which v20 also has.
- **Not done:** the 17,696 stored pages are not rewritten (brief). The standing count for new writes is
  `scripts/audit/life-word-glosses.mjs`. Under v13, 2026-10-24 → 2026-10-31, it found 976 of 130,798 new translations
  with an unlicensed phrase: Chinese 915 (9.5 per 1,000), Tibetan 44, German 8, French 5, Latin 4.

Files: `scripts/eval/results/gloss-life-words-7458/` holds `units.json`, `reads.jsonl`, `prompts/`,
`verdicts-*.json`, `judge-key.json` and `report.json`.
