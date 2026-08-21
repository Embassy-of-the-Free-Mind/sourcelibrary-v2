---
name: qa-eval
description: Run OCR and translation quality evaluations across scripts and languages. Produces research-grade reports with MCR, cross-model agreement, embedding-space hallucination detection, and corpus readiness scores.
---

# QA-Eval: Quality Evaluation Framework

Run systematic quality evaluations on OCR and translation output across all scripts and languages in Source Library. Produces structured JSON results and markdown blog posts suitable for academic publication.

Issue: #1329

## Quick Start

```bash
# Load env
set -a; source .env.production.local; set +a

# OCR consistency (run each model N times, compute Modal Consistency Rate)
node scripts/eval/qa-eval.mjs consistency --corpus=bhutan --sample=10 --models=flash,opus --runs=3

# Embedding-space evaluation (hallucination detection without ground truth)
node scripts/eval/qa-eval.mjs embedding --corpus=bhutan --sample=10

# Compare against ground truth (CER for OCR, BLEU/ROUGE for translation)
node scripts/eval/qa-eval.mjs compare --corpus=bhutan --against=ocr

# Readiness score for a corpus
node scripts/eval/qa-eval.mjs readiness bhutan

# Show all results
node scripts/eval/qa-eval.mjs report --latest

# Generate blog post from results
node scripts/eval/qa-eval.mjs report --corpus=bhutan --format=blog --save
```

## Invocation Modes

### Interactive
```
/qa-eval                                    # Show help and available corpora
/qa-eval --corpus=bhutan --sample=5         # Quick consistency check
/qa-eval --corpus=bhutan --blog             # Full eval + blog post
```

### Specific Commands
```
/qa-eval consistency --corpus=bhutan --models=flash,opus --runs=3
/qa-eval embedding --corpus=bhutan --sample=20
/qa-eval compare --corpus=bhutan --against=translation
/qa-eval matrix                             # All corpora comparison table
/qa-eval readiness bhutan                   # Quick readiness score
```

### Cost Estimation
```
/qa-eval consistency --corpus=bhutan --sample=10 --models=flash,opus --runs=3 --dry-run
```

## Available Corpora

Defined in `scripts/eval/corpus-registry.json`:

| Corpus | Script | Description |
|--------|--------|-------------|
| bhutan | Tibetan | 1,325 EAP manuscripts (dbu can + dbu med) |
| latin-alchemy | Latin | Printed alchemical texts (baseline) |
| fraktur | German | Pre-1800 Fraktur/blackletter |
| arabic | Arabic | Printed Naskh |
| hebrew | Hebrew | Hebrew + Rashi script |
| chinese | CJK | Woodblock-printed classical Chinese |
| sanskrit | Devanagari | Printed Sanskrit editions |
| greek-ancient | Greek | Aldine and early printed Greek |
| bph-manuscripts | Mixed | BPH high-quality manuscript scans |

## Model Aliases

| Alias | Full Model ID |
|-------|---------------|
| flash | gemini-3-flash-preview |
| lite | gemini-3.1-flash-lite-preview |
| opus | claude-opus-4-6 |
| sonnet | claude-sonnet-4-6 |
| haiku | claude-haiku-4-5-20251001 |

## Metrics

### OCR Quality
- **MCR (Modal Consistency Rate)**: % of N runs producing the majority output at temp=0
- **Pairwise character similarity**: Levenshtein-based, 0-100%
- **Syllable similarity**: Script-aware tokenization (tsheg for Tibetan, char for CJK)
- **CER (Character Error Rate)**: Edit distance / reference length (requires ground truth)

### Translation Quality
- **BLEU-4**: N-gram overlap with brevity penalty (requires ground truth)
- **ROUGE-L**: Longest common subsequence F1 (requires ground truth)
- **Embedding distance**: Cosine distance between OCR and translation embeddings (no ground truth needed)

### Hallucination Detection
- Pages where OCR→Translation embedding distance exceeds 2σ from corpus mean are flagged
- Example: Flash Lite "translating" an astrological text as a ritual manual

### Readiness Score
- **High**: MCR ≥ 90% AND cross-model agreement ≥ 85%
- **Medium**: MCR ≥ 70% AND cross-model agreement ≥ 70%
- **Low**: Below medium thresholds

## Output

Results are saved to `scripts/eval/results/` as JSON and optionally as markdown blog posts in `docs/`.

```
scripts/eval/results/
  bhutan-consistency-2026-04-23.json
  bhutan-embedding-2026-04-23.json
  matrix-2026-04-23.json
docs/
  qa-eval-bhutan-2026-04-23.md
```

## Ground Truth

Place reference transcriptions and translations in `scripts/eval/ground-truth/` as JSON:

