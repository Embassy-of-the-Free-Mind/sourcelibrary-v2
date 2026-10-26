# Pre-registration: translation prompt v19 (cognates, kept distinctions) vs v13 — #4741

PRIOR ART: scripts/eval/PREREGISTRATION-translation-prompt-v14.md — same arm design (v13a / v13b noise floor / candidate) and format; its units come from the 2026-09-30 audit strata, which do not select pages for the key terms this measures.

Committed before any arm output exists. Runner: `scripts/eval/translation-cognate-ab-4741.mjs`.

## Question

Does adding a "key terms" block to the live translation prompt (v13) make Latin translations keep the author's
vocabulary (English cognate where the meaning matches, one source word → one English word, distinct source words
kept distinct) without introducing false-friend errors or costing readability?

Trigger: Spinoza's *concordia* was rendered "harmony" on 35 pages across four editions (corrected 2026-10-26),
erasing a distinction Spinoza draws himself (Ethics I App. dismisses *harmonia*). The v13 style line ("warm museum
label") favours the idiomatic "live in harmony" for *concorditer vivere*.

## Arms (same units, same model, same door)

| arm | prompt |
|---|---|
| `v13a` | live default, prompts type translation v13 |
| `v13b` | v13 again: the A-vs-A noise floor (sampler + judge) |
| `v19` | v13 + the KEY TERMS block below, inserted after the line "9. Preserve the voice and spirit of the original." |

Model `gemini-3.1-flash-lite` (the Latin production model, `MODEL_LITE`), thinking off as in production,
**temperature 1.0** (production sets none; 1.0 is the Gemini 3 default; `callGemini` would otherwise send 0 and
shrink the noise floor), `maxOutputTokens` 8192. Prompt built by `buildTranslationPrompt` (translate-core) with
**no previous-page continuity text** (`context_given: null`), so a stored v13 translation cannot carry its terms
into the v19 arm. Reply passed through `sanitizeTranslationTags`.

The KEY TERMS block (examples name only *concordia* and *consonantia*; every other measured term is held out):

```
10. Key terms — keep the author's vocabulary:
   - Where a source word has an English cognate with the same meaning, use the cognate (concordia → concord, consonantia → consonance). Do not swap in a near-synonym because it sounds more natural: concordia is "concord", not "harmony".
   - Keep the author's distinctions: never render two different source words with the same English word, and render the same source word the same way each time it occurs on the page.
   - Watch for false friends, where the English cognate has drifted in meaning (virtus is often power or excellence rather than moral virtue; experimentum is often experience; religio, pietas, ingenium, convenientia). There, translate the sense and add <note>original: "..."</note>.
```

## Units (one page per book; books are the unit)

Latin books, `visible: true`, `pages_count > 0`, page OCR ≥ 600 characters. Seed 4741. Strata drawn in this
order, a book used once:

- **T (terms), 24 books**: OCR matches `concord|consonan|sympath|antipath|proporti|symmetri|temperament`.
- **F (false friends), 12 books**: OCR matches `virtut|virtus|experiment|convenienti|religio`.
- **C (control), 12 books**: any page.

48 units × 3 arms = 144 calls. Estimate ≈ $0.25 (flash-lite list price); under the $10 floor, ledgered.

## Measures

1. **Term fidelity (mechanical, primary; stratum T).** For each term family present in the page's OCR, does the
   English contain its cognate stem? Families → English stem: concord→`concord`, consonan→`consonan` (NAMED in the
   prompt); sympath→`sympath`, antipath→`antipath`, proporti→`proportion`, symmetri→`symmetr`,
   temperament→`temperament` (HELD OUT). Unit score = families matched / families present, computed on the
   translation body with `<note>`/`<summary>`/`<keywords>`/`<meta>` removed (a cognate parked in a note does not
   count). Reported separately for named and held-out families. Also: **conflation** = English `harmon` in the body
   on a page whose OCR has no `harmoni|armoni` (any stratum).
2. **Fidelity preference (blind judge).** Pairwise, Latin OCR + two English texts, A/B order seeded: which renders
   the source more faithfully (A / B / tie), serious meaning errors in each (count), false-friend errors in each
   (count), and which reads better (A / B / tie). Pairs: `v19 vs v13a` (all units), `v13b vs v13a` (noise, all
   units), and a **same-arm control** (`v13a vs v13a`, byte-identical) on 12 units, whose tie rate is read first.
   Judges: Claude Opus subagents on the subscription, one judge per pair (exploratory; no α).

## Decision rule (fixed now)

Recommend v19 as the default to Derek only if ALL hold:

1. **Term fidelity, held-out families**: v19 − v13a ≥ +0.20 (mean unit score over T units that hold a held-out
   family), AND |v13b − v13a| ≤ 0.10.
2. **False friends (stratum F)**: v19's judged false-friend errors ≤ v13a's + 1 (summed over F).
3. **Serious meaning errors (all strata)**: v19's total ≤ v13a's total + 2.
4. **Readability (stratum C)**: v19's net losses (losses − wins) ≤ the noise pair's |losses − wins| + 2.
5. Same-arm control tie rate ≥ 75%; otherwise the judge measures are reported as unreliable and only measure 1
   stands (then: no recommendation, re-run with a second judge).

A failed or refused generation is a failed unit for that arm (counted, not dropped). Grade: 48 books is
`directional` (≥ 30), not decision-grade. Any recommendation says so.
