## 2026-10-01 · Can the Nyingma tantra manuscripts (BL EAP, non-Kangyur) get an accuracy number? (#4523)

- PRIOR ART: the 2026-10-01 Tibetan re-draw (Derge index, Kangyur only) — this adds the non-Kangyur reference it lacked.
- **Design.** No Tsamdrak e-text exists (BDRC holds scans only; THL and rKTs hold catalogues). The reference used instead is the rKTs **CC0** e-text of the *snga 'gyur rgyud 'bum phyogs bsgrigs* (Gpb, BDRC W1KG14783): 56 vols, 37,170 folio sides, converted to OPF. `kanjur_align.py` ran unchanged. The draw: all 95 visible Nyingma-titled BL books, one page per book per served-verdict class (245 pages, seed 20261002). €0, no model calls.
- **Controls.** Positive (5% noise) 0.972, 50/50 retrieved. Chance shuffle 0.161. Negative (20 Kangyur pages vs the Nyingma index) 0.199 with 20/20 off-index, so there is no shared-formula artefact.
- **Result. SERVE pages: median 0.833 (IQR 0.691–0.924, n=95 books), 37% ≥ 0.9, 15% off-index. MARK_UNRELIABLE: median 0.249 (n=86), 92% off-index.** The lane's SERVE/MARK split is real. By serving rule: `agree_wood` 0.889, `lex` 0.775, `solo` 0.646.
- **0.83 is a lower bound.** Gpb is a different witness from the Tsamdrak manuscripts. Variant readings and scribal contractions (རྡོེ) count against it, and witness divergence is unmeasured. The fix is ~10 hand-transcribed Tsamdrak sides scored against Gpb. Bridge: the 25 `bl-other` pages of the 10-01 re-draw still score at chance (0.149, 88% off-index).
- *Replicated?* No.
- **Artifact.** `scripts/eval/results/tibetan-nyingma-reference-2026-10-01/` (README with 5 by-eye pages, summary.json, per-page scores); scripts in `scripts/eval/tibetan-nyingma-reference/`.
