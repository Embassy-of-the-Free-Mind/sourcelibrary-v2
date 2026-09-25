# Syriac OCR vs published electronic editions (#4883)

PRIOR ART: scripts/eval/benchmark/ and scripts/eval/lib/metrics.mjs — the benchmark scores engines against each
other or against IA djvu / Wikisource references; there was no Syriac reference. These scripts bring one in
(same-edition electronic texts) and add the page classification that tells a recited page from a read one.

Result: `scripts/eval/results/syriac-vs-published-2026-09-16.md`. Logged in `scripts/eval/EXPERIMENTS.md`.

## Scripts (Python 3, `pip install rapidfuzz`)

- `dump-pages.mjs` — pulls `ocr.data` / `translation.data` for a list of book ids into `pages/<id>.jsonl` (one
  row per page: `pn, model, ocr, tr, img`). Run from the repo root with `.env.production.local` loaded.
- `align.py` — locates each page in a reference by word-trigram votes and scores CER/WER over consonantal Syriac.
  `--mode verses` for the ETCBC Peshitta plain text (`{c,b,ch,v,t}` JSONL), `--mode flat` for a Digital Syriac
  Corpus text. A fabricated page has no anchor and is reported as `no-anchor`, not dropped silently.
- `align-by-printed-page.py` — for Digital Syriac Corpus TEI with `<pb n="…"/>`: builds a page-exact reference of
  the printed edition, solves the constant offset to our `page_number`, scores every page.
- `english-vs-published.py` — our English page vs the best window of a public-domain published translation,
  with a control work as the null and a monotone-chain test (both books are sequential).

The Bible page classifier (right passage / wrong passage / invented, via longest increasing subsequence over
canonical verse order) lives in the results write-up's artefacts as `classify_bible.py` output; the logic is
described there.

## References used and where they came from

- ETCBC `syrnt` (SEDRA 3 export of the 1905 BFBS NT; MIT tooling) and ETCBC `peshitta` 0.2 (Leiden OT; CC BY-NC
  4.0): `plain/` directories.
- Digital Syriac Corpus (`srophe/syriac-corpus`, `data/tei/*.xml`, CC BY 4.0): Isaac of Nineveh from Bedjan 1909
  (files 392–449), Narsai from Mingana 1905 (46 files), Aphrahat from Parisot 1894 (1–23).
- archive.org djvu text (fetch on Hetzner; the laptop is geo-blocked): `b31365334`, `bookofgovernors02thom`,
  `kalilahdimnahorf00bdpkuoft`, `bookofbee00solo`, `monksofkublaikha0000eawa`.
