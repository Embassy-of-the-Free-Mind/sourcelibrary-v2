# Nyingma reference e-text: an accuracy number for the non-Kangyur BL Tibetan stratum (#4523)

PRIOR ART: scripts/eval/results/nalanda-readiness-2026-09-30.json and the 2026-10-01 re-draw (Derge index) — Kangyur-only; this adds the non-Kangyur reference they lacked.

**Who reads this.** Anyone deciding whether the Bhutanese rNying rgyud (Nyingma tantra) manuscripts in the BL EAP
holdings can be served with a measured accuracy instead of "engine agreement". Until now every Tibetan accuracy
number was Kangyur-only, scored against the Derge e-text. The non-Kangyur pages scored at chance against Derge
(0.174 in the 2026-10-01 re-draw) because they are not Kangyur text.

## Reference
- **No machine-readable Tsamdrak (mTshams brag) e-text was found.** BDRC holds scans only (W21521; W1KG16449 is the
  Sangs rgyas gling manuscript). There is no eText instance linked, and none in BDRC's 2017 Zenodo etext dump
  (record 821218, UCB-OCR included). THL and rKTs give catalogues (titles, colophons, folio locations), not text.
- **Used instead:** the rKTs e-text of the *snga 'gyur rgyud 'bum phyogs bsgrigs* (sigla Gpb, BDRC W1KG14783),
  from https://github.com/brunogml/rKTs/tree/master/etexts/Gpb. Its licence is **CC0** per the repository README;
  the request is to cite the rKTs project. It is a modern compiled edition of the same tantras as the Tsamdrak
  manuscript, but a different witness. It has 56 of ~63 volumes, 37,170 folio sides and 235,099 lines in EWTS, converted
  with pyewts (2,191 conversion warnings). The e-text is kept on Hetzner at `/root/nyingma-ref/`, not committed.
- **Pagination:** per-folio-side, built from rKTs's own `1a1` line tags. It is not a 500-syllable window.

## Method
`kanjur_align.py` (6-syllable shingle retrieval, then Needleman–Wunsch over syllables, window ±2 sides) runs
unchanged against the new index. Build and run: `scripts/eval/tibetan-nyingma-reference/` (`build_gpb_opf.py`,
`sample_nyingma.mjs`, `run.sh`, `summarize.py`). It cost €0 in CPU and made no model calls.

Draw: every visible BL Tibetan book whose title names a Nyingma tantra collection (95 books, 38,974 pages; seed
20261002). Per book, ONE random page per served verdict class (`ocr.verdict.verdict`, or `ocr.unreadable` without
a verdict), so each class is one-page-per-book. The draw has 245 pages. The handoff asked for ≥ 100 books; 95 exist.

## Result (`summary.json`)
| set | n | median identity | IQR | ≥ 0.9 | off-index (retrieval < 0.05) |
|---|---|---|---|---|---|
| positive control (Gpb page + 5% noise) | 50 | 0.972 | 0.966–0.977 | 50/50, 50/50 retrieved | — |
| positive control, 2-side span | 50 | 0.971 | 0.964–0.975 | 46 | — |
| chance (wrong-page shuffle) | 245 | 0.161 | 0.132–0.189 | 0 | — |
| NEGATIVE: 20 Kangyur pages vs Gpb | 20 | 0.199 | 0.186–0.243 | 0 | 20/20 |
| bridge: 25 `bl-other` pages of the 10-01 re-draw | 25 | 0.149 | 0.000–0.236 | 2 | 22/25 |
| **Nyingma, served SERVE** | **95** | **0.833** | **0.691–0.924** | **35 (37%)** | 14 (15%) |
| Nyingma, SERVE and on-index | 81 | 0.853 | | 35 | 0 |
| Nyingma, MARK_UNRELIABLE | 86 | 0.249 | 0.157–0.368 | 0 | 79 (92%) |
| Nyingma, MARK and on-index | 7 | 0.630 | | 0 | 0 |
| Nyingma, no verdict | 40 | 0.760 | 0.458–0.833 | 3 | 16 |
| Nyingma, unreadable without verdict | 24 | 0.237 | 0.000–0.398 | 0 | 24 |

