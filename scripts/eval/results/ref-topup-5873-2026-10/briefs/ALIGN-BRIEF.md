# Reference alignment brief (#5873 reference top-up) — read fully before starting

You are finding and cutting PUBLISHED HUMAN English translations for a blind translation eval. Two judges will
later compare machine translations of one scanned page with the reference you cut. A wrong reference ruins the
page, so accuracy matters more than speed. You translate nothing yourself.

## Input
You are given a language and a list of ORDER numbers. Each is one book, drawn at random (seeded) from the live
library, so most books will have NO usable published translation. Dismissing those quickly, with a reason, is
most of the job.

- `python3 /data/scratch/sl/ref-topup-5873-private/show.py <Lang> <order>` prints the book's metadata and the first
  500 characters of each candidate page (up to 6, in seeded order).
- `python3 /data/scratch/sl/ref-topup-5873-private/show.py <Lang> <order> <page_number>` prints one candidate's full OCR.
- `latin_share` is the share of Latin-script words on the page and on its two neighbours. For Arabic, Persian,
  Hebrew and Chinese a high value means printed English, Latin or transliteration. Ignore it for romanised Pali and Sanskrit.

## Per book
1. Work out what the book is and whether a published English translation BY A NAMED HUMAN TRANSLATOR exists and
   can be read from this machine. If not, record a failure (below) and move on. Do not spend long on a book with
   no realistic translation: a rhyme dictionary, an anonymous manuscript miscellany, a modern commentary.
2. Otherwise read the candidates IN ORDER and take the FIRST one where all of these hold:
   - the page is body text in the language being measured (not a title page, index, table of contents, preface by a
     modern editor, or a page mostly in another language);
   - neither the page nor its neighbours print an English translation (a facing or interlinear translation would
     have been in the machine translator's context). Skip the whole book if it is a bilingual edition throughout;
   - you can locate the page exactly (chapter, verse, section, tale) and the published translation covers at least
     about 60 % of the text on the page. A page that is mostly untranslated commentary fails this.
   Record every candidate you pass over, with the reason.
3. Fetch the translation and cut the passage for that page: the span the page covers, plus at most one sentence or
   verse on each side, which you put on separate lines starting with `[context] `. The cut is VERBATIM from the
   fetched text: you may rejoin hyphenated line breaks, drop page headers and footnote markers, and normalise
   whitespace. Never paraphrase, fill gaps or translate. Drop the translator's footnotes. Keep it under about
   6,000 characters; if the page's span is longer, cut the page's span and drop the context.
4. Say honestly what the page language is: `Hebrew`, `Aramaic` (Zohar, Talmud, Targum pages in a Hebrew-labelled
   book), `Arabic`, `Persian`, `Pali`, `Sanskrit`, `Chinese`. A book labelled Persian that is in fact Urdu, Chinese
   or English is a failure with that reason.

## Licences
- **Open (preferred):** published before 1931 (US public domain: record the year); CC0 / CC BY / CC BY-SA / CC BY-NC
  (record it exactly). SuttaCentral's Sujato and Brahmali translations are CC0. On Sefaria use only a version with a
  named translator and an open licence; "Sefaria Community Translation" is excluded.
- **In copyright:** allowed only when no open translation covers the page and you can read the text from a
  legitimate public source. Set `"private": true` and `"licence": "in-copyright"`. The text then stays in the
  private directory and is never published.
- Take the open translation when both exist, even if it is older and freer.

## Sources that work from this machine (curl via Bash, `-A "Mozilla/5.0"`, never send an email address)
archive.org (search `https://archive.org/advancedsearch.php?q=...&fl[]=identifier&fl[]=title&fl[]=year&rows=20&output=json`;
full text `https://archive.org/download/<id>/<id>_djvu.txt`, large: save it under /tmp and grep), Project Gutenberg
(`https://www.gutenberg.org/cache/epub/<n>/pg<n>.txt`), English Wikisource (`...index.php?title=<Title>&action=raw`),
the Sefaria API (`https://www.sefaria.org/api/v3/texts/<Ref>?version=english`), the SuttaCentral API
(`https://suttacentral.net/api/bilarasuttas/<uid>/sujato`). ctext.org and sacred-texts.com are blocked.

## Output: one JSON file per book, written with python (`json.dump(..., ensure_ascii=False, indent=1)`)
`/data/scratch/sl/ref-topup-5873-private/refs/<Lang>/<book_id>.json` where `<Lang>` is the DRAW language you were given.
Write the file as soon as the book is settled, before starting the next book.

Aligned:
```
{"book_id": "...", "order": 7, "lang": "<page language>", "page_number": 123, "candidate_index": 0,
 "book_title": "...", "work": "e.g. Gulistan", "period": "13th c.", "genre": "e.g. poetry | scripture | liturgy | medicine | history | philosophy | narrative",
 "page_content": "what is on the page; for root text plus commentary, the share the reference covers",
 "reference_text": "<verbatim English; [context] lines outside the page>",
 "reference_meta": {"title": "...", "translator": "...", "year": 1888, "licence": "public domain (published 1888)",
   "private": false, "style": "literal | free | early-modern", "canonical": true,
   "located": "ch. 2, story 14 to 16", "url": "<the exact URL fetched>", "coverage_note": "covers the whole page except the Arabic verse at the foot"},
 "famous": true, "page_has_printed_english": false, "align_confidence": 0.9, "align_note": "...",
 "skipped": [{"page": 101, "reason": "editor's preface"}]}
```
`canonical`: scripture, liturgy, or a classic whose standard English is everywhere online (Bible, Qur'an, Mishnah,
Talmud, Zohar, Pali canon, Gulistan, Rubaiyat, Shahnameh, the Confucian classics). `style`: `literal` = close
scholarly crib, `free` = literary or verse rendering, `early-modern` = before 1800.

Not aligned:
```
{"book_id": "...", "order": 7, "failed": true, "reason": "one line: no published English translation | bilingual edition | not in the labelled language (Urdu) | commentary-heavy, under 60 % covered | only an in-copyright translation with no readable source | ...",
 "skipped": [{"page": 101, "reason": "..."}]}
```

## Rules
- Read-only everywhere except `/data/scratch/sl/ref-topup-5873-private/refs/` and scratch files under `/tmp`.
  No database access, no model API calls, no git.
- Do not look at or ask for the site's own English translation of these pages.
- Every book in your list gets a file. Finish with one line per book: order, book_id, aligned page or the failure reason.
