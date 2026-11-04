# Preregistration: do Chinese reference texts overstate quality? Planted edits (#8171)

Written 2026-11-04 and committed before any arm runs. The draw, the C image check (Opus, page images) and the web
search ran before this file; no arm (no translation, no punctuation call) has run. Eval only: nothing is written to
pages or books. $0 API: agy and `claude -p` on subscriptions.

## Question

Our Chinese quality numbers lean on CBETA and Kanripo texts. If a model has memorised those texts, a score against them
may partly measure recall. Plant sense-changing edits into the source text and see whether the output follows the
edit or the remembered original. A model can also undo an edit by reasoning, so only the GAP between famous,
reference-covered and obscure text points to memory.

## Sample (`sample.json`: ids, offsets, edit types, hashes; no CBETA or Kanripo text)

One passage per work, 100–260 Han characters (median 240), Han characters only (every mark, space and note bracket
removed: our served Chinese is unpunctuated, so every group gets the same shape).

- **A, positive control, 20 works** (Kanripo master text): 論語 孟子 老子 莊子·逍遙遊 詩經 大學 中庸 禮運·大同 孝經 周易
  尚書 孫子 左傳·鄭伯克段于鄢 般若心經 金剛經 法華經·普門品 阿彌陀經 六祖壇經 離騷 桃花源記. Ten start at a
  famous opening (anchor in `draw.mjs`), the rest at a seeded offset. 出師表 and 勸學 were in the first list; their
  anchors are not in Kanripo's text of 三國志 / 荀子 as fetched, so they were replaced before any planting.
- **B, reference-covered, 40 works.** B-strict (21): one page per work from the 19 CBETA works of #6101 / #8140
  (`draw-A.json` of PR #8146; the CBETA text of that page) and one 佩文韻府 page of #8134 test 2 (its Kanripo WYG leaf;
  the 駢字類編 page had no leaf). The CBETA frame has 19 works, not 40, so B-ext (20) adds Kanripo-screened Siku works:
  books with `work_id: kr:*`, a page with `ocr.qa_screen` dice >= 0.6 (the leaf rule of #5935 / #7503), its Kanripo WYG
  leaf, works in seeded order. Results are reported for B, B-strict and B-ext.
- **C, obscure, 40 works.** Non-Siku Chinese books (every Siku work has Kanripo text, so C cannot be Siku). Frame: 70
  titles with no Kanripo catalogue title match (KR-Catalog, 9,790 titles, fetched 2026-11-04), not CBETA canon, and not
  famous by the author's judgement (novels, plays everyone knows, the classics and their commentaries, 黃帝內經, 天工開物
  … were left out by title before any text was read): `C_FRAME` in `draw.mjs`. One seeded page per work (our served
  OCR: 25 Paddle, 15 Gemini), drawn in seeded order; a passage is used if
  1. **search**: one web search of a 12-character string from its middle, in quotes, found no copy (56 searched, 0
     found). The search finds a famous line (論語 學而) but missed two Kanripo-covered Siku controls (大學衍義, 少室山房筆叢),
     so it shows "not widely quoted on the indexed web", not "not digitised anywhere": several C works are on ctext;
  2. **image**: Opus read the page image and confirmed >= 2 of up to 6 candidate windows (the span ± 4 characters) as
     exactly what the page shows; a decoy (the first window WITH its edit) had to come back "no" (it did on every
     used page). Edits go only into confirmed windows, so an OCR error never sits inside an edit.
  The first 40 passing in draw order are C. Skipped: 1 title excluded (釋氏源流, CBETA membership not checked), 3 with
  < 2 confirmed windows. C's OCR elsewhere in the passage can still be wrong: a confound that would make C LESS
  recoverable by reasoning, i.e. it biases toward a larger follow rate in C. Reported as a limit.

## Edits (`lib.mjs`, seed 8171 + slug hash)

2–3 per passage (A 60, B 120, C 116 = 296), >= 10 characters apart, >= 5 from either end, types spread:
`neg_del` (不X → X), `neg_add` (X → 不X before 可 能 敢 欲 足), `neg_swap` (有 ↔ 無), `num` (二–九 → another),
`name` (a listed person, place or state → another of the same list and length, not in the passage). Fixed words
(不肖, 無量, 五行, 三界 …) are skipped. **Hand check: every one of the 296 was labelled by the author before any arm
ran** (`hand-labels.txt`): o = grammatical, plausible, no textual cue; c = grammatical but cued (a broken parallel such
as 色異空 against 空不異色, a fixed count or phrase, an anachronism); b = ungrammatical. A: o 13 / c 41 / b 6;
B: 53 / 56 / 11; C: 65 / 38 / 13. The brief asks for one in five by hand; all were read, and the one-in-five subset
(seeded, 55 edits) is reported too. **A is heavily cued** (famous texts are parallel and formulaic), so A can revert
by reasoning more easily: the clean-only analysis below is the check on that.

Baselines: 20 passages (A 4, B 8, C 8, seeded) are also sent UNEDITED. Subset: 30 (10 per group, seeded) for Opus and
the second Flash run.

