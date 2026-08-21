# Number verification checklist — reading-or-reciting-chr2027.md

Every numeric claim in the draft, mapped to its source of truth. Before freeze
(Aug 10), each row gets checked by re-running the named script/reading the named
file — never from memory or from this session's chat. Mark ✓ + date + verifier.
Discrepancies: fix the DRAFT to match the data, never the reverse.

| # | Claim in draft | Source of truth | Status |
|---|---|---|---|
| 1 | 44 pages; 9 hy / 13 el / 7 la / 4 he / 5 de / 6 zh | `scripts/eval/dataset/v0.3/pages.jsonl` (count by language) | ☐ |
| 2 | ~1,700 / 1,737 runs | `v0.3/runs.jsonl` line count | ☐ |
| 3 | Iliad I canon 100.0% ×3 models + 99.4–99.8 sonnet; Iliad XIII 90.7–97.2 (3–9pp) | `report-canonical-gap.mjs` over `observations/ocr-observations-2026-07-2*.jsonl`, book 699382dd… | ☐ |
| 4 | Virgil same-book: +1.0pp largest, +5.4pp cheapest | same report, book 6a084d97… (pro 97.0/96.0; lite 97.2/91.8) | ☐ |
| 5 | Flash raw 98.7% Gen1 vs 46.4% Gen5; pro/flash alignment failure on Gen 5 | per-pair analysis (PR #3322 description + observations) | ☐ |
| 6 | Zohrab inversion: canon John worse for every engine | same-book contrast, book 69a5eae5… | ☐ |
| 7 | Pooled gap: +2.2pp @23 pages → shrank/reversed @40 (per-model list) | paper doc results §2 (2026-07-19 rebuild numbers) + rerun report | ☐ |
| 8 | Occlusion v2 excess: canon +9..+37 (Aeneid I max; MS +17); noncanon controls −3..−6; genealogies +13..+28 | `report-occlusion.mjs` v2 section + `occlusion-v2-masks-2026-07-24.json` | ☐ |
| 9 | 27/28 occluded runs silent (1 mask mention) | v1 outputs `scorecard-outputs-2026-07-23-occlusion.jsonl` mention grep — CHECK whether claim should cover v1 (28 runs) or v1+v2 pooled; recount and fix wording | ☐ |
| 10 | Mask covers 27–50% of printed lines, first/last visible | `occlusion-v2-masks-2026-07-24.json` masked_ref_share range | ☐ |
| 11 | Blur σ4: Iliad canon 100.0/99.8 flat; noncanon −32/−48pp | `report-occlusion.mjs` blur columns | ☐ |
| 12 | v1 mask missed ref on 2/5 canonical pages; eyeball ±10–15pp | paper doc result 16 + VISIBLE_SHARE map in report-occlusion.mjs | ☐ |
| 13 | Calibration r≈0.75 noncanon (0.714), 0.85 Greek | `calibration-scorecard-2026-07-23.{json,md}` | ☐ |
| 14 | 109,953 revision pairs; era/script dominate | `revision-agreement-corpus-2026-07-23.json` | ☐ |
| 15 | Conditional-vs-unconditional inversion; pro truncation 15–19% | paper doc outcome battery (2026-07-19 build: pro 90.5 raw / lite 98.0) — rerun on current obs | ☐ |
| 16 | Hebrew page 50%→95% when downscaled | paper doc result 6 (resolution arm) | ☐ |
| 17 | IA: 87% modern English; 82% French 1800s; 27% Latin 1500s; replication ±9pp | `ia-ocr-baseline-pilot-2026-07-23.md` + `-2026-07-24.md` (NB: draft says 82% for French 1800s = the 07-24 sample; 07-23 read 80.5 — cite both or say ≈81) | ☐ |
| 18 | ~200 books per sample; two disjoint samples | both pilot MDs book counts (115 + 100 aligned) | ☐ |
| 19 | Scorecard bands: ≈99.8% German/English; ≈97% early modern Latin; Hebrew+CJK uncalibrated | `calibration-scorecard-2026-07-23.md` step-3 table | ☐ |
| 20 | ~30,000 public volumes (library size) | `system_config.homepage_stats` / research page snapshot — pick ONE dated figure | ☐ |
| 21 | 0.64–17.4 MP (27×) | `v0.3/pages.jsonl` image fields | ☐ |
| 22 | Deleted rows: 1450 Mishnah MS + Daxue Huowen | paper doc dataset-design section (provenance narrative) | ☐ |
| 23 | ASR precedent claims (Tseng; Swiss German) | dossier entries — verify arXiv ids before citing | ☐ |
| 24 | All related-work characterizations | re-check each dossier entry's one-liner against its abstract at cite time | ☐ |

Also before freeze:
- [ ] Word count ≤6,000 excl. references/tables (ACH template count).
- [ ] Every citation resolved to a real bibliography entry (dossier ids re-checked).
- [ ] Scoop watchlist re-run (dossier §watchlist): new arXiv hits for canonicity/OCR-contamination since 2026-07-19.
- [ ] Anonymization pass on the submission copy (names, library name, repo links → anonymized mirror).
- [ ] F1/F2 rendered; T1–T4 regenerated from data by script, not typed by hand.
