---
stage: translation
measure: judged
languages: [la, de, fr, it, zh, bo, he, ar]
scripts: [Latn, Grek, Hani, Tibt, Hebr, Arab]
canons: []
n_books: 49
n_pages: 67
verdict: "OCR cannot flag its own doubt: told to mark unsure spans, agy Flash marked 2 of the 29 errors that carry into the English (7%, 2–22%), and 4 of the 69 known-error spots where its own read was wrong. It marked a third of pages with no confirmed error, and 55% of its marks sat on correct text. Seeing the page at translation does help: the image arm carried 12 of those 29 errors against 21 for text only. It repaired 9 of the 21 the text arm carried (43%, 24–63%; a text-only rerun repaired 3) and 6 of 7 planted misreads, with no measurable rise in translator errors or false claims about the leaf, at +58% tokens a page."
status: rejected
decision: "Flag-gated image translation is rejected: the flags miss the errors that carry. Image-at-translation missed the pre-registered bar of half the carried errors on real errors (43%) and passed it only with the planted ones (54%). Proposed next step on #8358: a router-cell test of image translation on Latin/German/French Gemini reads, where 6 of its 9 repairs fell, on a random draw. No prompt or lane changed."
feeds: [route]
supersedes: []
superseded_by: null
issue: [8358, 7611]
router_evidence: "none — error-enriched pages (the #7611 set), not a route draw; the image arm is not a router cell yet"
defect_rates: "none — scored as carried/repaired on known spots and translator-side errors per page on error-enriched pages; defect-rate.py rates per 1,000 words need a random draw"
---
## 2026-11-07 · Can OCR flag its own doubt, and does seeing the page image fix the errors the English carries? (#8358)

PRIOR ART:
- `2026-11-02-ocr-error-to-translation-7611.md`: 109 OCR errors confirmed against the image. The English repairs 71 of them and carries 29. This entry reuses those pages, spots and planted controls (`scripts/eval/ocr-error-to-translation-7611/results/2026-11-02/`).
- `2026-10-27-tibetan-leaf-translation-kangyur-6948.md`: Opus with the leaf attached made 3 false claims about the leaf in 40 pages. This entry counts false leaf claims in every arm for that reason.
- `2026-10-02-illegible-gate-5305.md`: a prompt clause did nothing there. This entry tries one doubt sentence, written once and not tuned.
- The live OCR prompt already has `<unclear>` for "illegible readings". It is scored below as the doubt signal production already has.

**Who it serves.** A reader who trusts a fluent English sentence built on a misread word. The idea under test: if OCR could flag where it is unsure, only the flagged pages would need the more expensive image-at-translation pass.

**Pre-registered** on #8358 before any call (`results/2026-11-07/preregistration.md`):
- Flags are a gate only if they mark ≥ 70% of the carried errors and appear on fewer than 30% of pages with no confirmed error.
- Image translation passes only if it repairs ≥ half of the errors the text arm carries, without more pages carrying new errors or false leaf claims.
- n: 29 carried errors on 18 pages can tell "most" from "few", but not 60% from 80%, and no stratum comparison holds up. The harm side sees only large harm.

### Test 1: doubt flags

**Design.** 55 pages: the 37 holding the 109 errors, plus 18 pages from the carried books with no confirmed error. Three arms on agy `gemini-3.8-flash-low`, sent the way `cli-ocr.mjs read` sends it (the live prompt, the read_file agent and the tool gate), with no R2 or lane write:
- **L**, the live prompt.
- **L2**, the live prompt again, as a noise floor.
- **D**, the live prompt plus one sentence (`doubt-instruction.txt`) asking for `⟦…⟧` around uncertain words, outside the tag syntax.

A blind Opus judge (sealed `claude -p --restricted --tools Read --strict-mcp-config`; it opened the image on each call) received each read with its marks stripped, so L and D looked the same. For each known error it was given the image reading and the old misreading. It quoted what this read says at that spot and said whether it matches the page. The quote was then found in the read (109/109 found) and checked against the mark positions. The judge also checked a list of spans, unlabelled: every mark (up to 15 a page), as many random unmarked words, and one random word with a planted one-character misread.

