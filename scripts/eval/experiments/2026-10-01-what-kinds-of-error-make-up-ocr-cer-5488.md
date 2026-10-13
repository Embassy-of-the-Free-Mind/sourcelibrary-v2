---
stage: ocr
measure: accuracy
languages: [en, la, de, grc]
scripts: [Latn, Grek]
canons: []
n_books: null
n_pages: 73
verdict: "On early English print flash-lite's OCR error is mostly long s read as f (57%) and flash's mostly refusals (72%); served OCR keeps body text but normalises spelling."
status: informational
decision: null
superseded_by: null
issue: [5488, 5564]
---
## 2026-10-01 — What kinds of error make up an OCR engine's CER? On early English print, flash-lite's is mostly ſ read as f and flash's is mostly refusal; served OCR keeps its body text but normalises spelling (#5488)

PRIOR ART: 2026-10-01-early-english-ocr-accuracy-against-eebo-tcp-5488.md — the CERs this decomposes; .claude/docs/page-error-taxonomy.md — the page-level classes by eye (O5 omission, O8 normalisation, O12 marginalia), which this counts at word level.

**Question.** A CER says how much an engine gets wrong, not what. Which error classes make up the CER of production flash-lite, flash, and the OCR we serve, and does the answer change outside early English print?
**Design.** `measure: accuracy`, decomposed. `ocr-error-classes.py` aligns each engine's tokens to a page-level reference (folded key: lowercase, punctuation off, ſ→s, æ→ae, œ→oe; difflib) and sorts every difference into a class of one of four kinds: **ocr** (a real departure), **convention** (u/v, i/j, accents, case), **reference** (a defect of the reference: TCP illegible-letter marks leave split words), **alignment** (window padding, running heads). Classes are weighted by the characters of the affected words, which gives a ranking, not a CER. Strata: `eebo-tcp-5488` (73 pages, same-edition TCP, leaf-checked; engines plus the stored production OCR, mostly flash with the production prompt); `ref-ws` (120 Wikisource-proofread pages of the same scan: 65 Latin, 30 German, 25 Greek); `greek-ext` / `greek` (references from **modern editions**, Perseus / First1KGreek, not leaf-checked, so edition variance is confounded; reported, not relied on). Engine outputs are the benchmark runs (generic prompt, thinking 0, no recitation retry). 94 examples across classes were checked against the page image (appendix: `results/ocr-error-classes/appendix-2026-10-01.md`).
**Result.** Share of each reader's OCR-kind error weight (word-weighted):
- **EEBO-TCP, flash-lite:** ſ read as f **57%** (55/73 pages), refusals 12%, marginal-note order 9%, letter misreads 7%.
- **EEBO-TCP, flash:** refusals **72%** (7 pages); ſ→f 3%; otherwise misreads 5%, marginal 7%.
- **EEBO-TCP, stored production OCR:** total OCR-kind weight 5.2% of reference, against 15–16% for either engine on the generic prompt. ſ→f 27% (18 pages), letter misreads 19%, line-end splits and joins 11%, spelling normalised about 5% plus a third of the misread bucket by eye (themselvs→themselves, Charmes→Charms). **No omitted body text** (the "omitted runs" are marginal citations). Numeral misreads ≈ 0.
- **ref-ws (Latin/German/Greek, mixed periods):** refusals are the largest single class for both engines (5 pages, all RECITATION, on canonical texts such as Tacitus' *Agricola* and Apollonius' *Argonautica*). Flash-lite: ſ→f 14%, misreads 13%. Flash: misreads 14%, ſ→f 6%. Accent differences (convention) on 37–39 pages.
- **By-eye check of 94 examples** (appendix): the engine was wrong in 44, **the reference in 16** (TCP keyers' long-s slips such as *ſit* → "fit", typos, regularised spellings), 17 were convention, 11 not on the page (window or aligner artefacts), and 5 were refusals of legible pages. A same-edition reference is not word-level ground truth: some "errors" in a CER are correct readings.
- **Greek (modern-edition references):** misreads 40–42% and inserted/omitted runs 25–30%. These are mostly edition variance and window mismatch, not OCR evidence.
**Implication.** For early print, flash-lite's gap to flash is almost all one glyph (ſ→f), and flash's gap is refusals. A recitation retry (#5521) plus an ſ-aware retry or prompt removes most of both. Silent spelling normalisation (taxonomy O8) is the served OCR's characteristic error on early English and matters for an edition; measure it directly next. A `/<[^>]+>/` tag-stripper deleted body text after a centred line (`->…<-`) in this analysis, and the same pattern is live in production code → #5564.
**Replicated?** No. Classes are heuristics; read the examples before quoting a class (the first pass found tag residue and page numbers inside "other misread"). **Artifact:** `scripts/eval/ocr-error-classes.py`, `results/ocr-error-classes/*-2026-10-01.json`, appendix. Cost $0 (re-uses the benchmark outputs pulled from Hetzner `/root/ocr-bench/images`).
