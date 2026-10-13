## Panel (#6388, 90 pages, AI-consensus key)

### Stored text as read on 2026-10-10 (reads/P.jsonl.gz)

| stratum | mean CER, digits dropped (v3) | mean CER, digits kept (v4) | failed (empty, refusal, CER > 30%) | median CER, pages with text (v3 → v4) | digits wrong |
|---|---|---|---|---|---|
| latin-print | 3.5% | 3.6% | 1 of 30 (cer_over 1) | 1.0% → 1.2% (n=30) | 5.5% of 397 digits, 15 pages |
| zh-manuscript | 9.3% | 9.3% | 1 of 30 (cer_over 1) | 6.4% → 6.4% (n=30) | too few |
| english-print | 13.3% | 13.4% | 6 of 30 (cer_over 5, empty 1) | 0.2% → 0.3% (n=29) | 0.8% of 4370 digits, 10 pages |

Pages with digit errors: 11. Most: english-print|69d14ba11c2a66dc094b503f-p289 26 of 4258 digits (page CER 0.7%); latin-print|69c833d26c6f3cc53c84e345-p-57 10 of 13 digits (page CER 9.4%); latin-print|69b51e539a81ef7feb3d3478-p177 6 of 221 digits (page CER 2.7%); english-print|69526046ab34727b1f04660c-p116 3 of 11 digits (page CER 68.8%); english-print|69c877ac6c6f3cc53c85809b-p-35 3 of 17 digits (page CER 0.2%); latin-print|69b65c8218b87551bfd1483c-p51 2 of 10 digits (page CER 1.4%)

Pages whose CER moves by more than 1 pt: 1 — latin-print|69c833d26c6f3cc53c84e345-p-57 7.8% → 9.4%

### Stored text today (pages.ocr.data, 2026-10-12)

| stratum | mean CER, digits dropped (v3) | mean CER, digits kept (v4) | failed (empty, refusal, CER > 30%) | median CER, pages with text (v3 → v4) | digits wrong |
|---|---|---|---|---|---|
| latin-print | 3.5% | 3.6% | 1 of 30 (cer_over 1) | 1.0% → 1.2% (n=30) | 5.5% of 397 digits, 15 pages |
| zh-manuscript | 9.3% | 9.3% | 1 of 30 (cer_over 1) | 6.4% → 6.4% (n=30) | too few |
| english-print | 13.3% | 13.4% | 6 of 30 (cer_over 5, empty 1) | 0.2% → 0.3% (n=29) | 0.8% of 4370 digits, 10 pages |

Pages with digit errors: 11. Most: english-print|69d14ba11c2a66dc094b503f-p289 26 of 4258 digits (page CER 0.7%); latin-print|69c833d26c6f3cc53c84e345-p-57 10 of 13 digits (page CER 9.4%); latin-print|69b51e539a81ef7feb3d3478-p177 6 of 221 digits (page CER 2.7%); english-print|69526046ab34727b1f04660c-p116 3 of 11 digits (page CER 68.8%); english-print|69c877ac6c6f3cc53c85809b-p-35 3 of 17 digits (page CER 0.2%); latin-print|69b65c8218b87551bfd1483c-p51 2 of 10 digits (page CER 1.4%)

Pages whose CER moves by more than 1 pt: 1 — latin-print|69c833d26c6f3cc53c84e345-p-57 7.8% → 9.4%

## Reference tier `ref-pinned` (Latin-script pages), SERVED text

19 pages. Alignment verdict changes: 0. Windowed CER moves by more than 1 pt on 0: none.
Median windowed CER 0.7% → 0.7%. References that carry digits (so digits are scored): 0 of 19.

## Reference tiers, engine outputs (the five committed CLI arms)

319 Latin-script reads in 13 cells (tier · language · engine). Cells whose MEDIAN or MEAN windowed CER moves by more than 1 pt: 0. Alignment verdicts that flip: 0.

Reads whose CER moves by more than 1 pt: 7 on 2 pages — ref-ws|ws-la-delitiae-sapientiae-de-amore-conjugiali-djvu-p2 (11 reference digits; gemini-3.6-flash 5.3% → 6.3%, gemini-3.7-flash 5.2% → 6.2%); ref-ws|ws-la-mercurius-gallobelgicus-cologne-1592-pdf-p20 (27 reference digits; gemini-3.6-flash 8.8% → 15.4%, gemini-3.7-flash 8.8% → 15.2%, gemini-3.8-flash-rep 8.8% → 15.1%, gemini-3.8-flash 8.8% → 15.1%, gemini-3.8-flash-high 8.8% → 15.1%).

| cell | n | median v3 → v4 | mean v3 → v4 |
|---|---|---|---|
| ref-pinned · Latin · gemini-3.6-flash+antigravity-cli | 6 | 2.7% → 2.7% | 4.6% → 4.6% |
| ref-pinned · Latin · gemini-3.7-flash+antigravity-cli | 6 | 2.1% → 2.1% | 5.9% → 5.9% |
| ref-pinned · Latin · gemini-3.8-flash+antigravity-cli | 6 | 2.2% → 2.2% | 4.2% → 4.2% |
| ref-pinned · Latin · gemini-3.8-flash+antigravity-cli-rep | 5 | 2.3% → 2.3% | 4.7% → 4.7% |
| ref-pinned · Latin · gemini-3.8-flash-high+antigravity-cli | 6 | 2.2% → 2.2% | 4.2% → 4.2% |
| ref-ws · German · gemini-3.6-flash+antigravity-cli | 23 | 0.3% → 0.3% | 0.5% → 0.6% |
| ref-ws · German · gemini-3.7-flash+antigravity-cli | 16 | 0.5% → 0.5% | 2.4% → 2.4% |
| ref-ws · German · gemini-3.8-flash+antigravity-cli | 17 | 0.3% → 0.3% | 1.1% → 1.1% |
| ref-ws · Latin · gemini-3.6-flash+antigravity-cli | 44 | 0.6% → 0.6% | 3.2% → 3.3% |
| ref-ws · Latin · gemini-3.7-flash+antigravity-cli | 42 | 0.4% → 0.4% | 1.3% → 1.5% |
| ref-ws · Latin · gemini-3.8-flash+antigravity-cli | 43 | 0.4% → 0.4% | 1.3% → 1.4% |
| ref-ws · Latin · gemini-3.8-flash+antigravity-cli-rep | 44 | 0.5% → 0.5% | 1.5% → 1.7% |
| ref-ws · Latin · gemini-3.8-flash-high+antigravity-cli | 45 | 0.3% → 0.3% | 1.1% → 1.3% |

## Reference tier `ref-ws` (Wikisource pages): bound only

The digit share of each reference is the most that page's CER can move; a cell's median can move by more than 1 pt only if most of its pages are above 1%.

| language | pages | median digit share | max | pages above 1% |
|---|---|---|---|---|
| German | 30 | 0.0% | 2.5% | 5 |
| Latin | 65 | 0.0% | 2.8% | 7 |

