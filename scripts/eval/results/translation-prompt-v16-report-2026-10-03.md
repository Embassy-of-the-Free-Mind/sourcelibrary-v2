# Translation prompt v13 vs v16: result (2026-10-03)

PRIOR ART: `translation-prompt-v15-report-2026-09-12.md`. Same study, same harness and same pinned pages, with v16 in place of v15. This file is that study's v16 result.

**Recommendation: do NOT flip. Keep v13 as the default.** v16 does not do the one thing it was written for. Interpretive notes still fall **−28.7%** (v15: −36.8%), against a pre-registered floor of −15%. The judge no longer finds v16 the losing side (7:6), so the loss is smaller than v15's. Four of v16's seven losses are still dropped explanatory notes. The decision is Derek's.

Pre-registration: `../PREREGISTRATION-translation-prompt-v15.md` + `../PREREGISTRATION-translation-prompt-v16-amendment.md` (Amendment 2, committed before the run). Harness: `../translation-prompt-ab.mjs --tag v16 --b 16`. Raw arms: `translation-prompt-v16-arms.jsonl`. Score: `translation-prompt-v16-report-2026-10-03.json`. Judge: `translation-prompt-v16-judge-{packet.jsonl,key.json,verdicts-raw.json,verdicts.json}`.

## Run

- Same 320 pinned pages as 2026-09-12. Both arms were re-run fresh, flat on `gemini-3.1-flash-lite` as in #4767.
- 640 calls, 0 errors. One v13 page returned RECITATION, so 319 pages were scored.
- Actual spend **$1.264**: the estimate was $1.47, the hard cap $3.
- Rows: v13 `51651014` (default), v16 `0ce1f483` (non-default, `_id` 6ac0dd8dad45828f8b3ced30).

## The decision rule, criterion by criterion

| # | criterion | result | pass |
|---|---|---|---|
| 1 | paired CI on Δ verified-rate excludes zero, positive | Δ +0.7 pp, 95% CI [−12.3, +13.7], 25 paired pages; sign 3–4 | **no** |
| 2 | pooled verified-note rate gain ≥ 3 pp | 88.0% [79.1, 95.7] → 91.3% [82.9, 97.6] (+3.3 pp) | yes (barely) |
| 3 | note emission not down > 20% | original-notes/page 0.37 → 0.97 (+164%) | yes |
| 4 | body length not down > 10% (pages where neither arm hit MAX_TOKENS) | −13.9% on 318 pages, **but see below** | **no** (as written) |
| 5 | no regression gate fires | em-dashes 0.40 → 0.61/page, decisive | **no** |
| 6 | blind judge: v16 worse ≤ 1.5× v13 worse | v16 worse **7**, v13 worse **6**, equivalent 17 (sign p = 1.0) | yes |
| 7 | interpretive notes not down > 15% (Amendment 2) | 1.24 → 0.89/page, **−28.7%**; paired Δ −0.36 [−0.61, −0.13] | **no** |

Verdict under the rule: **not established, do not flip.**

The other gates:

| gate | v13 | v16 | change |
|---|---|---|---|
| housekeeping tags | 0.28 | 0.03 | −89%, decisive |
| invented tags | 0.02 | 0.01 | n.s. |
| glossary blocks | 0 | 0 | none |
| inline terms | 4.05 | 4.13 | +2% |

## What the failures are made of

- **Criterion 7 is the real one.** v16's one sentence recovers about a fifth of what v15 lost: interpretive notes per page are 1.24 → 0.89 under v16, against 1.27 → 0.81 under v15. Every stratum's point estimate is still down.
  - The judge independently finds the same loss on the same pages: "the Nuncio, a papal diplomat" (latin-print), the al-Jazariyyah note and the Arabic titles (arabic), and the note on the Taiwanese album (cjk-print).
  - Scoping the OMIT rule in words does not undo it. The model writes fewer explanatory notes once the prompt teaches it that a missing note is harmless.
- **Criterion 4 is a v13 runaway again.** Tibetan page `69e7ac6e…:27`: v13 wrote 107,373 chars (1,369 sentences, 18 distinct) and stopped *under* the token cap, with `finishReason: STOP`. Amendment 2's `MAX_TOKENS` rule therefore did not catch it. Without that page, body length is 2,105 → 2,099 (**−0.3%**), with a median per-page ratio of 0.999. Amendment 1's "(or a repetition detector)" should have been pre-registered.
- **Criterion 5 (em-dashes) is the translator's own prose.**
  - Pages whose OCR has no em-dash go from 0.29 to 0.53 dashes per page. Pages whose OCR has one go from 1.72 to 1.52.
  - The increase is concentrated in Hebrew (0.23 → 1.07), Arabic (0.42 → 0.95) and CJK (0.23 → 0.63).
  - 117 of 122 such dashes in those strata are in body prose ("aligned one against the other—like a point—as if…").
  - v15's em-dash rule ("punctuation you are reproducing from the source is not yours to change") seems to loosen it. v15 showed the same direction, +0.14, not decisive.