```json
{
  "book_id": "abc123",
  "page_number": 5,
  "script": "tibetan",
  "source": "BDRC etext",
  "source_url": "https://library.bdrc.io/...",
  "ocr_ground_truth": "...",
  "translation_ground_truth": "...",
  "translation_source": "Thurman 1994"
}
```

Sources: BDRC etexts, OpenPecha, Esukhia Derge Kangyur, Lotsawa House, scholarly editions.

### Multi-language reference ground truth (#3212)

Ground truth for ANY language is built from published etexts with `build-reference-groundtruth.mjs`, which generalizes the ctext system below. Per-language works files live in `scripts/eval/reference-works/<language>.json` (curated passages + provenance; sources registry in `scripts/eval/reference-sources.json`):

```bash
node scripts/eval/build-reference-groundtruth.mjs --language=hebrew            # dry run
node scripts/eval/build-reference-groundtruth.mjs --language=hebrew --write    # pin ground truth
node scripts/eval/qa-eval.mjs compare --corpus=hebrew --against=ocr            # score one corpus
node scripts/eval/qa-eval.mjs scorecard                                        # per-language table
```

Two hard-won rules (measured on Armenian/Latin, 2026-07-19 — see `tests/unit/reference-ocr-guard.test.ts`):

- **The identity guard is WORD-level for alphabetic scripts.** Char-level free-skip matching accepted a modern Armenian translation of the grabar Buzand at 22-25% CER (under the 0.30 bar); word-level scored the same decoy 88-96%. CJK stays char-level (its huge character inventory makes coincidental matches rare). Wikisource often shelves translations under the original's exact title — the guard, not the title, decides.
- **One-page rule.** Reference passages must fit on a single printed page of the densest edition held (commentary editions print ~4 verse lines per page). A passage spanning a page boundary fails the guard on honest deletions — shorten the passage, don't loosen the guard.

Orthography that varies BETWEEN EDITIONS (Latin u/v, i/j, long-s; Hebrew niqqud + maqaf; Greek polytonic marks; Armenian ew-ligature) is folded before comparison in `normalizeForScript` (`lib/metrics.mjs`) so it never counts as OCR error.

Current scorecard (2026-07-19): Armenian 91.8%* · Chinese ~98.5% · Greek 100% · Hebrew 100% · Latin ~99% (char accuracy on aligned canonical passages; run `scorecard` for current numbers).

\* Armenian is a lower bound: manual audit of the page scan showed ~18/21 word errors are the 1805 printing's nomina-sacra abbreviations (ա՟ծ = Աստուած etc.) transcribed diplomatically by our OCR but silently expanded by the TITUS reference — true misread rate on the page is ~1%. See `audit_note` in `ground-truth/armenian-zohrab-john-1.json`. General lesson: when a scorecard number looks bad, diff the words and READ THE SCAN before believing it — reference transcription conventions (abbreviation expansion, normalized punctuation) masquerade as OCR error.

### Non-canonical rows — the memorization control (#3235)

Canonical references (Genesis 1, Iliad I, John 1) measure OCR *with the model's memory helping* — the score is a memory-assisted upper bound. Since 2026-07-19 every language works file also carries **non-canonical rows** (`non_canonical: true`, `memorization_risk: low|medium`; ground-truth files mirror both under `page_class`): editor prefaces, biographical front matter, and mid-text passages of rarely digitized works, scored by the same guard on the same page classes. The canonical-vs-non-canonical score gap ≈ the memorization subsidy, and non-canonical scores are the numbers that transfer to the rare texts the library actually exists for.

Where the references come from (the trick that made this findable): **etexts that preserve their source edition's print pagination map deterministically onto our scans once we hold the same edition** — TITUS (Armenian: Xorenac'i Tiflis 1913, Eznik Venice 1826) and First1KGreek (Hero Teubner 1899, Simplicius CAG 9 1882, Philo Cohn 1896) both do this. Wikisource's Clementine Vulgate matches the 1566 Louvain edition it descends from; Sefaria covers non-liturgical Hebrew (Sha'arei Orah, Sefer HaYirah); Durham's Living Poets has the Donatus-auctus Vita Vergilii that 16th-c Virgils actually print (the modern critical Vita would fail the guard — memorized text actively hurts there, which is the point).

