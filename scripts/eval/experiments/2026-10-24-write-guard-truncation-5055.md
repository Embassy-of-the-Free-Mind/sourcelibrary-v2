---
stage: pipeline
measure: [judged, none]
languages: []
scripts: []
canons: []
n_books: 5020
n_pages: 5020
verdict: "The write guard (scripts/lib/write-text-guard.mjs) refuses 2 of 5,000 stored OCR pages and 2 of 2,018 stored translations as truncated; all 4 are real truncations, read from the text. Of the 20 hand-read #5055 truncation flags, it fires on 2: 1 real, 1 unclear, 0 false. Seven of the 10 'real' ones are not short at all once their notes are counted: their body sits inside <note>/<margin> (hidden text), which is a different defect from truncation."
status: adopted
decision: "Wired into every OCR and translation writer (PR for #5055): a cut read is refused, re-read once, then recorded"
superseded_by: null
issue: [5055]
---
## 2026-10-24 · Which stored pages would the write-time truncation + tag-balance guard refuse, and is it right about them? (#5055)

PRIOR ART: `2026-09-24-are-the-scans-in-order-and-is-every-page.md` (the page-integrity walk that measured 66,525
truncated translations, its calibration and its hand-read of 20, `page-integrity-handread-2026-09-24.json`); the
guard reuses that walk's `truncationRatio` and calibration, and it reuses `annotation-tag-repair.mjs` for the repair.

**Why.** Derek, 2026-10-24: "stripping notes isn't the problem, it's if they don't close." Every translation writer
auto-closes an unclosed tag (#5644), so a reply cut off inside a `<gloss>` is stored as a finished page. The OCR writers
ask no tag question at all.

**The rule.** `truncated` when a paired tag opens in the last 15% of the text and never closes (unless the reply goes
on to finish its `<vocab>`/`<summary>`/`<keywords>` after it), when the text ends inside a tag, on MAX_TOKENS or a CLI
partial reply, or, for translation, when the English is under 0.35× its source's reading length. The English is
measured with its notes, margins and footnotes, and the rule applies only in the 20 census languages whose 5th
percentile is ≥ 0.70, so that 0.35 is under half of it (Hebrew 0.621, Old Norse and Uzbek are out). A tag left open
earlier in the text is `repaired_mid`.

**Tuning (by text, OCR beside translation).** The first draw's rule had four false shapes, each fixed before the
final draw: (1) a German page whose printed footnotes came back as `<note>`s; truncationRatio leaves notes out, so
the floor now counts them. (2) A Malay verse page ending `<unclear>pertiwi</term>`: a mis-named close now closes the
latest open tag. (3) An archive OCR with a stray `<k` mid-page read as "ends inside a tag": the fragment must now be
on the last line. (4) A Chinese play's role marker `<gloss>` left open, followed by the page's finished `<vocab>`.

**Labelled set (#5055 hand-read, 20 flags, one per book).** Fires on 2 ('thought' for a full page: real; an Euler
page: unclear). 0 false. Measured with notes, 7 of the 10 'real' pages are 1.1 to 2.9× their source. Their text is
there, but inside `<note>`/`<margin>`, so a reader with notes off sees an empty page. That is the hidden-text class
(`hidden-translation.mjs`), not a truncation, and a length gate cannot and should not call it one. The census
'real' list therefore splits into a hidden-text repair (re-tag, no model call) and a much smaller re-read list.

**Backlog draw (read-only).** Seed 5055, 5,000 random books (129,358 with pages), one page each.
`scripts/eval/write-guard-5055/backlog.mjs`.

| | judged | ok | repaired_mid | truncated | truncated, by hand |
|---|---|---|---|---|---|
| OCR | 5,000 | 4,990 | 8 | 2 (gemini-3.1-flash-lite ×2) | 2 real: repetition loops cut at the output cap (Egyptian, a faded Latin page) |
| translation | 2,018 | 2,013 | 3 | 2 (gemini-3.1-flash-lite, -preview) | 2 real: Latin pages that stop after §1 of 7 and mid-sentence |

Projection, page share × corpus (9,482,178 OCR pages, 5,668,539 translated; Poisson 95% CI; a book-weighted draw):
truncated OCR ≈ 3,800 (460–13,700), truncated translations ≈ 5,600 (680–20,300). Stored OCR with a tag left open
mid-text ≈ 15,200 (6,500–29,900); translations ≈ 8,400 (1,700–24,600). Two caveats. Stored translations went
through the auto-close, so their tag-tail cuts are invisible here and the translation count is a floor. Neither
loop the OCR guard caught was caught by the loop guard.

*Replicated?* No; one draw. An earlier draw on the pre-tuning rule (same seed, the corpus had shifted by 25 books)
flagged 2 OCR pages, both real loops too.

Artifacts: `$JOB_SCRATCH/backlog3/{summary.json,sample.jsonl.gz,labelled.json}` (job write-guard-5055, not committed).