- **Criterion 1 fails because the baseline moved, not because v16 got worse.** Today's v13 verifies **88%** of its original-notes, against 76% for the 2026-09-12 v13 outputs under the same verifier. It also writes fewer of them, so only 25 pages emit notes in both arms. The pooled gain is +3.3 pp, against +21 pp for v15 on 2026-09-12 under today's verifier.

## By stratum (reported, not gated; Δ CIs are paired, page-resampled)

| stratum | verified v13 | verified v16 | Δ 95% CI | original-notes/pg | interpretive notes/pg (Δ CI) |
|---|---|---|---|---|---|
| **hebrew** | 77.8% (18 notes) | **99.0%** (99) | [−2.2, +52.8] | 0.5 → 2.5 | 2.42 → 1.95 [−1.45, +0.40] |
| **arabic** | 71.4% (21) | **100%** (15) | [0.0, +58.3] | 0.5 → 0.4 | 1.82 → 1.18 [−1.98, +0.30] |
| latin-print | 100% (27) | 82.6% (23) | [−47.1, 0.0] | 0.7 → 0.6 | 0.88 → 0.65 [−0.47, +0.05] |
| german-print | 100% (14) | 96.2% (26) | [−6.5, 0.0] | 0.3 → 0.7 | 1.40 → 0.75 [−1.65, +0.03] |
| greek-print | 100% (11) | 77.5% (80) | [−41.9, −1.8] | 0.3 → 2.1 | 1.05 → 0.67 [−0.95, +0.08] |
| cjk-print | 0% (2) | 93.0% (43) | [+87.5, +100] | 0.1 → 1.1 | 1.05 → 0.97 [−0.60, +0.50] |
| bph-mss | 100% (7) | 100% (15) | [0, 0] | 0.2 → 0.4 | 0.50 → 0.38 [−0.35, +0.07] |
| tibetan-mss | 88.2% (17) | 100% (8) | [0.0, +36.4] | 0.4 → 0.2 | 0.82 → 0.55 [−0.57, +0.03] |

**Hebrew and Arabic.** v16 removes the fabricated original-notes that remain, and on Hebrew it writes five times as many verified ones. Neither CI excludes zero, because v13 now emits few notes there (18 and 21 notes over 40 pages). The interpretive-note loss is largest in these two strata in absolute terms.

**Greek and Latin "regressions" are three pages, and two of them are not fabrication.**
- On a Greek uncial page (`6953a861…:178`, scriptio continua, lunate sigma), v16 quotes the Genesis phrases in normalised minuscule. They are on the page, but not character-for-character.
- On a Latin page (`6a4bd575…:14`), the OCR itself carries `<term>` markup inside the cited phrase ("Cujacio ad `<term>`Novellam`</term>` 32"), so no verbatim quote can string-match it. That is a verifier blind spot.
- On a Greek accounts page (`69aea5b0…:197`), v16 quotes expansions of abbreviations that are not on the page. That is a real breach of the rule.

## Things this run found that matter beyond v16

1. **The verifier moved on 2026-09-13 (#4777).** Re-scored with today's verifier, the *unchanged* 2026-09-12 outputs give:

   | | 2026-09-12 report | today's verifier |
   |---|---|---|
   | v13 overall | 66.7% | 76.3% |
   | v13 Hebrew | 8.3% | 25.0% |
   | v13 Arabic | 28.6% | 42.9% |

   #5698's "Hebrew 8% verified, Arabic 29%" is therefore stale. The 2026-09-12 headline counted orthography and romanisation as fabrication.
2. **v13 itself drifted between runs.** Same prompt, same pages, same model name, three weeks apart:
   - verified rate: 76.3% → 88.0%;
   - original-notes per page: 0.42 → 0.37;
   - invented tags: 0.25 → 0.02 per page.

   The invented-tag drop is most likely the write-time tag repair now inside `sanitizeTranslationTags` (#5323, #5644), which the harness applies to raw output. If so, the invented-tag gate now measures the sanitizer, not the prompt. Either way, a v13 baseline older than about two weeks is not a baseline.

## What it would take

Not another sentence. The interpretive-note loss survived an explicit scoping clause, so the fix belongs in the typed apparatus #5698 step 2 already plans (v17). There, `context`/`clarification` notes are their own requested type, with their own count, rather than collateral of an `original` rule. Carry forward two things:
- the verbatim rule as v15/v16 state it, which is what makes Hebrew/Arabic/CJK original-notes real;
- a repetition-based loop classifier, pre-registered, so that criterion 4 stops being decided by one runaway page.
