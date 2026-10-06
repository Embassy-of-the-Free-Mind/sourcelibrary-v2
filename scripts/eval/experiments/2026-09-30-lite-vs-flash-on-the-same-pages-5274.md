---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 304
n_pages: 304
verdict: "On the same pages flash invents more (15.8% vs 8.2%/9.2% for two lite runs); fidelity >= 4 and omission do not differ measurably. Rule output: lite stays."
status: undecided
decision: null
superseded_by: null
issue: 5274
---
## 2026-09-30 — Lite vs flash on the SAME pages: does the model change judged fidelity, omission or invention? (#5274)

**Headline: flash invents more (15.8% of pages against 8.2% and 9.2% for two lite runs); fidelity ≥ 4 and
omission are not shown to differ. The pre-registered rule proposes no routing change.**
304 books, one page each, the corpus audit's own pages, production prompt v13, same context in every arm.

| outcome | lite | lite again | flash | flash − lite (95%) | floor: lite again − lite | flash − lite again | rule |
|---|---:|---:|---:|---|---|---|---|
| fidelity ≥ 4 | 84.9% | 84.9% | 88.5% | +3.6 pp (0.0 to 7.6) | 0.0 (−3.3 to 3.3) | +3.6 (−0.3 to 7.6) | no measurable difference |
| omission | 11.8% | 11.8% | 8.6% | −3.3 pp (−7.2 to 0.7) | 0.0 (−3.6 to 4.0) | −3.3 (−6.9 to 0.3) | no measurable difference |
| invention | 8.2% | 9.2% | 15.8% | +7.6 pp (3.0 to 12.2) | +1.0 (−2.6 to 4.6) | +6.6 (1.6 to 11.5) | difference |

Discordant pages, flash vs lite: fidelity ≥ 4 23 vs 12 (p 0.09), omission 13 vs 23 (p 0.13), invention 39 vs 16
(p 0.003). Per-page fidelity: flash 63 wins / 44 losses / 197 ties (p 0.08); lite against itself 38 / 37 / 229.
- **The audit's unpaired gaps, re-read.** Invention (15% vs 8%) reproduces as a model effect. Omission (lite 20%
  vs flash 9%) shrinks to 11.8% vs 8.6% and its interval includes zero: most of it was the books and prompt eras.
- **What the extra invention is** (from the judges' defect details, no page image opened): on the 39 pages
  flagged for flash and not lite, 42 invention defects, 6 major; a keyword match finds 23 naming a
  `<note>`/`<meta>`/summary block. Mostly explanatory notes asserting a fact the page does not carry, plus
  previous-page text at the head of the translation. Same place #5305 found invention.
- **Non-Latin script (112 books, exploratory):** every line leans to flash (fidelity ≥ 4 +6.3 pp, −1.8 to 15.2;
  omission −8.0 pp, −15.2 to −1.8; per-page fidelity 29 wins to 15, p 0.049) and none passes the rule: the
  replication against the second lite run fails for omission, and two lite runs differ by 4.5 pp there. The
  interval allows up to about 15 pp in flash's favour. Latin script (192): +2.1 pp (−1.0 to 5.2).
- **One lite draw differs from another as much as flash does:** Latin (60 books) fidelity ≥ 4 is +10.0 pp for
  flash − lite AND for lite again − lite. Tibetan (11 books, routed to flash in production): flash 54.5% against
  72.7% and 63.6%, intervals include zero.
- **Correction after the read.** The first score used `lib/paired-stats.mjs bootstrapCI`, whose generator is not
  uniform (chi-square 3,105 over 304 bins against ≈ 303). It read fidelity ≥ 4 as (1.0 to 6.9) and the rule
  printed a difference; the analytic interval is (−0.2 to 7.4) and a sound bootstrap (0.0 to 7.6). The harness
  now carries its own bootstrap and keeps all three intervals in `report.json`. 16 harnesses import that module;
  intervals quoted from it elsewhere in this file may be too narrow. Not fixed here.
- **Design.** `PREREGISTRATION-translation-paired-arm.md` (committed before any output was read; one amendment,
  post-read, labelled). Arms: `gemini-3.1-flash-lite` twice, `gemini-3-flash-preview` once; one prompt per page,
  byte-identical across arms (`buildTranslationPrompt`, `PAGE_BREAK_SCOPED`, neighbouring OCR, previous page's
  served translation; English books on the modernisation prompt). Single-page prompts, not production's 8-page
  blocks. 311 audit pages minus the 6 wrong-leaf pages of #5311; one page refused by both models in all arms.
  Judge: Claude Opus, the audit's rubric unchanged, 942 items in 61 blind packets, a page's arms never in the
  same packet. 30 repeat controls: same fidelity 27/30, within one 29/30, invention flag 25/30.
- **measure = `judged`**, n = 304 books overall (decision-grade n), 112 non-Latin (directional). Worst and
  largest-gap pages: listed in `report.json`, read from the judges' reasons only, NOT by eye.
- **Decision.** Deferred to Derek. Rule output: lite stays; flash's invention is a trade to weigh, not a reason
  to switch. Not settled: whether flash is better on non-Latin script (needs more books than 112).
- **Cost.** $1.11 Batch API (est. $1.76); the first flash job was cancelled by the API at $0 and resubmitted.
- **Replicated?** Invention: yes, against an independent second lite run. Not re-run on fresh pages.
- **Artifact.** `scripts/eval/translation-paired-arm.mjs`, `results/translation-paired-arm-2026-09-30/`.
