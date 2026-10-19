# Maya glyphs: Palenque held-out eval (#6903 stage 2) and candidate-sign suggester replay (#6945)

PRIOR ART: round 1 and round 2 of #6903 (`scripts/eval/experiments/2026-10-18-maya-glyph-reading-6903.md`,
`…-round2-6903.md`). Their harnesses stayed on l7a because they are wired to a private answer key. This directory ports
the arms and scorer to the Palenque set, which is open access per David Stuart (`maya_glyph_blocks`, PR #6937), and adds
the suggester replay. It still reads round 2's Dresden pieces, sign index and retrieval from l7a scratch (`$R2`), and
round 1's items, key and catalogue (`$R1`).

Results: `scripts/eval/experiments/2026-10-19-maya-palenque-suggester-6903-6945.md`.

Nothing here writes to Mongo except `scratch-doc.mjs`. It writes one private `ops_reports` document that carries
prompts to the Gemini helper on main and answers back; it is deleted after the run. No script writes to book pages.

| file | does |
|---|---|
| `common.py` | paths (`$MS` job scratch, `$R1`, `$R2`), reading normalisation (round 2's, plus number words, quotes, glottal stops) |
| `palenque_set.py` | 100 held-out clean blocks stratified by monument, 10 controls, groups of ≤5 per call, layout-only retrieval, opaque image names |
| `prompts.mjs` | arms OK (catalogue + retrieved parallels), TEAM (Opus checks Gemini), BARE (recall control: crop only, shuffled, "name the monument"), NOIMG (recall control: the OK prompt with the crops withheld) |
| `run-claude.mjs` | Opus 5.5 through `claude -p` (subscription), one call per group, resumable |
| `run-agy.mjs`, `build-payload.mjs`, `helper-brief.sh`, `scratch-doc.mjs`, `ingest.py` | Gemini 4 Argon through `agy` on a box where it is signed in (main, cloudlayer; not l7a): payload out, answers back, scratch deleted |
| `score.py` | deterministic: exact / wrong / SEEN (verbatim and token rule) / controls / team verdicts / monument named |
| `judge_packet.py`, `run-judge-claude.mjs`, `tables.py` | blind judge packets (arms mixed and shuffled, unlabelled), the Opus judge, tally, Krippendorff α, the result table |
| `picture.py` | suggester picture channel: DINOv2 + CLIP, sign drawings (`maya_signs`) and reference block crops; run with round 2's CPU venv |
| `suggester.py` | suggester replay: recall@1/3/6/8 per channel and fused, clicks per block, seen/unseen |

Order: `palenque_set.py` → `run-claude.mjs OK OK` (and `BARE OBARE`) → `build-payload.mjs arms OK:GK BARE:GBARE` +
`scratch-doc.mjs put` + `helper-brief.sh … | box.sh main start` → `scratch-doc.mjs get out-GK …` → `team_proposals` →
`run-claude.mjs TEAM TEAM` → `score.py …` → `judge_packet.py <runs>` → judges (Opus here, Gemini on main) →
`judge_packet.py --tally`. Suggester: `$R2/venv/bin/python picture.py` → `python3 suggester.py`.
