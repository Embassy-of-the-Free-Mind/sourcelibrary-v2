# Printed-edition hieroglyph OCR benchmark

PRIOR ART: scripts/eval/benchmark/ (the OCR benchmark registry: Latin, Han, Tibetan,
Syriac, Japanese cells, sealed refs, CER) — it has no hieroglyph cell and no Unicode
Egyptian Hieroglyphs scorer, and its refs come from Wikisource/ctext/BDRC, not from
ORAEC. This directory is a self-contained cell that could be folded into it once a
second engine exists to compare.

**What this is.** Page images from Egyptological editions Source Library holds, paired
with machine-readable hieroglyph strings for the same inscriptions from ORAEC, and a
scorer. It answers one question: *can a model read hieroglyphs off a printed page?*
There is no production hieroglyph OCR today and no public benchmark on printed
editions, which are much easier than wall or papyrus photographs and are what
Egyptology actually published in 1900–1950.

**What it is not.** None of the pages are metal-type hieroglyphs. Sethe's *Urkunden*
is autographed (his hand copy, lithographed); the British Museum *Hieroglyphic Texts*
plates are hand-drawn facsimiles. The library's genuinely typeset editions (Helck,
*Urk.* IV Hefte 18–19; Budge, *Book of the Dead* 1910) have no ORAEC-encoded text
to pair with, so they are absent. `script_class` on each pair says which it is.

## Files

| file | what |
|---|---|
| `alignment.json` | hand-verified table: ORAEC text id → edition, IA leaf(s), plate/page label, whether ORAEC cites the edition directly or as "vgl." |
| `build_pairs.py` | ORAEC clone + `alignment.json` → `pairs.jsonl` |
| `pairs.jsonl` | 38 pairs, 10,203 ground-truth signs, 5 books (4 editions) |
| `score.py` | sign error rate (anchored and full), sign-count ratio, loop flag, controls |
| `run_baseline.py` | one Gemini pass over the pairs (stdlib; runs on Hetzner) |
| `results/<run>/` | raw model outputs, one JSON per pair, plus `report.md` |

## Pairs

One pair = one ORAEC text and the page image(s) that carry it. Fields: `pages[]`
(`image_url` = the IA IIIF leaf that was checked by eye; `reader_url` for humans),
`edition_ref` (printed page or plate), `oraec_id`, `gt_segments`, `sign_count`,
`token_coverage`, `citation_kind`, `page_exclusive`, `focus`.

| edition | book | pairs | signs | script class |
|---|---|---:|---:|---|
| Sethe, *Urkunden des Alten Reichs* (Urk. I), 2nd ed. 1933 | `6a9afa09441bca6a13ac2510` | 20 | 1,726 | autograph |
| BM *Hieroglyphic Texts* Part I (1911) | `69e02e8b1dae13995358966e` | 2 | 1,165 | line drawing |
| BM *Hieroglyphic Texts* Part II (1912) | `69e02e5d1dae139953589503` | 7 | 3,165 | line drawing |
| BM *Hieroglyphic Texts* Part IV (1913) | `69e013b193b116d24238b35c` | 8 | 2,532 | line drawing |
| BM *Hieroglyphic Texts* Part V (1914) | `69e02e621dae13995358957c` | 1 | 778 | line drawing |

**How a pair was aligned.** ORAEC's `bibliography` string names the edition and page
or plate ("Urk I 59.10–60.11", "Part II, London 1912, 6 und Tf. VIII-IX (Nr. 146)").
For Urk. I the printed page number in the running head was read off the leaf; for
HTBM the plate number and stela title on the leaf. Every `ia_leaf` in `alignment.json`
was checked that way on 2026-09-19 — *not* computed from an offset, because the
offset between Source Library reader page and IA access leaf differs per book
(Urk. I and HTBM I: leaf = page − 1; HTBM II and V: leaf = page − 2; HTBM IV: the
library's own page images are shifted against the IA source, so only the IA leaf is
trustworthy — see "Findings about the library" below).