SERVE broken down by the adjudication rule that served the page: `agree_wood` 0.889 (n=53), `lex` 0.775 (28),
`solo` 0.646 (10), `derge` 0.699 (4).

**Reading.**
1. The instrument works on this reference. The positive controls sit at 0.97, chance at 0.16, and Kangyur text against
   the Nyingma index sits at chance. That last result means no shared-formula artefact (cf. improvements item 13).
2. **The MARK pages really are worse.** Served SERVE text matches the Nyingma e-text at a median of 0.83. MARK text
   sits at chance (0.25), and 92% of MARK pages retrieve nothing from the index. The SERVE/MARK split in the lane is
   real, not cosmetic.
3. **0.83 is a lower bound on SERVE accuracy, not the accuracy.** Gpb is a different witness from the Tsamdrak
   manuscript, so variant readings and the manuscript's contracted spellings (e.g. རྡོེ for རྡོ་རྗེ) count as errors.
   The Kangyur number (0.947 vs Derge) is also cross-witness, but Kangyur witnesses diverge less than Nyingma
   manuscripts. The divergence between witnesses has not been measured. To measure it, hand-transcribe ~10 Tsamdrak sides and score them against Gpb.
4. The `agree_wood` rule (0.889) earns its trust. The `solo` rule (0.646) is the weak class to look at first.
5. The bridge reproduces: the 25 `bl-other` pages still score at chance against this index, as they did against Derge. They are
   mostly neither Kangyur nor these tantras (88% off-index).

## By eye (5 pages, images opened at 1600 px)
- [SERVE 0.993](https://sourcelibrary.org/book/6a14e1302f45ee330c274186?page=103): two clean dbu can leaves; the
  served text opens ཆོས་མིན་འཁོར་བའི་བྱ་བ་ཡིན, which matches line 1 of the upper leaf (read from image).
- [SERVE 0.833](https://sourcelibrary.org/book/69e786e26846fc56c490fd81?page=137): the served text opens ལམ། །གསང་སྔགས་,
  which matches the image. The differences from Gpb are variant readings (served གླང་པོ་ཆེ་རབ་འབོགས་ཀྱིས vs Gpb
  གླང་པོ་རབ་འབོག་གི). That is witness divergence, not OCR error (text comparison).
- [SERVE 0.583](https://sourcelibrary.org/book/69e786e46846fc56c490ff0b?page=18): a dense list of vajra epithets
  and mantra lines. The manuscript writes the contracted རྡོེ, which the read keeps; retrieval is weak (0.03) (read from image + text).
- [MARK 0.25](https://sourcelibrary.org/book/69e786fe4a6785cfd60c98b4?page=1): a title leaf (nearly blank) beside an opening
  leaf with five lines on a pink ground. The served text is the tagged page-description form. The MARK verdict is right (read from image).
- [MARK 0.747](https://sourcelibrary.org/book/6a14e153311a9edd4621f29e?page=306): leaves with heavy interlinear
  annotation in small script. The second half of the served text is garbled (སེངས་གོ་གའ་རེས་ཏབས་...), consistent with
  interlinear notes mixed into the main line. The MARK verdict is right (read from image + text).

## Files
`summary.json`, `nyingma-scores.jsonl` (per page: identity, retrieval, matched Gpb volume/side, verdict, URL),
`nyingma-books.jsonl` (per book: page counts by verdict class), and the controls (`control-*.jsonl`, `chance-shuffle.jsonl`,
`negative-kanjur.jsonl`, `bridge-bl-other.jsonl`). Gpb volume map: `/root/nyingma-ref/Gpb.opf/vol_map.json`.
