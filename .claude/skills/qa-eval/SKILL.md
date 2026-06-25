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
| chinese-classical | CJK | Woodblock-printed classical Chinese |
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
