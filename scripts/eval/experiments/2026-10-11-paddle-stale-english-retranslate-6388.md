---
stage: translation
measure: judged
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 85
n_pages: 85
verdict: "Half or more of the stale English pages on the Paddle-read Siku Quanshu volumes carry a material error that the old OCR caused: 30 of the 44 resolved random books (68%, 95% CI 53–80%), and at least 30 of all 60 (50%) even if the 16 unresolved books are all clean. The two reviewers caught 5/5 planted errors each. The pre-registered rule (≥ 15%) says retranslate every stale page (75,701). Separately, 30% of the resolved random pages also carry a material error that a correct reading would not have prevented."
status: undecided
decision: null
superseded_by: null
issue: [6388, 5600, 5660]
---
## 2026-10-11 · Should the stale English on the Paddle-read Siku books be retranslated? (#6388)

PRIOR ART: `2026-10-10-paddle-zh-random-qa-6388.md` (qa3, PR #6443) judged the Paddle TEXT against the image and
answered "how good is the new reading". This entry asks a different question: how often is the ENGLISH that readers
still see wrong because the old reading was wrong, and would a translation from Paddle's text fix it. Data, code,
the draw and the pre-registration are in `scripts/eval/paddle-stale-english-6388/`. The README was committed in
`2a3c797a2` and posted to #6388 before any reviewer ran. Every number below comes from `results.md` /
`results.json` (`score.mjs`, `attribution-check.mjs`).

**Frame (census, $0).** 75,701 pages in 751 books carry `translation_stale.lane = paddle-zh-2026-10`. All still
show English, and all have the lane's `page_revisions` snapshot of the reading it replaced. The replaced readings
were mostly gemini-3-flash-preview (59.2K pages) and 3.1-flash-lite (15.9K). The English came from
gemini-3-flash-preview (42.9K) and 3.1-flash-lite(-preview) (32.6K).
- 22 table/diagram pages and 28 near-empty pages were left out of the draw. That leaves 75,651 eligible pages.
- **Old-vs-new CER** is the Levenshtein distance between the old and new readings over their Han characters (body
  only), divided by the length of the Paddle reading.
- Its deciles: p10 .012, p30 .031, p50 .056, p70 .112, p80 .196, p90 .693.

**Sample.** One page per book. 60 books drawn at random (seed 6388), plus 20 books with a page in the top decile
(CER ≥ .693, seed 6389). Five more pages from other books carried a hidden error planted in the English (2 names,
2 numbers, 1 negation). All 85 went to the reviewers under opaque, shuffled ids.

**Reviewers ($0, subscriptions).**
- Opus, via `claude -p`: 5 pages per call, 17 calls.
- Gemini 3.1 Pro High, via `agy -p`: one page per call. 98 calls in all: 85 first attempts plus 13 for the 12 pages
  where the model asked for a tool.

Each reviewer saw, for every page, the image, the old reading, the Paddle reading and the English. For each meaning
error it gave a cause (OCR / TRANSLATION / BOTH) and a severity (minor / material), then a page verdict.

Where the two disagreed on the verdict or on the OCR-material flag (38 of 80 pages), one Opus single-page call at
high effort re-read the page with both lists shown blind. **The 30-call Opus cap allowed 13 of those calls**, all on
random-arm pages. That leaves 16 random pages unresolved; they are reported as bounds below.

### Result

- **Controls**: both reviewers passed the gate. Opus caught 5/5 planted errors and Gemini 5/5, all marked material.
- **Headline** (random books whose page has a material OCR- or BOTH-caused English error): **30/44 resolved = 68%
  (Wilson 53–80%)**.
  - The 16 unresolved pages bound it at **50%–77% of all 60**.
  - Opus alone: 30/60 = 50%. Gemini alone: 48/60 = 80%.
  - Of the 16 unresolved pages, Gemini flags 13 and Opus 1.
- **Attribution check** ($0, `attribution-check.mjs`): the 30 OCR-material pages carry 59 OCR/BOTH material errors.
  For 58 of them the reviewer quoted the Chinese.
  - 41 of the 58 quotes occur in the Paddle reading and NOT in the old one, which is what an OCR cause predicts.
  - 0 occur in the old reading only. The other 16 quotes match neither verbatim (variant forms, a quote spanning a gap).
  - 24 of the 30 pages have at least one error confirmed this way. Even that strict count, 24/60 = 40%, is far
    above the 15% line.
- **TRANSLATION-caused material errors** (random, resolved): 13/44 = 30% (18–44%). A retranslation fixes these
  only if the new translator does better than the old one.
- **Any material error** (random, resolved): 36/44 = 82%. Verdicts: retranslate-would-fix 26, bad-regardless 10,
  keep 8.

| old-vs-new CER | eligible pages | sampled (random) | OCR-material | TRANSLATION-material | would-fix verdict |
|---|---|---|---|---|---|
| 0–0.05 | 34,728 | 25 (25) | 7/15 = 47% (25–70%) | 6/15 = 40% | 6/15 = 40% |
| 0.05–0.1 | 15,961 | 15 (15) | 10/12 = 83% (55–95%) | 5/12 = 42% | 10/12 = 83% |
| 0.1–0.2 | 9,940 | 6 (6) | 6/6 = 100% (61–100%) | 1/6 = 17% | 5/6 = 83% |
| 0.2–0.5 | 5,596 | 7 (7) | 3/5 = 60% (23–88%) | 1/5 = 20% | 3/5 = 60% |
| 0.5–1 | 9,426 | 27 (7) | 13/17 = 77% (53–90%) | 2/17 = 12% | 9/17 = 53% |

The rate does not climb with CER from a low floor. Even pages whose old reading differs from Paddle's by under 5% of
characters show a material OCR-caused error in about half the cases. On a classical-Chinese page, one wrong character
is often a number, a direction, a place or a negation. Examples, each confirmed in the texts:
- 府城西九十里 ("90 li west") had been read 西北 and was translated "northwest" (武備志, CER .007).
- 非道失人 ("it is not the Way that loses people") was translated "the Way loses the person" (養生類纂, CER .045).
- 二百五十餘字 (250 characters) became "one hundred and fifty" (五百石洞天揮塵, CER .031).
- 四兩 (four taels) became "four parts" (泰定養生主論).
- 巴拉乖河 (the Paraguay River) became "the Paraná River" (海國圖志).

So a CER cut-off would leave about half of the bad pages behind.

### Recommendation (pre-registered rule)

The headline is ≥ 15% at every bound: resolved, worst-case and strict. The rule therefore says **retranslate every
stale page: 75,701 pages in 751 books**. The between-rule's bin threshold is not needed, and the table above shows it
would not help.

Because 30% of pages also carry translation-caused material errors, the retranslation should use the current
translator, not the one that wrote this English (mostly gemini-3-flash-preview and 3.1-flash-lite).

**Cost of each option** in Gemini CLI calls, one page per call. On this box `agy` has sustained ≈ 900 calls/hour on
flash-low (from `/root/agy-quota/summary.txt`, 2026-10-09 06Z–2026-10-11 01Z, with the first 429 at ≈ 1,230 in an
hour). The hours below are that whole quota, shared with every other job.

| option | pages (= calls) | ≈ hours of the box's agy quota |
|---|---|---|
| retranslate every stale page (rule) | 75,701 | 84 |
| only CER ≥ .05 (not recommended: leaves the 0–.05 bin, 47% OCR-material) | 40,923 | 45 |
| only CER ≥ .5 | 9,426 | 10 |
| none | 0 | 0 |

### Limits

- **Reviewers disagree a lot.** Verdict agreement was 42/80 and OCR-flag agreement 53/80. Gemini Pro flags more
  than Opus. The cap left 16 random pages unresolved; every bound above includes them, and none changes the
  decision.
- **Judges, not a reference.** No typed reference text was used (qa3 measured Paddle against Kanripo). The cause
  tags rest on the reviewers. The attribution check verifies them mechanically where a quote matched.
- **One page per book.** The headline is the chance that a random stale page of a random book has the error. It is
  not a page-weighted corpus rate.
- **Excluded pages.** Table/diagram pages (22) and near-empty pages (28) were not sampled.
- **Not measured: the new English.** This entry does not show that a fresh translation from Paddle avoids the
  errors. The "would-fix" verdict is the reviewers' judgment that Reading B is right at the error. A small gate on
  the actual retranslation (the #6361 Tengyur pattern) should precede a bulk apply.
