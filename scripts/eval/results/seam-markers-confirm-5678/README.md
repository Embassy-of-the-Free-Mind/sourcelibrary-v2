# seam-markers-confirm-5678 — confirmatory folio-marker A/B with the positional parser (#5678)

Harness: `scripts/eval/seam-markers-confirm-5678.mjs`. Pre-registration, two amendments and the result:
`scripts/eval/PREREGISTRATION-seam-markers-confirm.md`. It confirms `../seam-ab-5678/` (#5701).

## Files

| file | what |
|---|---|
| `candidates.jsonl`, `draw-log.json` | the seeded draw (seed 56782), stratified by script: 269 candidates, one page per book |
| `screen.md`, `screen.json` | the by-eye screen of the SOURCE, before any output existed: `mid` / `closed` / `reject`, with reasons |
| `sample.jsonl`, `pin-log.json`, `arms.json` | the 120 pinned breaks (100 mid-sentence, 20 closed) and the v13 prompt text |
| `batch.json`, `outputs.jsonl` | the Batch jobs (A2 first; three dead Lite jobs under `dead_jobs`) and 602 raw responses, parsed as the lane parses |
| `JUDGE-PROMPT.md`, `packets/`, `packet-key.json` | #5701's judge text, 8 blinded packets of 17 breaks with 32 plants and 16 repeats, and the key |
| `verdicts/packet-P-judge-J.jsonl` | 16 blind Opus judges, 2 per packet |
| `report.json` | the scored result; `decision` holds the registered rule |

## Result: real seam defects on 100 true mid-sentence breaks (both judges)

| arm | real defects | Latin script (70) | non-Latin (30) | forced closure | duplication | ≥6 words moved | edge omission |
|---|---|---:|---:|---:|---:|---:|---:|
| A Lite, production | 26 (18–35%) | 16 | 10 | 19 | 8 | 10 | 3 |
| A2 Lite again | 26 (18–35%) | 18 | 8 | 17 | 7 | 14 | 3 |
| B Lite + markers | 19 (13–28%) | 12 | 7 | 9 | 4 | 11 | 6 |
| C Flash + markers | 11 (6–19%) | 7 | 4 | 1 | 0 | 9 | 3 |
| D Flash, no markers | 16 (10–24%) | 8 | 8 | 11 | 3 | 4 | 3 |

- **Rule outcome.** Markers on for the chained lane: **NO**. Model or markers: **MODEL**.
- **Paired tests** (discordant breaks, one-sided sign test):

  | pair | discordant | p |
  |---|---|---:|
  | B vs A (markers on Lite, primary) | 8 vs 15 | 0.105 |
  | C vs D (markers on Flash, primary) | 7 vs 12 | 0.18 |
  | D vs A (model, no markers) | 8 vs 18 | 0.038 |
  | C vs B (model, with markers) | 5 vs 13 | 0.048 |
  | C vs A | 5 vs 20 | 0.002 |
  | A2 vs A (noise) | 13 vs 13 | — |

- **Guards.** Controls 0 / 1 / 1 / 0 / 0 (A / A2 / B / C / D). Edge omission 3 / 3 / 6 / 3 / 3: fails for B.
  Undrafted blocks of 120: 0 / 2 / 2 / 0 / 1.
- **By non-Latin group** (10 breaks each; A / A2 / B / C / D): Tibetan 4 / 4 / 2 / 2 / 3; Chinese 3 / 2 / 3 / 0 / 2;
  other 3 / 2 / 2 / 2 / 3. Direction only.
- **Best seam votes** (200 judge readings, lists allowed): A 66, A2 69, B 98, C 109, D 105, tie 31.

## Marker mechanics (positional parser, as on main)

| reading | B Lite + markers | C Flash + markers |
|---|---:|---:|
| `literal` | 112 | 120 |
| `opener-missing` | 6 | 0 |
| `partial` (page undrafted) | 1 | 0 |
| `rejected` (both pages undrafted) | 1 | 0 |
| `renumbered` | 0 | 0 |

- **The renumbering of #5701 is gone.** With the `--- Page N ---` wording of #5719, no block numbered a marker by
  the printed page (23 of 240 did in #5701).
- **Pages left undrafted, all listed:**
  - B `6a4b557e…:10` (Latin): one marker, at the opening; page 11 unmarked, page 10 overrun. Neither drafted.
  - B `6a2032ba…:13` (Malay in Arabic script): four markers for two pages (`n` = 13, 14, 15, 16). Rejected.
  - A2 `6a20331a…:15` (Arabic): `over-block`. A2 `69e74904…:26` (Aramaic): `short-block`.
  - D `6a4a3f07…:14` (Latin): `short-block`.

## Judges

- Plants caught: 64 of 64.
- Inter-judge agreement on "real defect": 594 of 600.
- Repeat agreement: 158 of 160.

Spend: $1.232 metered. Three Lite Batch jobs died server-side with no output and were resubmitted (Amendment 2);
if they were billed they add about $0.52.
