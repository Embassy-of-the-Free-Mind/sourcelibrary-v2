# seam-ab-5678 — page breaks: Lite vs Lite again vs Lite+markers vs Flash+markers (#5678)

Harness: `scripts/eval/seam-ab-5678.mjs`. Pre-registration with amendments and the result:
`scripts/eval/PREREGISTRATION-seam-ab-markers.md`.

## Files

| file | what |
|---|---|
| `candidates.jsonl`, `draw-log.json` | the seeded draw (seed 5678): 150 open-end and 60 closed-end candidates, one page per book |
| `screen.md`, `screen.json` | the by-eye screen of the SOURCE (before any output existed): `mid` / `closed` / `reject`, with reasons |
| `sample.jsonl`, `pin-log.json`, `arms.json` | the 120 pinned breaks (100 mid-sentence, 20 closed), and the v13 prompt text |
| `batch.json`, `outputs.jsonl` | 4 Batch jobs (A2 first) and 480 raw responses, parsed |
| `JUDGE-PROMPT.md`, `packets/`, `packet-key.json` | 4 blinded packets of 32 breaks, with 16 plants and 8 repeats, and the key |
| `verdicts/packet-P-judge-J.jsonl` | 8 blind Opus judges, 2 per packet |
| `report.json` | the scored result; `decision` holds the registered rule and its positional (post-hoc) twin |

## Result: real seam defects on 100 true mid-sentence breaks (both judges)

| arm | registered (literal parse) | post hoc (positional) | forced closure | duplication | ≥6 words moved | edge omission |
|---|---|---|---:|---:|---:|---:|
| A2 Lite (noise floor) | 26 (18–35%) | 26 | 15 | 8 | 9 | 6 |
| A Lite, production | 21 (14–30%) | 21 | 12 | 5 | 6 | 4 |
| B Lite + markers | 28 (20–38%) | 15 (9–23%) | 6 | 1 | 5 | 4 |
| C Flash + markers | 18 (12–27%) | 8 (4–15%) | 1 | 0 | 5 | 3 |

- **Rule outcome.** Registered: UNRESOLVED. Positional (post hoc): MODEL.
- **Paired tests.** Each pair is discordant breaks, with a one-sided sign test:

  | pair | registered | positional |
  |---|---|---|
  | B vs A | 15 vs 8 | 5 vs 11, p 0.105 |
  | C vs A | 12 vs 15 | 5 vs 18, p 0.005 |
  | C vs B | 8 vs 18, p 0.038 | 2 vs 9, p 0.033 |

- **Controls (20 closed breaks).** Registered: 1 / 1 / 5 / 0. B's 5 and C's 2 are parse failures, so C's own
  count is 2 under the literal rule and 0 once read positionally. Positional: 1 / 1 / 0 / 0.

## Marker mechanics

**As shipped, the literal parse fails on 22 of 120 B blocks and 13 of 120 C blocks.** Read from the raw
responses:

| failure kind | B (Lite + markers) | C (Flash + markers) |
|---|---:|---:|
| `renumbered` | 10 | 13 |
| `first-omitted` | 11 | 0 |
| truly unmarked | 1 | 0 |

- **`renumbered`:** the markers carry the printed page number from the OCR's `<page-num>` (`<pb n="97"/>` for
  sequence page 21).
- **`first-omitted`:** the opening marker is missing, but the marker at the page turn is present.

**Placement.** The proxy is the share of English words before the marker against the share of source words on N.
Its median |miss| is 11 words for both B and C (p90 is 35 and 33). The judges' median "words moved" is 0. The proxy
assumes even expansion, so it over-reads.

## Judges

- Plants caught: 32 of 32.
- Inter-judge agreement on "real defect": 475 of 480.
- Repeat agreement: 59 of 64.

Spend: $0.848.
