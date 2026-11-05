---
stage: ocr
measure: [judged, judged_vs_reference]
languages: [sa, zh]
scripts: [Deva, Hant]
canons: []
n_books: 60
n_pages: 60
verdict: "Most of the judge's serious calls are real. A fresh Opus reader, shown a crop and the page but not the first severity, found that 85-96% of the route judge's misleads/wrong_text spans differ from the print AND change what the sentence says: wrong_text 100%, misleads 79-93%. When it overruled a call, it nearly always said the span differs from the print but keeps the sense; it said 'the page prints this' on only 2 of 536. Sense errors per 1,000 words, after the second reader: Sanskrit stored 28.8 [21.6-36.1], fresh agy Flash-low 13.4 [9.2-18.1]; Chinese (per 1,000 Han characters) stored 17.8 [13.7-22.8], fresh 14.2 [9.8-19.5]. The repeat sitting agrees on whether a page has a serious error on 108/114 pages, but in Sanskrit it splits misleads vs wrong_text differently on about a third of pages (kappa 0.37 stored, 0.54 fresh). On #7243's printed Devanagari pages, agy's median CER of 1.7% against the model reference sits beside 11.7 judged serious errors per 1,000 words. Both are true: one character in ~60 is wrong, and about one wrong word in seven changes the sense. n = 30 books a language is a calibration, not a route decision."
status: informational
decision: "Count the router's agy Flash-low 'misleading' rows on Sanskrit print and Chinese true print as real errors (the spans are upheld), but do not read page-level misleading shares as a quality scale. A ~140-word Sanskrit page with ~1.9 expected sense errors fails at almost any engine quality. Quote sense errors per 1,000 words, and trust page-level 'has a serious error' (stable on repeat) over the misleads/wrong_text split (unstable in Sanskrit). The 30 pages where the fresh read beats the stored one, and the 2 stored loops, are listed for a lane to apply; nothing was written."
feeds: judge
superseded_by: null
issue: [7263, 6740, 7991, 7568, 7243]
router_evidence: "none — the 60 pages were judged outside the router's lane_judge_verdicts (the brief forbids test rows there), so no route k/n is added; the result calibrates the severity labels those cells rest on"
defect_rates: "scripts/eval/severity-cal-7263/results/results.json"
---
## 2026-11-04 · Severity calibration: how much of "misleading" is a real sense error? (#7263)

Pre-registered in `2026-11-04-severity-calibration-prereg-7263.md` (+ Amendment 1) before any judging. Code
`scripts/eval/severity-cal-7263/`, every number in `results/results.json`. 464 Opus calls of the 500 cap. No writes
to pages, books, rules.json, current.json or lane_judge_verdicts.

PRIOR ART: the pre-registration lists it. `scripts/eval/route-judge-6740/judge.mjs` (route judge, unchanged),
`scripts/eval/flash-reread-5924/T-TASK.md` (Step T, verbatim), `scripts/eval/sa-gr-served-7991/` (rate, bootstrap,
error kinds), `scripts/eval/sanskrit-gex45-7243/` (references, CER).

**Who reads this.** Derek, and whoever sets the floor for "agy is unacceptable here". **The decision it changes:**
whether the router rows calling agy Flash-low bad at Sanskrit (125/250 misleading) and Chinese print (37/71, 3 books)
count as agy failures, and which severity label can be trusted.

### Frame and draw (seed 72630, uniform over books, one body page each)
- **Sanskrit printed Devanagari:** 511 live books; 87 handwritten excluded → frame 424 books (121,576 pages); 13 books
  skipped for having no eligible body page (listed in results.json). 30 books drawn.