| | n | D marks the spot | D's read wrong there | D wrong **and** marked | L's `<unclear>` on the spot |
|---|---:|---|---|---|---|
| **#7611 carried** | 29 | **2 (7%, 2–22%)** | 19 (66%) | **2 of 19** | 3 (10%) |
| repaired/dropped/other | 80 | 3 (4%) | 50 (62%) | 2 of 50 | 0 |
| Tibetan GPU | 58 | 0 | 47 (81%) | 0 of 47 | 0 |
| Latin/German/French Gemini | 24 | 2 (8%) | 7 (29%) | 2 of 7 | 1 |
| **all** | 109 | **5 (5%, 2–10%)** | 69 (63%) | **4 of 69 (6%, 2–14%)** | 3 (3%) |

- **Mark rate.** D marks 1.7 times per 1,000 characters on error pages and 0.4 on the others. 33 of 55 pages carry no mark and one page carries 66. **Pages with at least one mark: 16/37 (43%) with errors, 6/18 (33%, 16–56%) with none.** As a gate, the flag barely separates the two groups.
- **Precision.** 55% of the checked marks (41/75) sit on text the judge says matches the page. On random unmarked words the figure is 75% (147/195). A mark makes an error about twice as likely, but most errors carry no mark: at the 69 known-error spots D read wrong, it marked 4.
- **Harm.** At the 109 spots, L read right 47 times and D 40 times (paired: 10 only L, 3 only D, exact p 0.09). Whole-page distance from L is the same for D and for L2 (median 0.052 vs 0.051). The doubt sentence did not cut a reply short (D 0, L 3, L2 2 before the re-read). No harm is shown, but D may be slightly worse at the hard spots.
- **Same misread.** Flash reproduced the #7611 misreading at only 4 of the 109 spots (L) and 2 (D). On the GPU strata Flash is a different reader, and it misreads these spots in its own way: 81% are wrong on Tibetan. The self-doubt recall that matters is therefore "D wrong and marked": 4 of 69.
- **Controls.** The judge caught 89 of the 90 planted misreads; the miss was a Latin "figures → figudes". On 4 wrong-page packets it matched 0 of 11 spots and 0 of 27 spans. 5 repeats agreed on every spot and span.

**Verdict: not a gate.** Recall on carried errors is 7% against a bar of 70%, and a third of clean pages carry a mark. Fluent misreads, the kind that carry, are exactly the ones the model is sure of. The live `<unclear>` tag does no better (3/109).

### Test 2: the page image at translation

**Design.** 48 pages in 30 books. Each comes from the transcription that carries the error, so this reproduces the misread the reader got:
- the 18 pages with the 29 carried errors (all 37 confirmed errors on those pages are scored), from the text the live English was made from, or the judged text for flash-fill pages;
- 18 pages from the same books with no confirmed error, from the stored OCR;
- 12 of the #7611 planted-misread controls.

Arms on agy Flash-low with the live translate prompt (`translate.mjs`, the `xlate.mjs` call):
- **text**, as `cli-translate.mjs`.
- **image**: the scan as `./page.jpg` in the workspace, opened by the model's own read_file turn (48/48 opened), plus one sentence: the transcription may hold misreads; where the scan clearly differs, translate the scan.
- **text2**: the text arm again, as a noise floor.

A blind Opus judge with the image (ids hashed, one output per call) classed each known spot `carried`/`repaired`/`dropped`. It listed every other English error, sourced to the transcription or the translation, and every statement about what the leaf shows, true or false.

| spots | text | image | text again |
|---|---|---|---|
| the 29 #7611 carried, carried | 21 (72%, 54–85%) | **12 (41%, 26–59%)** | 23 (79%) |
| the 29, repaired | 4 (14%) | **16 (55%, 38–72%)** | 5 (17%) |
| 12 planted misreads, carried | 7 | **1** | 9 |

