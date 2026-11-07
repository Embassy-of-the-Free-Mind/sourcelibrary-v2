# Preregistration — AI punctuation (句读) for Chinese text, against CBETA (#8140)

Committed on `eval/zh-punct-8140` before any arm ran on any page. Part of #8035.

**Question.** 168 of 169 random Chinese pages we serve have no punctuation. Can a model add it as a separate layer, inserting marks only and never changing a character, well enough to build a reader layer? Which arm does it better, gemini-3.8-flash-low on `agy -p` or Opus on `claude -p`?

## Frame A: CBETA (the key)

- **Books.** The 66 books of #6101 (`scripts/eval/results/cbeta-ref-6101/book-class.json`), `visible: true && pages_count > 0`. All 66 are live.
- **Where the key lives.** For the 54 print books it is `pages.ocr.data` (`ocr.source = 'cbeta-xml-p5'`). The 12 Siku Quanshu manuscript books of 五燈會元 (X1565) were re-read by Paddle on 2026-10-10, so their CBETA text is now only in `page_revisions` (`field: 'ocr'`, `source: 'cbeta-xml-p5'`, newest row), looked up by `page_id`.
- **Draw (done before this file, no arm involved).** Mulberry32(8140). Each book's pages (`page_number > 0`, sorted) are shuffled. The first page whose CBETA text has at least 100 Han characters is taken. One page per book, 66 pages: `scripts/eval/zh-punct-8140/draw-A.json` (ids, counts, sha256 of the key, no text).
- **Licence.** CBETA is CC BY-NC-SA 4.0. Its text, the arms' outputs (CBETA's characters plus marks) and any excerpt stay in `$JOB_SCRATCH`. Only scores and page ids are committed.

### Does the key hold punctuation? (checked on the draw before this file)

On all 66 drawn pages, the median is **0.19 marks per Han character**. So the key is punctuated, and the gate in the brief passes. Two facts change how it is scored, stated here before any arm ran:

1. **Two punctuation styles.** 39 pages use modern punctuation (，。：？「」…). **27 pages use only 。 as a generic break (old 句讀 style), with no ，**, including all 12 Siku 五燈會元 pages. On those 27 pages, 。 does not mean "sentence end", so a sentence-final score there would only measure the style.
2. **Two lineage-list pages** (`559523-p41`, `5595f2-p25`, 景德傳燈錄 法嗣 lists) have zero marks. Their structure is line breaks, not punctuation. The input has no line breaks, so any arm would be charged false breaks. **Excluded: pages whose key has under 0.02 marks per Han character.** That leaves 64 scored pages: 39 modern-style, 25 。-only (12 of them Siku 五燈會元).

### Input and key

- **Input.** CBETA's text with a gaiji `〔…〕` turned into one `〓`, then every Unicode punctuation mark (`\p{P}`) and all whitespace removed. This includes the `（）` around inline notes; the note text stays.
- **Break positions.** A break sits after character *i* when one or more marks fall between character *i* and *i+1*. `（）` are never breaks, in the key or in an arm's output. A mark before the first character or after the last is not a position.
- **Sentence-final break.** The marks at that position include 。？！ (or ASCII `.?!`).
- **Code.** `scripts/eval/zh-punct-8140/lib.mjs` (`breaksOf`, `guard`, `repairBreaks`).

### Arms (same 64 pages, same prompt)

- **G: `gemini-3.8-flash-low`** on `agy -p`, subscription pool `/root/.agy-milo` (held to that model). Call through `scripts/lib/agy-cli.mjs` `gatedTextCall` (plan mode, tool gate, sentinel markers). Up to 3 tries on an empty or failed reply. No Gemini API, no fallback model.
- **O: Opus** on `claude -p --model opus`, subscription. Text only, no tools, run from an empty directory outside the repo.
- **Prompt.** `scripts/eval/zh-punct-8140/prompt.txt`, frozen here. One page per call.
- **Pilot.** 10 pages per arm first. If an arm fails mechanically, it is fixed once or reported.
- **Noise floor.** Arm G is run a second time (G2) on 30 pages: the first 30 of a Mulberry32(81401) shuffle of the 64. G is the arm a corpus-scale layer would run on.

### Guard (a changed character is never served)

