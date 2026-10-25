---
stage: translation
measure: judged
languages: [bo, sa]
scripts: [Tibt, Deva]
canons: []
n_books: 101
n_pages: 101
verdict: "Gate failed, nothing written. A blind image-grounded Opus audit (15/15 controls caught) rates 35% of Tibetan and 38% of Sanskrit Opus pages bad, against a 5% bar. Most Tibetan bad pages come from the Yigdzin transcription (seam lines invented or duplicated, truncated lines: 18 of 28); 10 have a translator-side error, 5 of them a meaning reversal or mistranslation."
status: rejected
decision: "No write; the Opus lane over the 78.7K-page Yigdzin frame waits on an OCR fix at the leaf seams (#5320/#5771) or an image-grounded translation lane (#6948)"
superseded_by: null
issue: [6948, 5320, 7321]
---
## 2026-10-24 · Can Opus (subscription `claude -p`) translate the untranslated Tibetan and Sanskrit pages, gated by a blind image-grounded audit? (#6948)

PRIOR ART: `2026-10-18-tibetan-translator-85k-6948.md` (the 60-page blind test that made Opus the Tibetan prior,
~4.40, scored against the transcription, without an image); `scripts/eval/tib-translator-6948/frame.mjs` and
`sample.py` (frame and CANON/OTHER strata, adapted here); `tibetan-correct-6560` and `replicate-6547/run-claude-arm.py`
(the sealed Opus image judge with full-resolution tiles, reused unchanged for the audit); `claude-translate.mjs` +
`cli-translate.mjs apply` (the reader and the one writer, unchanged). Harness: `scripts/eval/opus-tib-sa-6948/`.

**Who it was for.** Readers of the ~1,400 public Tibetan books that are below 90% English, and of the public
Sanskrit books. The bar was set by readers: a page is written only if a reader can rely on it.

