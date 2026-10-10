---
stage: ocr
measure: accuracy
languages: [en]
scripts: [Latn]
canons: []
n_books: 3
n_pages: 9
verdict: "GLM-OCR writing whole English 1600s books makes about one meaning-changing word swap and three silent spelling modernisations per page, where flash-lite keeps the print."
status: rejected
decision: "GLM-OCR is not routed English print from 1600 on; any GLM lane needs a by-eye spelling-fidelity check first"
superseded_by: null
issue: [5660]
---
## 2026-10-04 — Does GLM-OCR hold up when it writes whole English 1600–1699 books? No: by eye it swaps plausible words and modernises spelling, where lite keeps the print (#5660)

PRIOR ART: 2026-10-04-ocr-bakeoff-round-3-5660.md (PR #5786, the CER verdict this pilot tests); 2026-10-03-open-engine-print-5660.md (the cells, scorer and generic lite prompt reused here).

**Design.** `measure: accuracy`, by eye (read from image vs read from text) on 9 consecutive pages (3 per pilot book), with flash-lite run on the same 9 JPEGs as the comparator; guard rates on all 281 pilot reads. Lane code: PR #5816 (rev `2adde01` read, `ee4504d` applied).


**Question.** The round-3 bake-off (PR #5786) recommended routing English print from 1600 on to GLM-OCR: median
CER 0.034 vs flash-lite 0.053 on 59 library pages. Does that hold when GLM writes whole books and its pages
are read against the image?

**Answer: no.** On 9 consecutive pages from 3 pilot books (*The Canker of England's Common Wealth* 1601,
Winstanley *Fire in the Bush* 1650, Plot *Natural History of Oxfordshire* 1677), GLM made **about one
meaning-changing word swap per page**:

- "community riſes" → "rites"
- "Iudas" → "Indas"
- "oppreſt" → "oppress"
- "he premiseth" → "be premiseth"
- "Ellipſis" → "Ellipse"
- a dropped "ſaue" in "24 carats fine, ſaue halfe a graine of allay"
- a dropped "in" in "no peace … but in Christ"

It also **silently modernised spelling about three times per page**: "foure" → "four", "feare" → "fear",
"mony" → "money", "intollerable" → "intolerable", "mankinde" → "mankind", "-ll" → "-l". And it dropped most
running heads and page numbers.

Flash-lite, run on the same 9 JPEGs with the bake-off's generic prompt ($0.0067), refused 2 pages
(RECITATION). On the 7 it answered, it kept every one of those spots as printed. The only miss common to
both was "ſlower" → "flower".

Every one of these errors is plausible English. A reader quoting the page cannot see them, which is the failure
the "gentle fleece" read of the bake-off warned about. CER counts a modernised "-e" the same as a visible
ſ→f garble. The bake-off's lite arm also carried refusals (CER 1.0) and ſ→f errors, so on CER GLM came out
ahead. On the pages a reader reads, the error types are what matter.

## The guards (PR #5816), on the 281 pilot reads

| guard | pages | what it caught |
|---|---|---|
| script: non-Latin letters | 7 | Greek quotations in Plot (GLM is catastrophic on Greek: 60/114 in the bake-off), a Hebrew word |
| script: #4850 loop | 1 | a Greek quotation looping to the 8,192-token cap (same page as token_cap) |
| truncation: token cap | 1 | (same page) |
| truncation: ends mid-line and < ½ book median | 1 | a short page |
| textless (< 10 letters) | 1 | not stored |
| written | **272** | |

Two guard rules were corrected on the pilot before any write:

- A run of 3 identical words flagged Winstanley's "woe, woe, woe", "Earth, Earth, Earth" and "overturning,
  overturning, overturning", so the threshold is now 4.
- Number tokens joined "Of 1 1/2 30 / Of 2 40 / Of 3" into a run of "of", so a token without letters now
  breaks a run.

GLM also emits Cyrillic look-alikes inside English words ("lossе"). These are mapped back to Latin and counted
on the page.

None of the guards can see a plausible-word swap. That is the failure that decides this verdict.

## Cohort

`books.language` says English on all 145 cohort books. On 42 of them, most of the language-tagged OCR pages
are Latin. Of the rest, 21 carry a `hidden_reason`. The English backlog is therefore **82 books, 19,965 unread
pages**, not 145 and 39,412.

## Throughput and money

- Pilot read on a Scaleway L4 (RunPod refused: account balance −$0.06): vLLM 0.30.0, GLM-OCR rev `2e85a62`,
  16 clients, 3.0 s/page.
- Each page is about 6,000 prompt tokens at 2,400 px wide, so the L4 is prefill-bound.
- At that rate the 19,965-page backlog would cost about $15 of L4.
- Spend: GPU $0.39, Gemini $0.0067.

## What would be worth testing instead

- **GLM only where lite refuses (RECITATION), behind the guards.** Lite refused 2 of these 9 pages, and a
  refused page otherwise has no text. That is the MinerU fallback's role (#5182), with an engine that read
  better than MinerU.
- Any GLM lane needs a **by-eye or reference check for spelling fidelity** before writing; CER alone did not
  see it.
