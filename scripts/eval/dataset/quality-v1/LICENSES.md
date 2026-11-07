# Licences, per file

**Deposit licence: CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/). Our own data (ids, scores,
judge verdicts, our transcriptions and our translations) is licensed CC BY-SA 4.0, the licence of Source Library's
site content. Third-party reference text keeps its own licence, named per file and per row below; CC BY-SA 4.0
does not relicense it.

| File | Licence |
|---|---|
| `audit-pages.jsonl` | CC BY-SA 4.0 (our transcriptions, translations, verdicts; 12 pages withheld as text, below) |
| `audit-controls.jsonl` | CC BY-SA 4.0 |
| `audit-weights.json` | CC BY-SA 4.0 |
| `eye-check.jsonl` | CC BY-SA 4.0 |
| `two-read-screen.jsonl` | CC BY-SA 4.0 |
| `ocr-accuracy-cells.json` | CC BY-SA 4.0 |
| `ocr-accuracy-latin-pages.jsonl` | CC BY-SA 4.0 (scores only; no reference text) |
| `references/included-*.jsonl` | each file carries the licence of its source, named in the file name and in every row's `licence` field |
| `references/pointers.jsonl` | CC BY-SA 4.0 for the metadata; **no third-party text** |
| `README.md`, `LICENSES.md`, `CITATION.cff`, `CANARY.txt`, `checksums.txt` | CC BY-SA 4.0 |

## Attribution

Attribute this dataset as: Source Library / Embassy of the Free Mind, *Source Library quality dataset v1*,
sourcelibrary.org (cite the DOI once published; `CITATION.cff`).

Each included reference row carries its own attribution: `source` (the project), `work` and `work_title`
(what the text is), `source_url` and `source_revision` (the exact page, file or revision the window was cut
from), `licence` and `licence_url`. Reuse a row's text with that attribution and that licence.

| Source | Licence | Rows |
|---|---|---:|
| First1KGreek | CC-BY-SA-4.0 | 42 |
| Kanripo | CC-BY-SA-4.0 | 79 |
| Perseus canonical-greekLit | CC-BY-SA-4.0 | 92 |
| el.wikisource | CC-BY-SA-4.0 | 12 |
| gutenberg.org (URL only) | PD-US | 32 |
| wikisource-en | CC-BY-SA-4.0 | 73 |

**Changes made.** Each included text is an excerpt: the window of the source text that matches one printed page
we hold, with the source's markup (XML/TEI tags, page-break and line marks) removed. For Wikisource and gutenberg.org
pages, running heads and page numbers are also removed and footnotes appended at the end. The words inside the
window are otherwise as the source has them.

## Third-party reference windows

| File | Rows | Licence |
|---|---:|---|
| `references/included-cc-by-sa-4-0.jsonl` | 298 | CC-BY-SA-4.0 |
| `references/included-pd-us.jsonl` | 32 | PD-US |
| `references/pointers.jsonl` | 209 | no text (pointer only) |

A reference window's text is included only when its record carries a `licence` field naming CC BY-SA or
public domain **and** the text is public domain, or licensed, where this deposit is served. CC BY-NC-SA sources
(CBETA), in-copyright editions, and every record whose licence is not recorded are **pointers only**: source URL,
revision, work, and the sha256 of the window we scored against, so a reader who fetches the source can check they
hold the same text. The scripts that score against them are AGPL-3.0, in the repository.

**Public domain in the US is not public domain everywhere.** Wikisource (English) hosts works that are public
domain in the United States, and the US public-domain texts (`included-pd-us.jsonl`, from gutenberg.org, with
its licence and header removed, so its name is not used) are public domain in the US only by that rule. A row
ships as text only when every author, editor and translator died before 1956 (life + 70 in the EU), or the work
is anonymous and over 70 years old; `pd_eu_basis` says which. The rest are pointers with
`why_pointer: not-public-domain-in-eu` (17 rows).

## Withheld page text in the audit

Our transcription and translation of a page reproduce the text printed on it, so the edition's rights decide. For
the 12 audit pages below, `transcription` and `translation` are null; the scores, verdicts,
`transcription_sha256` / `translation_sha256`, `url` and `image` remain, and the reason is in
`text_withheld`. Repeat controls of these pages are withheld the same way. Whether the site itself should serve
these pages is a separate question (#4809).

- `eab59a26ac`: public domain in the US, not in the EU: Philip K. Hitti (d. 1978), 1928
- `efb59025b3`: in-copyright edition: Rasārṇavakalpa, ed. Mira Roy (1976)
- `027bfd8b0f`: public domain in the US, not in the EU: Manly P. Hall (d. 1990), 1923
- `fda13f0cdb`: in-copyright edition: De Administrando Imperio, ed. Moravcsik, tr. Jenkins (1967)
- `1dfa95a297`: in-copyright edition: Opere di Giambattista Vico (Naples, 2004)
- `9b9709c639`: public domain in the US, not in the EU: C. C. Berg (d. 1990), 1927
- `a827fdf979`: in-copyright edition: Yoginī Hṛdaya, ed. V. V. Dwivedi (1965)
- `70af840905`: public domain in the EU not established: Bhrigu Samhita, ed. Ayodhya Prasad Mishra (1927), editor's death year unknown
- `0b25f62f8f`: public domain in the EU not established: Ramal Navaratna, edition and commentator undated
- `fd398eac82`: in-copyright edition: Drukpa Kagyu texts (Darjeeling, 1984)
- `48b134e2d6`: in-copyright edition: Writings of the Drukpa Je Khenpos (Thimphu, 1976)
- `71fc6920fe`: in-copyright edition: Zhi khro dgongs pa rang grol (Kalimpong, 1979)

The 15 swap controls show a translation from a reserve page whose book is not recorded, so its rights cannot be
checked: `translation_shown` is null on all swaps (`translation_withheld` says so), and the judge's verdict and
the hash remain.