- **Chinese true print:** 204 books with owed pages from `frame.mjs` (#8067's branch, Siku excluded). 30 books drawn.
- **Fresh agy gemini-3.8-flash-low reads (1 page a call, kept):** Sanskrit 27/30 ok, 2 filter cuts (reply cut
  before its end marker), 1 CLI exit. Chinese 27/30 ok, 1 CLI exit (timeout, 78K chars, likely a loop), 1 not read
  (unsplit spread), 1 filter cut. These are failed reads, reported apart and not counted as misreads.
- **Stored reads:** Sanskrit 30/30 served; Chinese 28 ok + **2 stored loops served to readers**
  (`6992f3d9dc69844b023ff452` p323, 13,116 words; `69ea51f3e0662c881fb5c7a8` p21, 6,327 words; both 3.1 Flash Lite
  preview). They were judged as served. They were not contained, because this brief forbids writes; they are listed
  for containment.

### The table (route judge sitting 1; second reader blind to severity)
Sense error = a misleads or wrong_text span. "After" = upheld by the second reader: the span differs from the print
AND changes what the sentence says. Intervals: book-cluster bootstrap (rates), Wilson (shares). Chinese is per 1,000
Han characters.

| Language / text | pages | accepted | per 1k before | per 1k after 2nd reader | one sense error every | serious calls upheld |
|---|---|---|---|---|---|---|
| Sanskrit, stored as served | 30 | 7 (23%) | 32.4 [24.5–41.0] | 28.8 [21.6–36.1] | 35 words (≈4 a page) | 121/136 = 89% [83–93] |
| Sanskrit, fresh agy | 27 | 11 (41%) | 15.8 [10.3–21.3] | 13.4 [9.2–18.1] | 75 words (≈2 a page) | 51/60 = 85% [74–92] |
| Chinese, stored as served | 30 | 4 (13%) | 18.4 [14.3–23.4] | 17.8 [13.7–22.8] | 56 characters (≈6 a page) | 186/193 = 96% [93–98] |
| Chinese, fresh agy | 27 | 5 (19%) | 14.8 [10.7–20.1] | 14.2 [9.8–19.5] | 71 characters (≈5 a page) | 141/147 = 96% [91–98] |

**By first severity.** wrong_text upheld 27/27, 18/18, 93/93, 65/65. misleads upheld 94/109 (86%), 33/42 (79%),
93/100 (93%), 76/82 (93%). Of the 37 calls not upheld, 32 were "different but the same sense", 2 "not different" and
3 "cannot tell". The judge does not invent differences. Its excess is calling a real but harmless Sanskrit
variant "misleads" (e.g. a dropped initial ए in एतस्मिन्, व्यापार for व्यापारण).

**Against #7991**, which cut Sanskrit from 26.7 to 11.3 with a second reader: a second reader who is *not* shown the
first severity cuts far less here (32.4 → 28.8). One likely reason is that #7991's reader saw the first severity and
re-graded it. That is not tested here.

### Test-retest (route judge, fresh sitting, same packets)
| | accept agrees | κ | worst severity agrees | κ | "has a serious error" agrees |
|---|---|---|---|---|---|
| Sanskrit stored | 26/30 | 0.66 | 19/30 | 0.37 | 28/30 |
| Sanskrit fresh | 25/27 | 0.85 | 19/27 | 0.54 | 24/27 |
| Chinese stored | 29/30 | 0.87 | 28/30 | 0.83 | 30/30 |
| Chinese fresh | 25/27 | 0.71 | 24/27 | 0.78 | 26/27 |

In Sanskrit, 9/30 stored pages swap misleads ↔ wrong_text between sittings. Whether a page has a serious error at all
is stable; which of the two serious labels it gets is not. This reproduces #6740's 17/40.

### Step T vs route judge (pages; no forced mapping)
| Step T → route (s1) | Sanskrit | Chinese |
|---|---|---|
| misleading (28 sa / 42 zh) | reject 26 (21 wrong_text, 5 misleads), accept 2 | reject 40 (35 wt, 5 ml), accept 2 |
| flawed (29 / 10) | accept 16 (9 cosmetic, 6 misleads, 1 none), reject 13 (7 ml, 6 wt) | reject 8, accept 2 |
| sound (0 / 5) | — | accept 5 (3 none, 2 cosmetic) |

**What does not map.** Step T "flawed" covers both sides of the route judge's accept line in Sanskrit: 13/29 flawed
pages are route rejects, and 6 of those carry a wrong_text call. Step T never said "sound" on a Sanskrit page (0/57),
while the route judge accepted 18. The route judge also accepts some pages that carry a misleads call (7 Sanskrit).
Against the second reader: Step T "misleading" pages had an upheld serious span 27/28 (sa) and 41/42 (zh); its
"flawed" pages had one 19/29 (sa) and 8/10 (zh). In Sanskrit, Step T "flawed" therefore does not mean "no sense
error".

### Misses on accepted pages (fresh reader on pages the route judge accepted with no serious call)
Sanskrit 2/10 pages [6–51%], 4 errors, 2.9 per 1k (e.g. फालफलकात् where the page prints फालफल्यात्;
सामान्य for साम-आदि, "sāma and the other means"). Chinese 1/8 [2–47%], 1 error, 0.9 per 1k (樗 for 梣, beside 秦皮). The judge's
misses are small next to its calls.

### Controls
Wrong-page controls (another book's text on this image): the route judge rejected 8/8 at fidelity 1 in both sittings.
Step T called 66/66 misleading + not_this_leaf (30 wrong-page texts a language + 3 stand-ins for failed fresh reads).

### References
- **Chinese: effectively none.** Kanripo aligned 1/30 pages (29 have no Kanripo work). No translation test, as
  the brief directs: it is noise on Classical Chinese (#7263).
- **Sanskrit: no typed reference exists in the frame.** The reference arm uses #7243's 20 printed-Devanagari pages and
  their Opus *model* references, which are not human-typed. That makes the REF row a judge floor, not a human
  baseline. agy fresh on those pages: median CER 1.7% vs the reference, 6/20 accepted, 46 serious calls = 11.7 per 1k
  words, and 44/46 serious spans are absent from the reference (the reference agrees the text differs there). The
  reference text itself, judged the same way: 18/19 accepted, 1.6 per 1k (the judge's floor on near-clean text). One
  page (`sa-8eaa58d0-p117`) had CER 1.0, a whole-page mismatch. `meaning.mjs` was not run: there is no typed Sanskrit
  reference, so its A-vs-A floor cannot be set.
- **"Is it really a big deal?"** A 1.7% CER and ~12 serious errors per 1,000 words are the same pages. At ~6–7
  characters a Devanagari word, 1.7% is roughly one wrong character every 9–10 words. About one in seven of those
  changes the sense: a number, a name, an instrument, "fire" lost from a list of injuries.

### Error kinds (serious calls upheld / called, sitting 1)
| | misread word | numerals / citations | dropped line or phrase | margin mishandled | invented text | other |
|---|---|---|---|---|---|---|
| Sanskrit stored | 78/82 | 28/33 | 12/16 | 3/4 | — | normalised 0/1 |
| Sanskrit fresh | 24/29 | 18/21 | 4/4 | 2/3 | 2/2 | normalised 1/1 |
| Chinese stored | 103/104 | 22/22 | 31/31 | 26/31 | 3/3 | facing page 0/1, normalised 1/1 |
| Chinese fresh | 77/77 | 17/18 | 17/17 | 20/23 | 5/5 | invented margin 2/2, wrong leaf 1/1, normalised 2/4 |

"Numerals / citations" includes running heads and folio numbers. In both languages a real share of serious calls fall
in page furniture rather than body text (e.g. [१अ०। read as page "18.0"; folio १९ read as ९३ and १२).

### Opened examples (each opened by the second reader with the page and a crop; one checked by eye here)
- **wrong_text, upheld.** sa stored 69e72c8c… p384: चातिष्ठच्चूर्णिरक्ते क्षवलपि where the page prints चातिष्ठत्तूष्णीं
  रक्ते स्रवत्यपि ("stayed silent though blood flowed"). sa stored 69af0be8… p184: पञ्चसप्तमिर्यतम् for
  पञ्चसप्ततिभिर्युतम्, which loses the problem's number 75. sa stored 6a91e0b1… p23: प्रहाराभिक्षार for
  प्रहाराग्निक्षार, which drops "fire" (the Hindi gloss confirms). zh stored 69e787e6… p4: label 栴檀 where the boxed label prints 莢蒾
  (checked by eye here). zh stored 6992cc36… p1: 鄙校其首越能無疑感者其慈則大長之興 for 鄙投其旨趣能無疑惑者哉然則大教之興.
- **misleads, upheld.** sa stored 69ef2513… p527: उद्यतान् ("raised") for उत्पातान् ("omens"). sa stored
  69906d23… p22: folios ९३, १२ where both margins print १९. zh stored 69e787e6… p4: 棟 (ridgepole) for 楝
  (Chinaberry). zh stored 6992cc36… p1: 痴抱 for 寂挹. zh stored 69b99f78… p72: 願 for 福.
- **misleads, not upheld (different, same sense).** sa: तस्मिन्नन्तरे for एतस्मिन्नन्तरे; व्यापारं for व्यापारणं;
  verse number ५२ for ५२½. zh fresh 6992ca1b… p6: two columns of main text tagged `<margin>` (markup only, words
  right). zh fresh 69b99f78… p72: 三藐三菩提 normalised from the page's 三耶三菩意.
- **cosmetic (as called; not second-read).** sa: नियमस्तथा for नियमास्तथा; मुनिभिदैवतैः (repha dropped). zh:
  固 for 因 (固慈悲教主). That last one is a character error the judge chose to call cosmetic, which shows the line
  is soft.

### Pages where the fresh read beats the stored one (for a lane to apply later; nothing written)
30 pages (20 Sanskrit, 10 Chinese) with fewer upheld serious spans in the fresh read than the stored one. Eight of them
are accepted fresh but rejected stored. The list, with page ids and stored models, is `fresh_beats_stored` in
results.json. Add the 2 stored loops above.

### What this does and does not say
- n = 30 books a language is a calibration of the labels, not a route decision.
- Stored and fresh differ in more than the engine: stored reads come from older models, mostly 3 Flash preview and 3.1
  Flash Lite. The Sanskrit intervals do not overlap, so on these pages agy Flash-low is about half the stored error
  rate. The Chinese intervals overlap.
- The router's "misleading" share is a page-level threshold. With 2–6 expected sense errors a page, most pages fail
  at any plausible engine quality, so the share says little about how far apart two engines are. Use the
  per-1,000 rate.
