---
stage: metadata
measure: accuracy
languages: [la, de, fr, zh, sa, en]
scripts: []
canons: []
n_books: 100
n_pages: 680
verdict: "Guard v3 on a fresh 100-book draw: date precision 94.5% (52/55, 95% CI lower bound 85.1), against 91.8% (56/61) for guard v2 on the same replies. Title precision 95.8% (68/71), against 86.2% (69/80). The 95% gate is still not met for dates. The day-and-month rule removed 2 wrong dates and 4 right ones (disputation dates, which are the edition date when no imprint year is printed). The series-label rule removed 8 wrong titles and 1 right one."
status: rejected
decision: "Keep guard v3 for the proposal queue. No imprint writes without a by-eye check. Whether the ~$85 full read runs at all is a spend decision above the $10 floor and stays Derek's."
superseded_by: null
issue: 7201
---
## 2026-10-24 · Does guard v3 fix the wrong dates on a FRESH draw? (#7201)
<!-- PRIOR ART: scripts/eval/experiments/2026-10-23-titlepage-imprint-7201.md (the first draw, which proposed v3); scripts/audit/titlepage-model-pilot-v2.mjs --imprint (the runner, extended with --exclude). -->

**Who this is for.** This check decides whether the ~$85 full imprint read would be worth running as a review queue
(#7201 line 82 of the #7268 triage).

**What changed in guard v3** (`scripts/lib/titlepage-imprint.mjs`). Each rule comes from a class of error the first
draw's labels found:
- **`bracketed_year`** rejects a date whose quote has square brackets or a parenthesised year. These come from a
  digitiser's cover sheet, a library card or a pencil note.
- **`day_month_date`** rejects a day and month with no imprint word (apud, typis, impressum, datum…). This targets
  an occasion inside a title, or a dated dedication.
- **`show_through_page`** (text mode) rejects any field cited from a page whose OCR carries the transcriber's
  mirrored / bleed-through warning.
- **`series_label`** rejects a 四庫全書 cover label as a title.

**Design.**
- **Fresh draw:** seed 7202, stratified by language × century, in proportion to each pool:
  - 50 scans-only books (image mode), 20 of them from the #7176 set;
  - 50 transcribed books (text mode).
- **Exclusions:** the 200 first-draw books were excluded (`--exclude=`). 1 unfetchable book was replaced from its own stratum.
- **Model:** `gemini-3.1-flash-lite` through the Batch API, with the same prompt as the first draw (`titlepage-imprint-v1`).
- **Guards:** the replies were collected under v2 and then rechecked under v3, with no new model call. Both are
  scored on the same replies.
- **Labelling:** four Opus reviewers labelled `date` and `title` only, against the page images, with the first draw's
  rubric. A proposal's correctness is its label if it was kept, and its `dropped_label` if it was dropped.
- **Unjudged:** one book (Sumerian, no images fetched).

**Result** (precision = right / (right + wrong) of what the guard keeps; Wilson 95% lower bound)

| field | guard v2 | guard v3 | lower bound (v3) | right ones v3 dropped |
|---|---|---|---|---|
| date | 91.8% (56/61) | **94.5% (52/55)** | 85.1 | 4 more than v2 (all `day_month_date`) |
| title | 86.2% (69/80) | **95.8% (68/71)** | 88.3 | 1 (`series_label`: a real title behind the 四庫全書 label) |

- **Day-and-month rule:**
  - First draw (in-sample, which is where the rule was designed): 5 wrong and 5 right removed.
  - Fresh draw: 2 wrong and 4 right removed.
  - The right ones are disputation dates ("Ad d. 21 Nov. Ann. M.DC.XC."). These are the edition's date when the
    imprint prints no year.
  - So on the fresh draw the rule is worth about two wrong dates per hundred books, at the cost of four right ones.
- **Bracketed rule:** never fired on the fresh draw.
- **The three wrong dates v3 still keeps:**
  - two dates from dedicatory epistles, where no imprint year is printed;
  - one Vikram Samvat numeral misread (१८७८ as १२७९).
- **The four right dates v2 and v3 both drop on `quote_lacks_year`:**
  - "VERONAE. M. D. XXXX." and "M. D. XXXXVIIII.": non-subtractive numerals;
  - "D.M.XLVI.": D and M inverted, as in the first draw;
  - a year written out in words in a manuscript deed.

  The quote check reads none of these.

**Cost:** estimated $0.104, actual **$0.093** (523K in / 37K out).

**What this does not show.**
- n is small: a 95% CI spans about 10 points at 55 kept dates. 94.5% and the 95% gate cannot be told apart here.
- Place, printer, edition statement and names were not labelled this round. Their first-draw numbers stand.

**Decision.**
- Guard v3 stays.
- An imprint field is never written from this read without a by-eye check. The ~$85 read only makes sense as a
  review queue of rows that differ from the catalogue.
- In a queue that is read by eye, the day-and-month rule could be a flag instead of a rejection: it would then keep
  the four right disputation dates. That is a one-line change, left for whoever builds the queue.

Artifacts (l7a): `/data/scratch/sl/jobs/triage-followup-1024/v3-fresh/` (sample, manifest, both evidence files, labels-1..4).
