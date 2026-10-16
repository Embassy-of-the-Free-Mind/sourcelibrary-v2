---
stage: metadata
measure: accuracy
languages: [la, grc, lzh, ja, sa, ar, fa, he, en, de]
scripts: []
canons: []
n_books: 448
n_pages: null
verdict: "Sonnet 5.5 (agy, low effort, 15 books per call) dates the work inside its window on 87.4% of high/medium rows against Wikidata (n=247 of 318) and reads 94.6% of printed imprints blind (n=130); Haiku 77%, GPT-OSS 64% and the 2026 enrichment rows 67% fail the 85% bar."
status: adopted
decision: "Library-wide dating (#6721) runs on agy claude-sonnet-5-5-low, batched 15; Gemini arms pending their quota reset"
superseded_by: null
issue: [6721, 6652]
---
## 2026-10-14 · Can a CLI model date works and editions well enough to write them library-wide?

**Design.** External gold, two sets. *Work* (n=318, 8 traditions): Wikidata P571 inception, else P577 first
publication, else P1191, for the work a book holds — through `books.work_id` = QID (234) or an exact original-script
label match (105 non-Western: Chinese 49, Sanskrit 14, Arabic 12, Japanese 11, Persian 9…); one book per work; a gold
date later than the edition we hold dropped (19). HIT = gold interval meets the arm's [from, to]. *Edition* (n=130):
printed books whose first two text leaves print the catalogue year (Arabic or Roman), dated with the catalogue date
WITHHELD. Bar: work HIT ≥ 85% on high/medium rows. Same books for every arm; $0 (agy CLI, sealed `claude -p`).

**Result.**

| arm | work HIT high/med (CI) | n | median window | edition exact | calls |
|---|---|---:|---:|---|---:|
| agy claude-sonnet-5-5-low, 15/call | 87.4% (83–91) | 247 | 6 y | 94.6% | 31 |
| agy claude-sonnet-5-5-low, 1/call | 87.2% (83–91) | 282 | 6 y | 96.9% | 449 |
| claude -p sonnet, 15/call | 85.4% (81–89) | 268 | 6 y | 93.8% | 31 |
| claude -p haiku, 15/call | 77.4% (72–82) | 297 | 12 y | 91.5% | 31 |
| agy gpt-oss-120b-medium, 15/call | 64.0% (58–70) | 236 | 9 y | 83.3% | 31 |
| existing `source_work_dates` (2026 enrichment) | 66.7% (54–77) | 60 | — | — | 0 |

Batching costs nothing measurable (within 3 points on every measure), so 15 books per call. The misses: about 15 of
39 for `claude -p` Sonnet are definitional (composition asked, gold is first publication), about 8 are gold errors (a
modern edition's item standing in for the work), and about 12 are model errors. That reading is mine, not an
instrument's.

**Not run.** Gemini 3.8 Flash / 4 Argon on agy: quota exhausted on 2026-10-14 (reset ~25 h); they run on the same gold
when it resets, as the second-family agreement check.

**Replicated?** No: one run per arm.

**Artifact.** `scripts/eval/library-dating-6721/score.mjs`; gold and replies on Hetzner under
`/mnt/HC_Volume_105839809/jobs/library-dating/` (`gold-work.json`, `gold-edition.json`, `ref/`); issue #6721.
