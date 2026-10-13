---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 311
n_pages: 311
verdict: "87-89% of served translated pages read at fidelity >= 4 of 5 and 11-14% carry a major defect; non-Latin script 70.8% >= 4 vs Latin 92.9%; top major class is prose over garbled OCR."
status: informational
decision: null
superseded_by: null
issue: 5274
---
## 2026-09-30 — Translation corpus audit: how faithful is a random SERVED translation, by language, model and period? (#5274)

**Headline: 87–89% of served pages read at fidelity ≥ 4 of 5; 3.4–3.8% are ≤ 2; 11–14% carry at least one major
defect.** The lower fidelity / higher defect figure re-weights the quota-sampled model arm to its true share per
language (`arm-shares.json`; lite omits more and is the majority arm); the upper is the plain language-weighted
estimate (≥ 4: 89.1%, CI 85.5–92.5; major 11.4%, CI 7.6–15.6 — CI recomputed 2026-09-30, #5373, was 85.3–92.5 and
7.7–15.5). Page-weighting (random page, not random book) changes
nothing (89.3%). Post-stratified by language over live translated pages; sampling limits stated in the README. Latin-script languages
(198 books) are at 92.9% ≥ 4 / 8.6% major; non-Latin-script (113 books) at 70.8% ≥ 4 / 22.1% major. Per language,
German, French, Italian, Dutch, Latin, English and Spanish are all ≥ 89% at ≥ 4 (directional to decision-grade n);
Greek 75% / 22% major (36 books); Sanskrit 50% ≥ 4 with omission on 58% of pages (the English philological apparatus
around the Sanskrit is condensed into a note); Tibetan 64%, Korean 50%, Japanese 67% (exploratory n).
**The dominant defect class is minor mistranslation (153 of 336 defects); the dominant MAJOR class is fluent prose over
garbled OCR** (`garble_passthrough`, 6.6% of pages, 15 major) and invention (11.2% of pages, 15 major; several are
text imported from adjacent pages, the #5026 context-leak shape). Untranslated, wrong-language, truncated and
repetition defects were all 0 in the interior-page draw (the 66,525 truncations of #5055 sit at page ends the draw
does not sample; that count stands).
**Arms (unpaired, model follows the book — not a causal comparison):** lite 82.5% ≥ 4 / omission 20.1% / invention
8.4%; flash 87.3% / 8.9% / 14.6%. Lite omits more, flash invents more. The lite arm is also the newer prompt era
("11", "v10"); flash is mostly "v2". A paired re-translation would be needed to separate model from prompt from book.
- **Design.** Seeded draw (`draw.mjs --seed 20260930`): one interior page (15% front / 5% back skipped) per book from
  live books (`visible ≠ false`, `hidden ≠ true`, `pages_translated > 0`), 15 languages with quotas (Latin 60 …
  Japanese 6), per-language quota on translation-model arm; 311 pages / 311 books. Exclusions: non-text page types,
  OCR < 200 chars, translation < 100 chars, `translation.source` ∉ {ai, batch_api}, `edited_by`. Judge: Claude Opus
  (a different family from the Gemini translator — a Gemini self-judge scored κ 0.107 on Suda), source-grounded,
  reference-free, single-candidate fidelity 1–5 + nine flags + defect list (`JUDGE-PROMPT.md`), 15 items per blinded
  packet. **measure = `judged`**, never accuracy (no independent reference).
- **Controls, read first:** 15 swap (another page's translation) → 15/15 rated ≤ 2 and flagged wrong_page; 15 drop
  (middle ~35% removed) → 15/15 flagged omission; 15 repeat (same item twice) → 11/15 exact, 15/15 within 1, 13/15
  identical flags. The judge's noise is ± 1 on about a quarter of pages and never more.
- **Second judge:** Sonnet on 8 packets (107 main items): exact 67.3%, within 1: 100%, no disagreement ≥ 2; its
  controls 5/5 swap, 5/5 drop; its arm split matches (lite 77% ≥ 4, flash 89%).
- **Hand read (20 pages, all 15 languages, images opened, `eye-notes.md`):** 20 of 21 judge-flagged defects confirmed,
  1 unverifiable at scan resolution, 0 rejected; 0 missed major defects on the nine fidelity-5 pages. **Two of the
  20 pages (both Internet Archive scans: Oxyrhynchus Papyri V p.240, Don Quixote 1605 p.269) serve a display image
  one leaf away from the page that was transcribed and translated** — the translation is faithful to its source and
  the reader still sees the wrong page beside it. A text-only judge cannot see this; the fidelity numbers above are
  conditional on the served image being the transcribed leaf (#4790 class). Two of 20 pages have a catalogue
  language that is not the page's (Arabic → German; Korean → Classical Chinese), as eval-design §3.2 predicts.
- **Replicated?** No. Second judge on a third of the sample agrees; the draw is seeded and re-runnable. The
  lite-vs-flash split is confounded and must not be read as a model result.
- **Spend.** $0 API (subscription subagents: 24 Opus + 8 Sonnet packets, ≈ 4M subagent tokens). No re-translation.
- **Artifact.** `scripts/eval/results/translation-corpus-audit-2026-09-30/` (manifest, items, verdicts/{opus,sonnet},
  report.{md,json}, eye-notes.md). Store: `scripts/eval/store/scores/translation-corpus-audit-judge@1/2026-09.jsonl`
  (476 rows, `run_id translation-corpus-audit-2026-09-30`). Scripts: `scripts/eval/translation-corpus-audit/`.
  Dashboard: no translation cell exists on `/platform/admin/ocr-evidence` yet — follow-up. Decision rows: DECISIONS.md
  "Translation". Report page: linked from #5274.