### Pre-registration
The gate was posted on #6948 before any audit reply was read
([comment](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6948#issuecomment-6381480320)):
1. bad ≤ 5% of audited pages, in each language (the auditor's verdict taken as given);
2. 0 invented passages and 0 wrong-leaf pages confirmed by eye;
3. the auditor finds ≥ 12 of 15 planted controls;
4. per call: 10/call only if not worse than 1/call by more than 1 page in 40.

### Frame (`frame.mjs`, 2026-10-24, read-only)
| | live books | books with frame pages | frame pages |
|---|---|---|---|
| Tibetan: Yigdzin transcription, no English | 1,699 | 1,407 | **78,693** |
| Sanskrit: OCR text, no English | 509 | 28 | **911** |

Excluded from the Tibetan frame:
- pages withheld for source_loop (10,691), ocr_unreadable (6,298) or invented_by_eye (2);
- pages flagged `ocr.unreadable` (675);
- a transcription that is not Yigdzin (10,126 pages);
- books held by other lanes (Tengyur 37, Kangyur 15, title-leaf 3, scans-only 3, qa-enrich 2).

The "~7K" Sanskrit queue is mostly pages with no OCR text (9,239) or books held under `scans-only-publish-7270` (175). Five books catalogued "Sanskrit" are English translations (OCR 0% Indic script) and were excluded. 755 of the 911 Sanskrit pages are one book (Rig-Veda-Sanhita vol. 1).

The Tibetan frame is scattered: 21% of its pages have no frame page on either side, so most calls in a full run would be 1–3 pages whatever `--per-call` says.

### Design
- **Pilot draw (`sample.mjs`, seed 6948).**
  - 80 Tibetan books (40 CANON / 40 OTHER by title, as #6948's `sample.py`) and all 28 Sanskrit books.
  - One block of up to 10 consecutive frame pages per book, drawn from a run of at least 2 pages where the book has one.
  - Half the books in each stratum ran at `--per-call=10` and half at `--per-call=1`.
  - Pages read: Tibetan 314 (2 failed), Sanskrit 60. 25 Sanskrit pages were refused by the reader (OCR loops, soft-hidden pages).
- **Audit (`audit.mjs`).**
  - One page per book: 101 pages (80 Tibetan, 21 Sanskrit). Six Sanskrit books had no readable page in their block, and one image was a PDF.
  - Each page went to a blind, sealed `claude -p --model opus` (Read only).
  - It saw the page image plus full-resolution tiles. BL's IIIF server caps whole images at 1,200 px, so the tiles are native-resolution *region* requests. It also saw the transcription and the English.
  - It reported reversal / invention / omission / wrong-leaf / untranslated / chatter with a verdict, and every span where the leaf differs from the transcription (the OCR measure; no Derge/84000 text was used, since the typed edition may be another witness).
- **Controls:** 10 planted reversals and 5 planted invented sentences (`audit.mjs plant`, a separate Opus call), shuffled in with opaque ids.
- **Attribution (`audit.mjs attribute`).** For each item flagged on a bad page, a text-only Opus call decided whether the English is faithful to the transcription (the defect is the OCR's) or departs from it (the defect is the translator's).
- **By eye:** 20 page images opened by me (`by eye`), listed below.

### Result: the gate fails on criteria 1 and 2
| | n | bad | 95% CI | usable with caveat | usable | pages with reversal / invention / wrong-leaf / omission |
|---|---|---|---|---|---|---|
| **Tibetan** | 80 | **28 (35%)** | 26–46% | 41 | 11 | 8 / 25 / 7 / 29 |
| CANON (Kangyur volumes) | 40 | 19 (48%) | 33–63% | 14 | 7 | 4 / 16 / 5 / 17 |
| OTHER | 40 | 9 (23%) | 12–38% | 27 | 4 | 4 / 9 / 2 / 12 |
| **Sanskrit** | 21 | **8 (38%)** | 21–59% | 9 | 4 | 0 / 4 / 1 / 8 |

- **Controls: 15 of 15 caught**: 10/10 reversals and 5/5 inventions, each located by its planted sentence. The auditor's verdicts count.
- **Per call:** Tibetan 10/call had 13/40 bad and 1/call 15/40. 10/call is not worse, but the question is moot.
- **Cost of 10/call:** it did not save usage on Tibetan: $9.29 vs $13.40 list-equivalent per 100 pages, with arm composition making up most of the gap (output tokens per page 2,977 vs 3,705). 15 of 60 block calls were refused: Opus closes the `<translation>` tags before `<summary>`/`<keywords>`, and the strict splitter refuses rather than guess, so those pages are read again alone.

**Why pages are bad (attribution + by eye).** Of the 28 bad Tibetan pages, **18 are caused only by the transcription**: the English is faithful to an OCR that is not what the leaf says. The by-eye pass found three OCR patterns on the EAP two-leaf frames:
- **Lines invented or duplicated at the seam.** a019 has 10 transcribed lines for a 7-line leaf. a008 and a010 each have an 8th line between the leaves. a037 ends its line 7 with the lower leaf's first line.
- **Lines degenerating** into merged, repeated phrases that drop a negation (a011).
- **Lines truncated**: 12 short lines for two 7-line leaves (a040).

The Yigdzin verdict `SERVE` let all of these through. These transcriptions are served to readers today; that is #5320's seam, but on the OCR side rather than only in the translation.

**10 Tibetan bad pages have a translator-side item:**
- **Meaning errors (5 pages):**
  - a048: a rhetorical question (…མི་འདུག་གམ, "isn't some Dharma needed?") turned into the statement that none is needed;
  - a050: "if one knows" made "one who does not know";
  - a062: "the pass split open" made "the pass was closed";
  - a065: a sentence split and its subject reassigned;
  - a067: the colophon's "those tightly bound by the noose of suffering" made "instructions bound by the noose of secrecy and sealed by commitment" (*dam po* "tight" read as *dam* "commitment").
- **Other substantive errors (3 pages):**
  - a076: guesswork on corrupt OCR;
  - a035: the transcribed name replaced with "Velama";
  - a046: the instruction "imagine that they are invited" reduced to "are invited".
- **Minor (2 pages):**
  - a075: a monastery name in the keywords;
  - a010: a 3-word completion where the leaf breaks off.

Sanskrit bad pages:
- **0 meaning errors in the English.**
- 4 are caused by the transcription. One is a wrong leaf: a084, Mantra Maharnava, contained, #7321.
- 2 are refusals on looping OCR. The production prompt asks for a `<warning>` there, so these are correct behaviour that the auditor counted as bad.
- 2 add encyclopaedic or catalogue facts in notes and keywords.

Without the OCR's share the Tibetan rate would still be about 10% (8 substantive translator pages of 80): above the bar.

**OCR, measured against the leaf (spans where the leaf reads differently, per legible page; capped at 40):**
| | legible pages | mean spans | median | pages with 0 | pages over 40 | not legible at the served size |
|---|---|---|---|---|---|---|
| Tibetan | 55 | 13.1 | 9 | 6 | 5 | 25 (BL frames served at 1,536 px) |
| CANON | 40 | 16.6 | 15 | 2 | 5 | 0 |
| OTHER | 15 | 3.7 | 3 | 4 | 0 | 25 |
| Sanskrit | 20 | 9.8 | 7 | 2 | 4 | 1 |

Bad rate by OCR spans (Tibetan):
| OCR spans on the page | bad pages |
|---|---|
| 0 | 0/6 |
| 1–3 | 3/9 |
| 4–9 | 2/13 |
| 10–19 | 6/11 |
| 20+ | 12/16 |
| not legible | 5/25 |

Derek expected the OCR to need correcting, and it does: the Kangyur volumes average 16.6 visible differences per frame.

**By eye (20 pages, `$JOB_SCRATCH/byeye/byeye.jsonl` summarised).**
- **Confirmed wrong-leaf, 1 page:** a084, Mantra Maharnava (Khemraj 1924). The images of pp. 72–74 are the deity-invocation section (printed pp. 23–25). The stored OCR and served English are yantra pages (printed pp. 714–716). Contained the same run: book held `wrong-leaf-text-vs-images-7321`, English on pp. 72 and 74 withheld, #7321 labelled `contained`.
- **English that is not on the leaf, 4 pages:** a008, a010, a019, a037, each because the transcription invented or duplicated lines at the leaf seam, which the English renders. Criterion 2 therefore fails.
- **OCR misreads or omissions confirmed:** a011, a040, a085 (दरद and अभ्रक misread as पारद and अंजन), a098 (a dot-loop over the commentary), a100 (six plate labels not transcribed), a095 (the stored OCR's `<meta>` invents two printers' names; the leaf's mirrored text reads E. Madhava Rao and G. H. Bhatt).
- **Translator errors confirmed against the transcription:** a067 (also read on the leaf), a048, a050, a062. For a048, a050 and a062 the leaves are dense *dbu med* cursive that I cannot read at this size, so these rest on the text.
- **Sound pages:** a072 (the leaf matches the transcription and the English is faithful), a074 (text check only).

### Usage (this box's account, derek@sourcelibrary.org)
- **Pilot reads:**
  - Tibetan: $9.29 (10/call) and $13.40 (1/call) list-equivalent per 100 pages, at 29–39 s per page;
  - Sanskrit: $7–8 per 100 pages.
  - The weekly meter moved 49→52% over the reads (~400 pages, this session's own use included), so **≤ 0.7–1.0% of the week per 100 pages**.
- **Audit:** 116 calls at $28.69 list-equivalent (about $0.25 per page), 51 s each. The pilot and audit together moved the week 49→54%.
- **What the full run would need:** the 78.7K-page Tibetan frame at that rate is roughly 6–8 account-weeks.
- **Spend:** $0 paid; no Gemini.

### What this means
- **Translating the Yigdzin frame as it stands would put wrong English on about a third of the pages.** Most of it would be wrong because the transcription is wrong, and that wrong transcription is already served on those pages today.
- **Either option below is a new lane with a new gate. Nothing is queued.**
  - (a) Fix the transcription at the seams first: split the two-leaf frames (#5771), or re-read the seam lines and drop the duplicated ones.
  - (b) Translate from the image with the transcription as a draft, as the auditor already does when it locates a span.
- **Translator-side meaning errors exist even on clean text** (5 of 80 pages). Whichever lane comes next needs its own reversal check.
- **The audit design worked and can be re-run as is.** It caught every control. The leaf-grounded OCR span count is cheap (it comes free with the audit), needs no reference text, and can rate any OCR lane.

### Artifacts
- Harness: `scripts/eval/opus-tib-sa-6948/` (`frame.mjs`, `sample.mjs`, `read-loop.sh`, `audit.mjs`, `usage.mjs`, and `run.mjs`, the stage-2 driver, never run; its `split` writes the part-2 page list for a second account).
- Reads, audit packet, replies, scores and by-eye notes: `$JOB_SCRATCH` on l7a (`/data/scratch/sl/jobs/opus-tib-sa-6948`); nothing was written to pages except the #7321 containment.
- Replicated? No.