- **Paired.** Of the 21 confirmed errors the text arm carries, the image arm repairs **9 (43%, 24–63%)**. The text arm run again repairs 3 (14%), which is the noise floor. With the planted misreads added, the image arm repairs 15 of 28 (54%, 36–70%) against 3 of 28. It never carried a spot that the text arm repaired (0/14; the rerun did so 5 times).
- **Where it works.** Latin/German/French Gemini reads: 6 of 11 repaired. Tibetan: 3 of 4. Planted Latin, German, French and Chinese: 6 of 7. Real Chinese GPU (0/2), Hebrew (0/1), Arabic (0/1) and Latin GPU>GEM (0/2): none repaired.
- **Harm.**

  | arm | pages with a translator-side error (misleads or wrong text) | pages with a false leaf claim |
  |---|---|---|
  | text | 14/48 | 12/48 |
  | image | 13/48 | 10/48 |
  | text again | 12/48 | 10/48 |

  Paired against the text arm, the image arm has more such errors on 8 pages and fewer on 9; text2 has more on 7 and fewer on 10.
- **What the false leaf claims look like.** Most are in every arm: a note quoting the misread as "original: …" (臣明鼎 for 臣明昂; garbled Greek), or a wrong picture description. The image arm adds one claim of the #6948 kind: "'poca me', printing error for 'voca me'". The scan prints *voca*, so the model blamed the printer for an OCR misread. It also describes pictures more often (59 true claims against 47), and so gets more of them wrong (a logo, a diagram).
- **Cost.** All tokens per page (input + cache_read + output + thinking; agy 1.5.3 leaves cache_read out of `input`): text 11,907, image 18,833 (**+58%**), text again 11,967. Input alone: 11,108 against 17,975.
- **Controls.** 8/8 planted wrong numbers in the English caught; 4/4 wrong-page packets caught (`page_matches: false`); 5 repeats agreed on every spot. The judge-pass list-equivalent cost for both tests was $22.32 (262 calls, subscription).

**Verdict.** On real errors the image arm misses the pre-registered bar: it repairs 43% of what the text arm carries, against a bar of 50%. The interval runs from 24% to 63%. It clears the bar with the planted misreads (54%). No harm is seen, but 48 pages can only show large harm.

### What this means for #8358

- **Flag-gated image translation: no.** The flags do not find the errors that carry, so a gate on them would send the image to pages that do not need it and skip the ones that do.
- **Image everywhere: not on this evidence.** It is the only one of the two ideas that works. It cuts carried errors from 72% to 41% on the carried set and costs 58% more tokens. But these pages were chosen for carried errors. On a random page, where #7611's 27% carry rate applies to the few errors a page has, the gain per page is much smaller.
- **Next:** a router-cell test of image translation (paired-arm-judge, random draw, wrong-page and planted controls) on **Latin/German/French Gemini reads**, where errors carry most (54% in #7611) and where 6 of the 9 real repairs fell. It should also guard the "printing error" kind of leaf note. Tibetan's 3 of 4 is too small to act on.

### Caveats

- The test-1 judge is told the confirmed page reading at each spot and quotes the read there. Mark positions come from string search, not the judge. It is blind to the arm, because the marks are stripped.
- Random spans reach 72–75% "matches the page" on Flash reads, so a quarter of random words differ from the page by the judge's conventions. Precision is only relative: marks against random words.
- Test 2's 29 carried errors come from #7611, made by older translators. The fresh text arm carries 21 of them, and the paired comparison is against that arm, not against #7611.
- One read and one translation per arm per page. The noise floors (L2, text2) bound how far a single draw can move.

### Files

`scripts/eval/ocr-doubt-image-8358/`:
- `fetch.mjs`: read-only page and image pull.
- `ocr-read.mjs`: the live agy OCR call with no writes.
- `doubt-instruction.txt`
- `translate.mjs`: text and image arms.
- `t1_packets.py`, `t2_packets.py`: judge packets, plants, controls.
- `judge.py`: sealed `claude -p`.
- `t1-judge-prompt.md`, `t2-judge-prompt.md`
- `score_t1.py`, `score_t2.py`

Results are in `results/2026-11-07/`:
- `preregistration.md`, `design.json`
- `score-t1.md`, `score-t2.md`
- `t1-reads`, `t1-judge-key`, `t1-judge-raw`, `t1-spot-rows`
- `t2-tasks`, `t2-outputs`, `t2-judge-key`, `t2-judge-raw`, `t2-spot-rows` (all `.jsonl.gz`)
