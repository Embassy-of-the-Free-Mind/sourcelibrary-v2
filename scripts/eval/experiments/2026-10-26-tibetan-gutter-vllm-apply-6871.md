---
stage: ocr
measure: accuracy
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 129
n_pages: 5132
verdict: "Applied: 2,805 Yigdzin (vLLM 0.29) page reads written to 40 held Tibetan books under the #4523 write rule; by eye 20/20 drawn text pages and 5/5 live pages clean (0 invented, 0 off-leaf). Blank claims NOT written: 1 of 10 drawn 'empty page' reads was a faded text leaf. 54 of 129 books excluded as modern authored or uncertain."
status: adopted
decision: "Pages written, books stay held (specialist-ocr-lane-4523); no translation queued. The reader's blank marker is not evidence of a blank leaf; withhold it."
superseded_by: null
issue: 6871
---
## 2026-10-26 · Applying the vLLM gutter reads to the 129 held Tibetan books (#6871 row 4, job tib-gutter-apply-6871)
<!-- PRIOR ART: 2026-10-20-tibetan-guttered-pages-yigdzin-page-mode-6871.md (the gate: round 2, the #4523 write rule) and
2026-10-26-yigdzin-vllm029-gex45-parity-6871.md (vLLM vs HF parity). This is the apply, not a new gate. -->

**What was approved.** Derek, 2026-10-26: "approve, if it is good, spot check". That answered the gpu-steward DECISION to apply the task-86 reads (5,132 pages, `gex45:/root/jobs/tib-gutter-6871/full-vllm`) under the #4523 write rule, revisions first.

**1. Rights pass, before anything else.** Per book, the title, imprint or colophon image was opened (`rights-pass-2026-10-26.csv`; four parallel Opus readers, one image or more per book).

| verdict | books | guttered pages |
|---|---|---|
| traditional (cleared) | 75 | 4,400 |
| modern authored (excluded) | 50 | 701 |
| uncertain (excluded) | 4 | 31 |

- **Modern authored, excluded (50 books).** Most are exile-era or PRC compilations: monastery histories, memoirs, poetry and essay anthologies, a dictionary and journals. Also excluded:
  - authors who died after 1950: Dudjom Rinpoche (twice), Gendun Chöphel (1951, borderline), Bodpa Tulku (1959, twice), Khetsun Sangpo;
  - © notices on the books' own content (LTWA 2005, Namgyal Institute 2003, Shang-Shung Edizioni 1983 and others).
- **Uncertain, excluded (4 books).** Author dates could not be settled from the images.
- **One page excluded inside a cleared book.** p6 of the LIRI facsimile (`6a37d979…`) is the 2000 © page.

**2. Plan** (`scripts/maintenance/apply-tib-gutter-vllm-6871.mjs --plan`). The rule:
- blank-marker lines stripped;
- `first-ocr-guard` (text, plus `blank_leaf` on the image) unflagged;
- ≥ 150 Tibetan syllables;
- under max_tokens.

| outcome | pages |
|---|---|
| **written** | **2,805** (40 books) |
| withheld: < 150 syllables | 1,072 |
| withheld: blank marker only | 475 |
| withheld: guard flag | 29 |
| dropped: junk read (Latin loops, duplicated lines) | 18 (+18 more in excluded books) |
| skipped: rights | 732 |
| skipped: excluded page | 1 |

**Independent check of the unflagged reads.** Over the 4,628 unflagged reads, Latin > Tibetan letters and any repeated ≥ 10-character line:
- 0 hits among the 2,805 written pages;
- 1 Latin hit, in an excluded book.

**3. By eye, before any write** (`apply-byeye-2026-10-26.jsonl`, image open, seeds 6871 / 68711 / 68712).
- **Blank reads: 9/10 true blanks, 1 FAIL.** The failure is `6a379f816b84dd3f2ea5ab0d` p2354, a faded 1975 reprint leaf with 5–6 lines of text, which the reader called `empty page`. Looking further:
  - the same marker was returned for an English imprint page (Jayyed Press, `…a5b6ce` p1060) and for more faded leaves in the same book;
  - neither `leafTexture` nor a central-ink measure separates faded text from ruled blank frames (framed blanks 0.04–0.05, the faded leaf 0.058).
  - **Fix: no blank claim is written.** Those 475 pages stay unread, which is their honest state, and the reason is recorded.
- **Text pages: 20/20 pass across 20 books**, drawn as 10 + 10 after the blank fix. 0 invented lines, 0 off-leaf text, no dropped line found. Line counts and line openings were checked against crops of the print, including cursive, interlinear and woodblock leaves. Minor defects:
  - 2 pages merge every line into one (layout only, the text runs in order);
  - 1 garbles a tiny interlinear name;
  - cursive leaves have letter slips and literal contractions.
- **The 36 flagged non-blank reads, by eye:**

| read | count | what the pages are |
|---|---|---|
| junk | 21 | mostly English front matter: Yigdzin cannot read Latin print and loops on it |
| partial loop | 11 | photo plates, dotted-leader contents pages, cursive manuscripts |
| faithful | 4 | refrain poems whose repeated line is really on the page |

  All 4 faithful reads are in an excluded book. The duplicate-line flag needs an exception for refrains the image shows. One legible page (`6a37d740…` p372) looped after its running head, so it is a re-read candidate.

**4. Apply, in waves; counts are `modifiedCount`.**
- **Wave 1:** 10 books, 130 pages. Read back from `/api/pages` and checked by eye: 5/5 match the image.
- **Wave 2:** 2,492 pages.
- **Two books aborted safely on the revisions-first check.** 7 pages carried flash-lite fail stamps and no text, and `saveRevisionsBeforeOverwrite` snapshots text only. The selector was fixed and they re-ran: 183 pages.
- **Totals:** 2,805 written, 0 races, 0 revisions needed (every page was empty).
- **Not changed:** 0 pages in any excluded book, 0 translations, 129/129 books still `held` and hidden.
- **Provenance on every page:**
  - `ocr.source 'bdrc'`, `ocr.model 'bdrc-yigdzin-v1'`, `ocr.pipeline 'tib_gutter_vllm_6871'`, `ocr.content_hash`;
  - `ocr.engine`: BDRC/tibetan-ocr @50506eb6, `runtime_id: yigdzin-vllm-0.29`, run `gex45-86-…`;
  - `ocr.verdict` carries the rule and the syllable count.

**Limits.**
- **n = 25 written pages checked by eye.** This rules out a high invented rate, not a low one. The #5660 prior for unflagged reads of ≥ 150 syllables, 5 % [2–13 %], still applies.
- **The ≥ 150 floor is what kept an invented read out.** On p6 of the LIRI facsimile (an English © page), the reader wrote 123 characters of fluent Tibetan that is not on the page. That shape is invisible to every text flag.
