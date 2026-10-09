<!-- PRIOR ART: month 0's reviewer instructions (2026-10-06, ops rights-screen/2026-10-06-canon-shelves/spot30/) were not
saved; this brief reconstructs them from the fields its result files carry (result0–4.json), and adds the taxonomy class
and the explicit on_sight_defect flag the series needs. ../translation-corpus-audit/JUDGE-PROMPT.md judges ONE page's
translation text-only, blind to controls; this one reads runs against the image and judges the book. FROZEN: change it
only with a note in the series file, because a changed brief makes the fortnights incomparable. The routine passes
everything below the next line, verbatim, followed by PACKET_FILE and OUTPUT_FILE lines. -->
# Spot-check reviewer brief (#5914) — v1, 2026-10-06

You are reviewing a random sample of books from Source Library, a digital library of historical primary sources with
AI transcription (OCR) and AI translation into English. A reader opens these pages and trusts them. Your job is to say
what an expert reader would find, reading each page against its image.

You have a packet of 5 books. Each book has a run of 3 consecutive pages. For every page the packet gives the image URL,
the transcription (`ocr`) and the English translation (`translation`), and which engine and model made each.

## How to work

1. Read `PACKET_FILE` (JSON array of books). Do not read any other packet, any earlier result, or any report.
2. For each page, download the image to a scratch directory **outside the repository** (for example
   `curl -sL -o /tmp/spot/<book_id>_<page_number>.jpg "<image_url>"`) and open it with the Read tool, so you see it.
   If `crop` is set, the reader sees only that horizontal slice of the image (`xStart`–`xEnd`, in percent); judge that
   slice. If the image will not load, say so on that page (`right_page: "unsure"`, confidence low) and go on.
3. Compare the image with the transcription, then the transcription with the translation. Quote; do not paraphrase.
4. For the class of each serious error, use the codes in `.claude/docs/page-error-taxonomy.md` (I1–I7 image and page
   unit, O1–O17 OCR, T1–T16 translation, D1 display, E1–E2 derived). Read its headings before you start. If nothing fits,
   write `other:<short name>`.
5. Write your results to `OUTPUT_FILE` as one JSON array (schema below), then reply with one line: the file path and
   the number of books written. If a write is refused, put the JSON in your reply instead.

Read at the resolution you have. If a judgement depends on detail you cannot see (small type, a script you read
poorly), say so with `confidence: "low"` rather than guessing. Never invent what the image says.

## What to judge, per page

- **right_page**: `"yes"` if the image is the leaf the transcription is of; `"no"` if it is another leaf (the
  neighbour, a duplicate, another book); `"unsure"`. A wrong leaf is itself a serious error (class I1, or I2 for a
  duplicate scan): add it to `other` with severity `"serious"`.
- **ocr_score** 1–5: 5 every word right; 4 a few slips that do not change meaning; 3 several misreadings, some
  changing meaning, or a block missed; 2 large parts wrong, missing or not on the page; 1 the text is not this page's
  text. `null` only when the image would not load.
- **ocr_errors**: each misreading or invention that matters, as an object (see schema), quoting the transcription and
  what the image shows.
- **tr_score** 1–5 for fidelity to the transcription (and to the image where the transcription is wrong): 5 faithful;
  4 small slips; 3 a meaning-changing error or a dropped sentence; 2 several, or a passage invented or reversed; 1 not
  a translation of this page.
- **tr_errors**: each error as `source → english → problem → severity`.
- **other**: embarrassments a reader sees without reading the source: markup or tags leaking into the reader text
  (`<summary>`, `<note>`, arrows, `[[…]]`), invented headings, invented apparatus (editors, sigla, manuscript facts
  that are not on the page), model reasoning in the text, a translation of a blank or a plate as if it were prose.

**Severity** (the same three levels for every list):
- `serious` — a reader would be misled about what the source says or is: sense reversed, a statement invented, a
  passage dropped, the wrong leaf, text that is not on the page, a name, number or dose wrong where it matters.
- `moderate` — wrong but recoverable from context: a misread name, a wrong pinyin, a dropped clause that does not
  change the argument, an invented heading.
- `minor` — style, spelling, inconsistency, formatting.

## What to judge, per book

Use the packet's `book` metadata, the 3 pages, and the `structure` counts.
- **shelf_fit**: `"fits"`, `"doubtful"` or `"wrong"` — does the book belong to its tradition or collection
  (`tradition`, `book.catalog_metadata.collections`)? Plus `shelf_note`.
- **rights_flag**: `null`, or a note when the book looks like a modern in-copyright edition (a 20th/21st-century
  typeset critical edition, a modern translation, a recent publisher's copyright page, a licence stamp burned into the
  scan). Quote what you saw.
- **structure_note**: what the counts and pages suggest — printed page numbers going backwards or repeating
  (`printed_backsteps`, `printed_repeats`), duplicate records, pages vs pages with OCR vs pages translated, a scan
  splice, the wrong work under the title. A backstep count alone is not a defect (a misread leaf numeral makes one);
  say which you think it is. `null` if nothing stands out.
- **on_sight_defect**: `true` if an expert opening this book would flag something on sight — any serious error on
  your pages, a wrong shelf, a rights problem, a broken structure, or an embarrassment in `other`. Otherwise `false`.
- **book_verdict**: one or two sentences.

## Schema of OUTPUT_FILE

```json
[
  {
    "book_id": "…", "slot": 1, "title": "…", "tradition": null,
    "shelf_fit": "fits", "shelf_note": "…",
    "rights_flag": null,
    "structure_note": null,
    "on_sight_defect": false,
    "pages": [
      {
        "page_number": 35,
        "right_page": "yes",
        "ocr_score": 4,
        "ocr_errors": [ { "ocr": "海軍所", "image": "海寧所", "problem": "garrison name misread", "severity": "moderate", "class": "O6" } ],
        "tr_score": 3,
        "tr_errors": [ { "source": "…", "english": "…", "problem": "…", "severity": "serious", "class": "T8" } ],
        "other": [ { "note": "<summary> tag shown in the reader text", "severity": "moderate", "class": "D1" } ],
        "confidence": "high"
      }
    ],
    "book_verdict": "…"
  }
]
```

Every page in the packet gets an entry, keyed by its `page_number` (if the packet holds two records with one page
number, review both and keep both entries). Every error object carries `severity`; every `serious` one carries `class`.
