---
stage: ocr
measure: [judged, agreement]
languages: [la, lzh, en, he, de, ar, grc]
scripts: [Latn, Hani, Hebr, Arab, Grek]
canons: []
n_books: 50
n_pages: 50
verdict: "The dashboard's served-text CER ranks catastrophes right (empty, truncated, invented pages) but below about 10% it ranks conventions, not errors (Spearman with a by-eye read 0.64 Latin, 0.40 Chinese MS, 0.47 English; 3 of the 9 worst-3 slots are exact pages), and it is blind to numbers: the Latin-script normaliser drops digits, so a table with 22 wrong cells scores 0. The #5826 gate held up (10/10 pages agree, 13/16 claims confirmed, 0 refuted; it under-calls dropped list entries). #6420 adjudications agree on 8/10 (Opus on Opus), with one missed set of invented plate labels."
status: informational
decision: "Verdicts per measure in .claude/docs/measurement-validity.md and a validity field in src/data/quality-methods.json (#6203). No pipeline change."
superseded_by: null
issue: [6203, 6388, 6429, 5826, 6420]
---
PRIOR ART: `.claude/docs/eval-design.md` (accuracy vs agreement vs stability), the #6388 panel and its AI-consensus key (`scripts/eval/ocr-prereg-6388/`), the #6420 gate audit (`scripts/batch/ocr-convergence/results/run/gate/audit/`, which checked the 40 staged WRITES; this entry re-reads keep / residual / contain decisions, which it did not), and the invented-qual-6420 comment on #6203 (which inflating measures made invented text look dominant). None re-read a stored measure's own verdicts against the image to ask whether the measure orders pages as a reader would.

## 2026-10-11 · Do our quality measures agree with a careful read of the image?

**Design.** All $0, Claude via subscription. Each reader was an Opus subagent that opened the page image. These are model reads, not human ones.
1. **Dashboard CER (#6429 1a).** For each #6388 stratum (latin-print, zh-manuscript, english-print), the 30 panel pages were sorted by stored CER against the AI-consensus key, and the pages at positions 0, 3, 6, 9, 13, 16, 19, 23, 26 and 29 were taken. They were shuffled (seed 6203) and scored blind to the CER: estimated CER, sense errors, severity 1–5 and a rank.
2. **#5826 gate** (`quality_gates` `qg_translate_202610101657_1rqt`). 8 pages with recorded findings plus 2 the gate left clean. Each claim was checked against the image. For one page whose OCR was replaced after the gate, the revision the gate read was used.
3. **#6420 convergent review** (gate run). 10 adjudicated pages, 4 keep, 3 residual and 3 contain, one per book, seeded. The reader saw both texts as A and B, blind to which is served and to the adjudicator's call.

**Result.**

| stratum | Spearman, CER vs by-eye CER | Spearman, CER vs severity | worst 3 by CER | worst 3 by eye |
|---|---|---|---|---|
| latin-print | 0.64 | 0.61 | la04, la05, la07 | la01, la07, la04 |
| zh-manuscript | 0.40 | 0.51 | zh04, zh05, zh07 | zh04, zh05, zh03 |
| english-print | 0.47 | 0.50 | en04, en05, en07 | en04, en05, en02 |

**Dashboard CER**
- Every page the eye scored severity 4 or more is in the top 2 by CER. Those are an empty page (en04), a page cut off at 35% (en05), and an invented hexagram diagram (zh04).
- Clean pages scored high:
  - la04 is the worst Latin page by CER (34%), but its print is accurate and only the handwritten marginalia are guessed.
  - la05 (8.4%), zh07 (11.5%), zh01 (7.0%) and en07 (7.0%) are exact by eye. The differences are footnote expansion, an untranscribed running header, or a short denominator.
- The worst Latin page by eye is la01 (CER 2.6%). It drops a citation line and misreads names.
- **en02 scores CER 0 with about 22 wrong cells in a numeric table.** `normalizeForScript(…, 'latin')` keeps letters only: `"Anno 1644, p. 239 n. 25; | 2.54,3 |"` becomes `"anno p n non est"`. The 9,847-character page is scored on 38 letters. This normaliser is used for every Latin-script CER in `scripts/eval`.
- English print's stratum mean (13.4%) comes from 6 of 30 pages at CER ≥ 30%. The other 24 average 0.4%.

**#5826 gate**
- 10/10 pages agree overall.
- Of 16 claims: 13 confirmed, 1 partly confirmed, 0 refuted, 2 not checkable because the English is withheld.
- The partial one is the Hebrew MS O1 "invented". It is a line-aligned reading with about half its words wrong, not free invention. Blocking was still the right call.
- The gate under-called three things:
  - a dropped handwritten entry (p779);
  - a lost bibliographic entry whose imprint was attached to the wrong author, rated minor (Fontanini p253);
  - invented binding glosses on p36, the same T10 class it flagged on p35.

**#6420**
- The re-read matched the adjudicator's serious / not-serious call on the stored text in 8/10, and the outcome in 8/10.
- Miss: c07, a Fludd plate. The stored text adds five labels that are not on the plate, and the adjudicator called neither text serious.
- Stricter call: c10. The adjudicator contained the page; the re-read found the CLI text usable.

**Replicated?** No. Each page was read once, by one Opus subagent. For #6420 the re-reader is the same model family as the adjudicator, so 8/10 is an upper bound.

**Artifact.** `scripts/eval/results/measure-validity-2026-10-11/` holds `dashboard-strata-byeye.json`, `gate5826-recheck.json` and `conv6420-recheck.json`. The verdicts per measure are in `.claude/docs/measurement-validity.md`.
