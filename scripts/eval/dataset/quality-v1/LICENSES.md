# Licences, per file

Our own data (ids, scores, judge verdicts, our transcriptions and our translations) is licensed
**CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/), the licence of Source Library's
site content. Attribute as: Source Library / Embassy of the Free Mind, sourcelibrary.org.

| File | Licence |
|---|---|
| `audit-pages.jsonl` | CC BY-SA 4.0 (our transcriptions, translations, verdicts) |
| `audit-controls.jsonl` | CC BY-SA 4.0 |
| `audit-weights.json` | CC BY-SA 4.0 |
| `eye-check.jsonl` | CC BY-SA 4.0 |
| `two-read-screen.jsonl` | CC BY-SA 4.0 |
| `ocr-accuracy-cells.json` | CC BY-SA 4.0 |
| `ocr-accuracy-latin-pages.jsonl` | CC BY-SA 4.0 (scores only; no reference text) |
| `references/included-*.jsonl` | each file carries the licence of its source, named in the file name and in every row's `licence` field |
| `references/pointers.jsonl` | CC BY-SA 4.0 for the metadata; **no third-party text** |
| `README.md`, `LICENSES.md`, `CANARY.txt`, `checksums.txt` | CC BY-SA 4.0 |

## Third-party reference windows

| File | Rows | Licence |
|---|---:|---|
| `references/included-cc-by-sa-4-0.jsonl` | 87 | CC-BY-SA-4.0 |
| `references/included-pd-us-project-gutenberg.jsonl` | 35 | PD-US (Project Gutenberg) |
| `references/pointers.jsonl` | 417 | no text (pointer only) |

A reference window's text is included only when its record carries a `licence` field naming
CC BY-SA or public domain. CC BY-NC-SA sources (CBETA), in-copyright editions, and every record
whose licence is not recorded are **pointers only**: source URL, revision, work, and the sha256
of the window we scored against, so a reader who fetches the source can check they hold the same
text. The scripts that score against them are AGPL-3.0, in the repository.
