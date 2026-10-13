---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 40
n_pages: 40
verdict: "v17 not established: the study stance lifts transparency +0.57 but costs 1.1 readability and fails typing (85%) and alternatives (33% real); the reading stance changes nothing."
status: rejected
decision: "v13 stays the default; v17 study and reading rows seeded is_default:false (#5698)"
superseded_by: null
issue: 5698
---
## 2026-10-04 · Do typed notes and a stance (prompt v17) make the translation's apparatus more honest than v13's single `<note>`? (#5698 steps 2–3)
<!-- PRIOR ART: 2026-10-03-translation-prompt-v16-3825.md (PR #5703) is step 1 of the same issue: v16 kept v15's verbatim originals and still lost 29% of interpretive notes, so it was not flipped. v17 is built on the v16 row. The #5695 track files (2026-10-03-xlref-t1 … t5, translation-vs-reference-*) supply the reference pages and the fidelity judge reused here unchanged. Nothing before this typed the notes or tested a stance. -->

**Question.** v13 puts four things in one `<note>`: the source's wording, supplied words, background, image descriptions. v17 types them (`original:` / `clarification:` / `context:` / `alternative:` / `image:`, a prefix inside the plain `<note>` tag) and replaces "warm museum label" with a stance, `study` or `reading`. Does that measurably improve what a reader can see and check? Fidelity gains were not claimed or tested (v16 failed its rule; no prompt lever beat the noise floor on Tibetan, #5497).

**Design.** Rule: `PREREGISTRATION-translation-prompt-v17.md`, committed before the paid run (`042386a42`).
- **Pages.** 40 pages from 40 books with a public published English translation, drawn across the #5695 tracks: Latin 8, Greek 6, German 2, French 2, Italian 1, Dutch 1, Hebrew 4, Aramaic 1, Arabic 4, Persian 3, Sanskrit 3, Pali 2, Chinese 3. Plus 8 gallery-pool pages where a #5695 judge had quoted a reversal; these never enter a rate. No Tibetan (the 84000 reference is NC-ND).
- **Arms.** v13 twice (`v13-a` baseline, `v13-b` noise floor), `v17-study`, `v17-reading`. Production door, the model each book ships on (of the 40: 12 pages on lite, 28 on flash), temperature 1, thinking off, one page per request, no previous-page translation in any arm.
- **A v17 effect is established** when its paired CI against v13-a excludes 0 and its size exceeds F, the larger absolute bound of the CI of v13-b − v13-a.
- **Instruments.**
  - Mechanical string checks (`score.mjs`).
  - One blind Opus judge for five dimensions and a per-note audit (`DIMENSIONS-PROMPT.md`). `measure`: agreement with a rubric, one judge, not accuracy.
  - The #5695 fidelity harness, two blind Opus judges, as a guard. Controls passed for both judges (wrong page 3/3, planted change 3/3 located, duplicate 3/3 tied); weighted κ 0.87.
  - Note facts: the #5647 lane's stage-1 filter plus one Opus judge; 8 of 8 seeded false notes caught.
- **Spend: $0.93** of a $6 cap (envelope `prompt-v17-5698`, removed after the run). $0.72 for the four arms, $0.21 for the follow-up arm below.

**Result.** **v17 is not established as written. Keep v13.** The study stance does what notes are for; the reading stance changes nothing a judge can see; typing has one defect on Flash.

| per page, 40 pages | v13-a | v13-b | v17-study | v17-reading | floor F |
|---|---:|---:|---:|---:|---:|
| **transparency** (1–5) | 3.15 | 3.05 | **3.73** (+0.57, CI 0.28 to 0.90) | 3.20 (+0.05, CI −0.23 to 0.35) | 0.33 |
| ambiguity (1–5) | 3.90 | 3.83 | **4.33** (+0.42, CI 0.13 to 0.70) | 3.80 | 0.33 |
| readability (1–5) | 4.10 | 4.03 | **3.00** (−1.10, CI −1.40 to −0.78) | 4.33 (+0.23, CI −0.03 to 0.47) | 0.28 |
| undisclosed choices the judge listed | 1.52 | 1.43 | **0.85** (−0.68, CI −0.97 to −0.35) | 1.48 | 0.38 |
| notes | 3.52 | 3.45 | **8.07** | 3.10 | 0.90 |
| verified original-notes | 0.65 | 0.33 | **2.65** (+2.00, CI 0.85 to 3.35) | 1.40 (+0.75, CI −0.10 to 1.70) | 0.82 |
| verified-original rate | 26/30 = 87% | 13/13 | 106/107 = 99% | 56/57 = 98% | not established (v13-b alone moved +13 points) |
| notes typed | — | — | 85% | 95% | bar: 90% |

Bold = established beyond the floor. Register and terminology did not move in either stance.

- **P1 transparency: established for study, not for reading.** Reading carries typed notes on 95% of its notes and scores the same as v13. So the type labels alone do not move the judge. What moves it is the study stance: supplied words marked (3.4 clarification notes per page), four times as many verified originals, and half as many undisclosed choices.
- **P2 verified originals: not worse, rate not established.** One original-note in 107 (study) and one in 57 (reading) is not on its page, against 4 in 30 under v13-a. The v13 arms differ from each other by as much as v17 differs from v13.
- **P3 typing: fails for study (85%), passes for reading (95%).** On Flash the model rewrites a term chip as a note: `<note>term: ushpizin</note>`, `<note>term>metanoia</note>`. 41 times on the 40 pages in study, on 14 of the 28 Flash pages and never on Lite (reading: 6 times; v13-a: 3). The term is then lost to `page_terms` and the reader's term chips. The judge counted 40 malformed notes in study against 4 in v13-a.
- **P4 ours vs the source's: not established.** Notes that are really the page's own printed notes, or clutter: 25 (v13-a), 21 (v13-b), 13 (study), 16 (reading) on 40 pages. The fall is inside the floor. Some of these come from the OCR, which itself wraps printed verse references in `<note>`.
- **P5 alternatives: fails.** Study offered 18 second readings on 11 pages; the judge found 6 real, 10 synonyms and 2 wrong (33% real; the bar was 70%). v13-a already offered 7 in untyped notes ("or …", "literally …"), 6 of them real. Pages with a real alternative: 5 under v13-a, 5 under study, 2 under reading. On the Tao Te Ching page the notes sit beside a double negation that three arms reversed, and none of them is on it.
- **Guards: none failed.**
  - Fidelity 3.84 / 3.98 / 4.04 / 4.03 (no arm worse). Pages with a reversal by either judge: 4 / 3 / 2 / 3.
  - Omission 26% / 26% / **6%** / 30%: the study stance omits less (−20 points, CI −33 to −9, floor 9). The preregistration did not ask this; it is reported, not claimed.
  - Body length 0.99 of v13 in both stances; no looped page in any arm. Invented tags 0. Em-dashes not above v13.
  - Note facts, all checkable notes: 2 wrong of 21 (v13-a), 6 of 21 (v13-b), 1 of 14 (study), 1 of 23 (reading). Counts, not rates.
- **Cost per page:** v13 $0.0032, study $0.0044, reading $0.0041.

**By the preregistered rules.** Study: P1 established, P3 and P5 not met, so rule 1 is not satisfied. Reading: P1 not established and P2 not established as better, so rule 2 applies to it: no measurable gain. Default stays v13.

**As executed (deviations).**
- `classifyNote` (the clutter detector in `quality-census-score.mjs`) could not be imported: that script runs on import. `score.mjs` uses a narrower regex; the judge's per-note audit is the clutter count quoted above.
- The #5624 cue filter passed only 23 notes, so every `context:` note and every untyped note of 40+ characters was fact-checked too (135 notes), flagged `extra`. The lane-filter counts are in `results.json`.
- The judge's list of "undisclosed choices" was added to the dimension prompt after the preregistration and before any judging. It is reported, not part of a rule.
- **Exploratory, after unblinding:** one more arm, `v17-study-fix`, the study prompt plus three lines (terms keep their own tags; an alternative must differ in sense). Built in memory, no row seeded, mechanical scoring only. Term-in-note fell 41 → 18, typed share 85% → 90%, em-dashes 32 → 11. The prompt edit halves the defect and does not remove it.

**Replicated?** No. One run, 40 pages, one judge for the dimension scores. The interpretive-note loss of v15/v16 did not recur: reading keeps 3.1 notes per page against v13's 3.5, inside the floor.

**What it means.**
1. The typed prefix is the right syntax if notes are ever typed: it is backward compatible with every consumer (inventory in the preregistration), where `<note type="…">` is invisible to ten of them, the fact-check lane among them.
2. Typing is not what improves transparency. A study stance is. It costs a point of readability and 8 notes per page, so it is a second mode for scholars, not a default.
3. "Alternative" notes as prompted mostly restate. They need their own test before a reader is built around them.

**If a study mode is built (separate PR, `tier:hold`).**
- **Write time:** `sanitizeTranslationTags` / `annotation-tag-repair.mjs` rewrite `<note>term: X</note>` and `<note>term>X</note>` to `<term>X</term>`. A prompt cannot be trusted to prevent it.
- **Reader (`NotesRenderer.tsx`, `notes-off.ts`):** read the prefix, style each type, drop the type word from the chip; decide which types the notes toggle hides (an `alternative` arguably stays).
- **Fact-check lane (`note-claims.mjs` `pageNotes`):** take every `context:` note; skip the other four types. The cue filter passed only 5 or 6 notes per arm here.
- **`page-terms-parse.mjs`, exports (Typst, PDF, EPUB), `quality-census-score.mjs`:** work unchanged with the prefix.
- **Storage and routing, undecided:** a stance is a second translation of the same page. `pages.translation` has one slot and the loaders take the one `is_default` prompt row.
- **OCR side:** printed verse references and footnotes that the OCR wraps in `<note>` reach the translation as our notes whatever the translation prompt says.

**Artifact.**
- `scripts/eval/PREREGISTRATION-translation-prompt-v17.md`
- `scripts/maintenance/translation-prompt-v17-typed-notes.mjs` (rows `Standard Translation (study)` v17 `611ebbea`, `Standard Translation (reading)` v17 `3851b3bd`, both `is_default:false`)
- `scripts/eval/translation-prompt-v17/` (sample, runner, scorers, judge prompts, gallery)
- `scripts/eval/results/translation-prompt-v17-2026-10/`: `results.json`, `mechanical.json`, `results-fidelity.json`, `gallery.md`, arm outputs, judge verdicts and keys