Rules for adding rows: (1) same pinning discipline as canonical rows — visual page audit before `--write`, `page_class` with `canonical_text: false`; (2) a "published transcription" is never zero-exposure (First1K is on GitHub) — record `memorization_risk`, don't claim zero; (3) cross-edition references (our Dioscorides 1549 vs Wellmann 1907; TITUS's 1959 Eznik orthography vs the 1826 printing) make char accuracy a LOWER BOUND — note it, don't "fix" the reference; (4) rejected candidates worth remembering: Zohar Cremona 1558 (Sefaria transcribes the Mantua/Vilna recension — score would conflate recension with OCR error), Zohrab 1805 front matter, Aldine Greek prefaces, Manutius' Virgil dedications (no open transcriptions exist — verified negatives, 2026-07-19). Works entries may pin `book_id`/`page_number` directly (copy-exact contrasts, brittle probes); `build-reference-groundtruth.mjs --only=<slug-rx>` scopes `--write` so it can't clobber hand-annotated files, and `qa-eval.mjs scorecard --only=<rx>` scopes paid model runs the same way (regex; scoped runs save as `scorecard-<rx>-<date>.json` so they never clobber the full scorecard).

**RECITATION HAZARD (the inverse failure — a number that looks too GOOD).** Two pinned rows were deleted on 2026-07-19 after page-scan audits proved the pipeline OCR *recited* the canonical passage from memory instead of reading the page: a 1450 Mishnah-commentary manuscript (OCR contained only the letter-perfect canonical Mishnah, none of the visible commentary) and a Daxue Huowen page (OCR half-read the real columns then emitted the whole Zhongyong opening, which is not printed there). A third row (Zhuangzi) had its reference trimmed because the OCR completed the famous sentence past the page edge. Pattern: **pages that discuss a canonical text prime the model to recite it, and the identity guard cannot tell reading from reciting** — it verifies the reference is in the OCR, not that it came from the page. Rules: (1) pin only pages that verifiably PRINT the passage — check the image, not the OCR; (2) prefer pages where the OCR also transcribes non-canonical page furniture (apparatus, commentary, adjacent text) at several times the reference length; (3) treat a perfect score on a degraded/manuscript source as a hallucination flag, not a triumph. Related: `lesson_gemini_recitation_canonical_texts` (Gemini's RECITATION safety block on canonical texts is the same memorization surfacing differently).

### OCR vs. ctext (Chinese)

For the Chinese corpus, OCR ground truth is auto-built from [ctext.org](https://ctext.org) canonical transcriptions:

```bash
node scripts/eval/build-ctext-groundtruth.mjs           # dry run — shows alignment + which works pass the guard
node scripts/eval/build-ctext-groundtruth.mjs --write    # write pinned ground-truth files
node scripts/eval/qa-eval.mjs compare --corpus=chinese --against=ocr
```

Two things make this work where a naive CER fails:

- **Subsequence alignment** (`subsequenceCER` in `lib/metrics.mjs`). Most of our Chinese editions are *commentary* editions — the canonical main text is interleaved with small-character annotation that ctext's main-text-only transcription lacks. The reference is matched as an in-order subsequence of the OCR with extra (commentary) characters skipped free, so the metric scores OCR error on the canonical text only. A plain edit distance scored the Book of Odes at 6% when it was really 99%.
- **Pinned book + page = identity guard.** `compare` fetches the exact `book_id`/`page_number` from each ground-truth file (no fuzzy title matching that could grab a same-phrase decoy). The generator only writes a file when the passage aligns below `--threshold` (default 0.30); anything above is skipped as a wrong book or a divergent recension (e.g. Zhu Xi's reordered *Great Learning*, the *Shiji* with 三家注) — reported, not counted as OCR error.

Coverage caveat: ctext holds canonical **printed** texts only — manuscripts, tables, and rare/regional works (the actual OCR frontier) are out of scope and need MCR / cross-model / embedding checks instead. Baseline run (2026-06-25): **98.5% character accuracy** across 7 canonical works.

## Architecture

```
scripts/eval/
  qa-eval.mjs              # CLI entrypoint
  lib/
    metrics.mjs            # All metric functions
    runners.mjs            # Gemini + Claude model execution
    sampling.mjs           # MongoDB page sampling
    report.mjs             # JSON + Markdown output
    embedding-eval.mjs     # Embedding-space evaluation
  corpus-registry.json     # Known corpora
  ground-truth/            # Reference data
  results/                 # Output
```

## Key References

- Blog post: `docs/blog-tibetan-ocr-benchmark.md`
- Prototype: `_tmp-ocr-consistency.mjs`
- Embedding model: `gemini-embedding-2-preview` (768d, matches production search)
- Related papers: GlotOCR Bench, Wang & Wang 2025, Conformal Risk Control for OCR

### Published dataset export

`node scripts/eval/export-eval-dataset.mjs --version=vX.Y` emits `scripts/eval/dataset/<version>/` — pages (with MEASURED image resolution), license-gated reference texts (TITUS/ctext ship as sha256 pointers, not text), and raw scored runs. Datasheet + caveats in the version README. Resolution spans 0.64–17.4 MP across pinned pages and confounds naive language-level gaps — read caveat 2 before quoting numbers.
