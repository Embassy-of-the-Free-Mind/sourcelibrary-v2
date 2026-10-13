---
stage: ocr
measure: accuracy
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 133
n_pages: 287
verdict: "No accuracy figure is possible for held terma/biography manuscripts: 96% of served pages retrieve no open e-text; the 6 on-index pages read at median identity 0.80."
status: informational
decision: null
superseded_by: null
issue: 4523
---
## 2026-10-07 · Can the held BL terma and biography manuscripts be scored against a printed e-text? Almost never: 96% of served pages fall off every open reference (#4523, step A)
<!-- PRIOR ART: 2026-10-01 Nyingma-tantra reference run (scripts/eval/results/tibetan-nyingma-reference-2026-10-01/README.md, PR #5459) — same aligner, same controls, one reference (rKTs Gpb). This run had no known reference, so it first FINDS one per book on held-out pages, then scores different pages. -->

**Question.** 133 of the 1,434 held British Library (EAP) Tibetan books are terma cycles or biographies by
title (Padma bka' thang, Mani bka' 'bum, Milarepa, Bla ma / Kun bzang dgongs 'dus, zhi khro / bar do,
rnam thar). Can their served OCR get an accuracy figure against a printed edition, as the Kangyur (0.947 vs
Derge) and the Nyingma tantras (0.83 vs Gpb) did?

**Frame.** Held set re-derived from Mongo on 2026-10-07 (`pipeline_auto.hold.reason =
tibetan-retranslation-awaits-derek`): 1,434 books, 1,433 visible, 274,753 pages. Title regexes in
`scripts/eval/tibetan-bl-evidence/strata.mjs`: Kangyur 213 books / 94,576 pp; Nyingma tantras 95 / 38,974;
terma–biography 133 / 23,560; other 993 / 117,643. (The brief's rough figures were 252 / 50 / 162 / 970; the
difference is regex scope, not data.)

**Reference search.** OpenPecha's catalogue lists e-texts of the Padma bka' thang, Mani bka' 'bum, Milarepa and
Bar do thos grol, but the `I…` repos are not public, and the public `P…` ones carry no licence or are publisher
e-books. The usable open source is **BDRC's 2017 e-text deposit (Zenodo 821218, CC-BY 4.0;** the keyed files
also carry CC-BY 3.0 in their TEI headers): 12,785 text files, including the Shechen Rin chen gter mdzod and the
UCB Namsel OCR of ~730 printed volumes. Reference text stays on Hetzner (`/root/tib-bl-evidence/refs/`), is never
committed and is never served.
- **Discovery, not titles.** Per book, two served pages (seed 2026100701) were matched against the whole deposit
  on 6-syllable shingles (`discover_refs.py`). A book "has a witness" if either page put ≥ 0.2 of its shingles in
  one e-text file. **28 of 133 books do.** Among them: Milarepa's *rnam thar dang mgur 'bum* (W1KG4276, 5 of 7
  books), the zhi khro dgongs pa rang grol cycle (W3JT13340, W1KG8928, Rinchen Terdzö vol. 3), Rinchen Terdzö
  sections of the dGongs 'dus, the Jātakamālā and other canonical texts inside rnam thar volumes. None for the
  Padma bka' thang. The Mani bka' 'bum hit is shared passages in a Sakya chos 'byung.
- **Index.** One OPF per work group (`build_ref_opf.py`) from every e-text volume a discovery page hit, then
  `/root/tibetan-eval/kanjur_align.py` **unchanged** (index, score, controls), exactly as in #5459.
- **Scored pages are not the discovery pages:** one random page per book per served verdict class (SERVE,
  MARK_UNRELIABLE, none), 287 pages.

**Controls (every group).** Positive (reference page + 5% noise): median 0.969–0.973, ≥ 0.9 on 49–50 of 50.
Chance (shuffled): median 0.10–0.18. Negative (the #5459 Kangyur pages against each index): median 0.00–0.28,
off-index 18–20 of 20. The instrument works on every index.

**Result** (`results/tibetan-bl-evidence-2026-10-07/A-terma-reference/summary.json`).

| served class | n | median identity | IQR | off-index (retrieval < 0.05) |
|---|---|---|---|---|
| SERVE, book has a witness | 27 | 0.257 | 0.161–0.493 | 21 (78%) |
| SERVE, no witness | 96 | 0.144 | 0.000–0.200 | 96 (100%) |
| **SERVE, on-index** | **6** | **0.80** | 0.49–0.91 | 0 |
| MARK_UNRELIABLE (all) | 128 | 0.154 | 0.000–0.249 | 127 (99%) |
| no verdict | 30 | 0.000 | 0.000–0.135 | 30 (100%) |

Per work group, SERVE: dGongs 'dus 40 pages, median 0.17, 39 off-index; Kun bzang dgongs 'dus 11, 0.10, 11 off;
Milarepa 7, 0.18, 6 off; rnam thar 46, 0.14, 42 off; zhi khro / bar do 18, 0.19, 18 off; Mani bka' 'bum 1, 0.15.

**Reading.**
1. **No accuracy figure exists for this stratum, and none can be bought cheaply.** A witness that matches two
   pages of a book usually does not contain a third: these manuscripts are anthologies (*sogs*, *skor*) whose
   sections are scattered across printed collections, or different recensions. 96% of served pages retrieve
   nothing. The numbers above are retrieval failures, not OCR accuracy. Do not quote 0.17 as quality.
2. **Where a page does retrieve, the read is in the Kangyur/Nyingma range: median 0.80 on 6 pages** (0.97 on a
   Jātaka page, 0.91 and 0.89 on rnam thar / dGongs 'dus liturgy, 0.72 on a Dohā commentary, 0.49 and 0.38 on
   Milarepa against a **Namsel-OCR'd** print). That is a lower bound twice over: a different witness, and for
   UCB references a noisy OCR'd reference. n = 6 is anecdote, not a rate.
3. MARK_UNRELIABLE cannot be separated from SERVE here (both off-index), unlike #5459.
4. So the terma/biography stratum is judged by eye (step B's method) or not at all.

**Cost.** €0, CPU only; no model calls. Scripts: `scripts/eval/tibetan-bl-evidence/` (`strata.mjs`,
`draw_terma.mjs`, `extract_bdrc_zenodo.py`, `discover_refs.py`, `build_ref_opf.py`, `run_terma.sh`,
`summarize_terma.py`).