## Arms and tasks (`arm.mjs`, one passage per call, no title, author or date in any prompt)

- **G**: gemini-3.8-flash-low on `agy -p`, pool `.agy-milo` (`AGY_POOL_SHARED=1`), stop if weekly < max(0.25, every
  lane's reserve) or 5-hour < 0.25. No fallback, no Gemini API. 100 edited + 20 unedited, both tasks.
- **G2**: G again on the 30-passage subset (edited), both tasks: the noise floor.
- **O**: Opus on `claude -p`, text only, the same 30, both tasks.
- **T, translate**: production's DB prompt (Standard Translation v21, content_hash 4d46775c…) through
  `buildTranslationPrompt` with the book `{ language: 'Classical Chinese' }`, no previous English, + `TRANSLATE_SUFFIX`.
- **P, repeat with punctuation**: #8140's prompt (`prompt-punct.txt`, verbatim): add marks, change no character.

Caps: agy 300 planned (cap 400); Claude 52 image checks + 60 arm + 126 judge = 238 planned (cap 300). `calls.mjs`
refuses a call past a cap. A live job (zh-retranslate-8169) has priority on the agy pools.

## Scoring

Per edit: **follow** (the output renders the edited reading), **revert** (the original), **neither**, or
**unjudged**. Follow rate = follow / (follow + revert + neither).
- **P (exact).** The output's Han characters are aligned to the input (LCS); the characters between the nearest aligned
  anchors (<= 3 characters from the edit) are compared with the edited and the original span. No judge.
- **T (judged).** A blind Opus judge (`claude -p`, text only) gets the passage with each site shown as two readings
  in seeded order, `⟦1: … | 2: …⟧` (one character of context each side), and the English (G alone; on the subset G,
  G2 and O in seeded order as T1–T3). Per translation and site: 1, 2, neither or unclear, and whether the translation
  (or a note in it) **flags** the place as odd or variant: flagging is reported apart from silent reverting.
- **Judge controls**: the 20 unedited baselines (the English follows the ORIGINAL at every site; since the judge cannot
  tell which reading was planted, this tests both directions) — gate: true reading on >= 85 % of baseline sites, the
  other reading on <= 5 %; and 6 wrong-passage controls (another passage's English) — "neither" on >= 80 % of sites.
  A judge that fails the gate is reported and T is not read for the decision.
- Intervals: book-cluster bootstrap (each passage is its own work, so the passage is the cluster), 4,000 resamples,
  percentile 95 %; differences resample the two groups independently.
- Reported: follow and revert rate per group, per task, per arm; A − C and B − C; B-strict and B-ext; by category
  (neg, num, name); the clean-only (o) rates; flag rate; unedited-baseline drift (P: characters changed at the sites);
  G2 vs G agreement.

## Decision rule (#8171, unchanged; applied to G, per task)

- Group A does not revert more than group C: the instrument cannot fire. Report that, conclude nothing about
  reference texts.
- Group A fires, and B's follow rate is at least 10 points below C's with an interval excluding 0: scores against that
  reference are upper bounds. List the conclusions that rest on them (#6101, #8146 rule 2, #8134 test 2) and say which
  would change. Do not edit them; a DECISION line on #8171 proposes the label.
- Group A fires, B − C inside the interval: keep the references in use, stating the gap this test could have detected.

Operational definitions fixed here: **A fires** when the 95 % interval of (A − C) follow rate lies entirely below 0.
**B − C inside the interval** means the interval of (B − C) includes 0 or B − C is less than 10 points below.
Task P bears on #8146 rule 2 (punctuation scored against CBETA); task T on #8134 test 2 (English on Kanripo-traced
pages); #6101 is an OCR score from images and is touched by neither task directly. The clean-only analysis is
secondary and cannot by itself trigger the second branch.

## Smallest gap this sample can detect

B (40 passages, 120 edits) vs C (40, 116), design effect 1.3 (ICC 0.15, ~3 edits per passage), 80 % power, α 0.05:
about **9 points if follow rates are near 95 %, 12.5 near 90 %, 17 near 80 %**. A − C (60 vs 116 edits): about 15
points near 90 %. Clean-only B − C (53 vs 65 edits): about 18 points near 90 %. A 10-point gap is reliably seen only
if follow rates are >= ~93 %. Raising n: works, not calls, are the limit (the CBETA frame has 19 works; more C needs
more image checks, and the Claude cap is 300), so n stays; a "keep" verdict will state the gap it could have missed.

## Licence

CBETA (CC BY-NC-SA 4.0) and Kanripo (CC BY-SA per its organisation profile; no licence in the repositories; kanripo.org
behind a challenge on 2026-11-04) text is never committed, not even in results: only ids, offsets, edit types, hashes
and scores. Group C is our own OCR of public-domain books: its edit characters are in `sample.json`.

## Not established, whatever the result

This tests text input (translate, repeat), not reading an image, so it does not settle OCR memorisation (#6101). The
obscurity of C is a title check plus a weak web search, not proof of absence from training data.