- **Before any repair**, strip the arm's marks and whitespace and compare to the input code point for code point. Report the rate of pages changed, with a Wilson CI.
- **Policy R (reject).** A changed page gets no breaks.
- **Policy K (keep insertions).** Align the output to the input by LCS. Carry a mark only where the character before it and the character after it are both matched and adjacent on both sides. The served string is always the INPUT with marks inserted.
- Both are reported. **Primary scoring uses K**, because that is what a layer would serve.

### Metrics

- **Break level (any mark vs none).** P, R and F1, micro-pooled over pages (sum TP/FP/FN), on all 64 pages. Also by style (modern / 。-only) and for the 12 Siku pages separately.
- **Sentence-final (。？！ vs the rest).** P, R and F1 on the **39 modern-style pages** only (primary). Pooled over all 64 pages as a secondary measure, labelled as measuring style on the 。-only pages.
- **Secondary.** The same measures under policy R, and for the raw output on guard-clean pages only.
- **Intervals.** Book-cluster bootstrap, 2,000 resamples, seed 8140. With one page per book this is the page bootstrap. Paired G − O ΔF1 uses the same resamples.
- **Noise floor.** F1 of G2 scored against G (agreement), plus |F1(G2) − F1(G)| against the key on the 30 pages.
- **Cost.** Calls, retries and wall seconds per page per arm. A projection to ~2M pages in calls and quota, from the measured quota fraction used.

### Better arm

The better arm is the one with the higher sentence-final F1 (K, modern-style pages). If the paired Δ CI includes 0, choose the cheaper arm per page (G), and say so.

## Frame B: Siku Quanshu, non-Buddhist (does the result carry over?)

- **Frame.** Siku Quanshu volumes as imported (`!contributing_library && /\(vol \d+\)/` title, `benchmark-seal.mjs isSkqs`), Chinese, `visible && pages_count > 0`. Non-Buddhist: neither the title nor `catalog_metadata.subjects` matches `benchmark-seal.mjs BUDDHIST_RE` or 釋家.
- **Draw.** Mulberry32(81402) over those books. For each book in turn, a seeded page with `ocr.source = 'paddle'`, at least 100 Han characters in the body, not a table page (no `<table`, `|` or `<td`), and `page_number > 1`. Thirty books, one page each.
- **Input.** Paddle's `ocr.data` with markup tags and `<header>`/`<language>`/`<script>`/`<page-num>`-type lines removed (`stripMarkupTags` when available), then the same strip as frame A. Paddle may interleave double-line small notes with the main text, and it may misread characters. **Some breaks may therefore be caused by OCR errors, not by the arm.** The judge is told to rate the break against the text as given and to note OCR-caused breaks separately.
- **Arm.** The better arm only, same prompt, policy K.
- **Judge.** Blind Opus (`claude -p --model opus`), one page per call, with the page image (Read tool on that file only). It sees the punctuated text with each break numbered, and rates every break as **fine**, **debatable** or **harmful** (changes the sense). It also answers whether the text matches the image.
- **Controls, mixed in blind.**
  - 6 **shuffled-break** pages: a real page's arm breaks moved to random positions, same count.
  - 4 **wrong-page** pages: one page's punctuated text shown with another frame-B page's image.
  - The judge passes if it flags at least one harmful break on at least 5 of 6 shuffled pages, and says "does not match" on at least 3 of 4 wrong-page pages. If it fails, the frame-B verdict is reported as unjudged.
- **By eye.** I open at least 5 flagged pages myself (image plus text). Only those are labelled "by eye".

## Decision rule (from #8140, unchanged)

**Build a reader layer** if the better arm has all three:
1. no character changes after the guard (true by construction under K and R; the pre-guard rate is reported regardless);
2. sentence-break F1 of at least 0.85 on CBETA (point estimate; here, K, modern-style pages, with its CI reported);
3. harmful breaks (changing the sense) on at most 3 of 30 Siku pages (pages with at least one harmful break).

Otherwise do not build it, and record why.

## Stop rules

- Subscription only. If a pool nears its limit, stop and report; never probe past a limit. $0 API.
- No writes to `pages` or `books`. No UI, no new field.

## What this cannot establish

- CBETA's punctuation is one editor's choice among several valid ones. F1 against it is a lower bound on quality.
- The CBETA pages are Chan Buddhist text. Frame B is the only check on non-Buddhist text, and it is judged, not keyed.