**Ground truth.** Token `hiero` strings from ORAEC, sentences and tokens in order,
restricted to U+13000–1342F (format controls U+13430–1345F dropped). A token with no
encoding, the ⯑ placeholder, or U+FFFD splits the ground truth into *segments*; the
scorer aligns each segment separately so an encoding gap is not charged to the model.
`token_coverage` says how much of the text ORAEC encoded (HTBM stelae 0.9–1.0; Urk. I
texts 0.5–1.0).

**"vgl." pairs.** For the Senedjemib texts (Urk. I 61–68) ORAEC's hieroglyphs follow
Brovarski's 2001 edition and cite Sethe as "vgl." (compare). Sethe's 1903 copy of the
same wall may differ in sign choice or lacunae, so those pairs (`citation_kind: vgl`)
carry a few points of irreducible ground-truth noise. Direct pairs do not.

**Licence.** Ground-truth strings: CC BY-SA 4.0 (ORAEC, from the Thesaurus Linguae
Aegyptiae; https://github.com/oraec/corpus_raw_data). Page images: public domain
(Sethe d. 1934; the BM parts are 1911–1914 Crown publications, authors d. 1934/1930);
they are referenced by URL, not copied here. `pairs.jsonl` is therefore CC BY-SA 4.0.

## Scoring

```
python3 score.py --pairs pairs.jsonl --controls
python3 score.py --pairs pairs.jsonl --outputs results/<run> --md results/<run>/report.md --json results/<run>/scores.json
```

* **SER anchored** (primary): per segment, Levenshtein distance to the best-matching
  window of the model output (free start/end), summed over segments, divided by
  ground-truth signs. Robust to shared pages, encoding gaps and reading-order
  differences; blind to extra output, which `count ratio` and `looped` report.
* **SER full**: Levenshtein over the whole output, only where the page carries nothing
  but this text and ORAEC covers ≥ 95 % of it (`page_exclusive`).
* **count ratio**: output signs / ground-truth signs (page_exclusive pairs).
* **looped**: any 20-sign window recurring ≥ 4 times — the degenerate repetition the
  repo's OCR loop gate (#4850) catches on Latin and Han pages.
* **Controls**: ground truth against itself scores 0.0 on every pair; against a
  shuffle of its own signs it scores 0.79–0.96 (full) and 0.54–0.83 (anchored). PASS.

## Baseline

See `results/flash3-preview-v1/report.md` and the entry in `scripts/eval/EXPERIMENTS.md`
(2026-09-19). Model `gemini-3-flash-preview` (the non-lite 3.x flash the codebase
uses; there is no `gemini-3.1-flash`), temperature 0, `thinkingBudget: 0`, images
inline at full IA resolution, one request per pair.

## Findings about the library (not fixed here — this PR writes nothing to `books`/`pages`)

* Three HTBM volumes are mis-catalogued: `69e02e8b1dae13995358966e` ("Part X") is
  Part I (1911); `69e02e5d1dae139953589503` ("Part III") is Part II (1912);
  `69e02e511dae1399535893d7` ("Part I") and `69e02e571dae13995358946e` ("Part II") are
  both the 1961 second edition of Part I. Part III (1912) is not held.
* `69e013c593b116d24238b3d7`, catalogued "Sethe, Urkunden des ägyptischen Altertums,
  1906", is Helck, *Urkunden der 18. Dynastie* Heft 18 (1956) — typeset, and
  in copyright.
* `69e013b193b116d24238b35c` (HTBM IV): the reader's page images do not match the
  OCR text on the same page number (page 52's text describes plate 18; its image is a
  blank verso). A #3368-class leaf shift; the IA leaves themselves are consistent.

## Extending

More pairs come from more held editions with ORAEC coverage: candidates counted on
2026-09-19 (glyph-encoded ORAEC records that cite them) — Lepsius *Denkmäler* 229
(held; lithographed plates), Sethe *Lesestücke* 14 (not held), Schäfer *Urk.* III 13
(not held; the Piye stela alone is ~10,000 signs), Wreszinski *Ebers* 52 (not held).
