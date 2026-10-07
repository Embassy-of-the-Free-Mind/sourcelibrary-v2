# Reference cutter brief (#5606 translation A/B) — read fully before starting

You are cutting HUMAN REFERENCE translations for a blind translation A/B. A judge will later compare
machine translations of one scanned page against the reference you cut. A wrong reference ruins the
page, so accuracy matters more than speed. You do NOT translate anything yourself.

## Input
For each book assigned to you there is a file /root/tab5606/cands/<LANG>/<book_id>.json: a list of up
to 4 candidate pages of that book (`page_number`, `ocr` = the stored OCR text of the page, `note` =
the work and the public-domain English translation we expect to use).

## Task, per book
1. Read the candidates IN FILE ORDER. For each, work out exactly what the page contains: which
   work, chapter, section, verse numbers (printed verse numbers, chapter headings, running heads,
   and the text itself). Decide whether the page is mostly ROOT TEXT or mostly COMMENTARY.
2. Pick the FIRST candidate that (a) you can locate precisely and (b) whose root text is covered by
   the named public-domain English. Prefer a page with a substantial amount of root text; skip a page
   that is only commentary, an index, a preface or a title page (record why).
3. Fetch the public-domain English from the web and cut the passage that corresponds to the page:
   the whole span the page covers, plus at most one extra verse/paragraph on each side so the judge
   can see the page boundaries. Sources that work from this box: archive.org (search
   `https://archive.org/advancedsearch.php?q=...&fl[]=identifier&fl[]=title&fl[]=year&rows=20&output=json`,
   full text `https://archive.org/download/<id>/<id>_djvu.txt` — use curl via Bash, it is large; grep
   inside it), Project Gutenberg (`https://www.gutenberg.org/cache/epub/<n>/pg<n>.txt`), English
   Wikisource (`https://en.wikisource.org/w/index.php?title=<Title>&action=raw`). ctext.org and
   sacred-texts.com are BLOCKED here (Cloudflare) — do not use them.
   Use a neutral user agent (e.g. `-A "Mozilla/5.0"`); do NOT send any email address in requests.
4. The reference must be VERBATIM from the fetched text: you may only rejoin hyphenated line breaks,
   drop page headers/footnote markers, and normalise whitespace. Never paraphrase, never fill gaps,
   never translate. Do not include the translator's footnotes. If the translation abridges or skips
   part of the page, say so in `coverage_note`.
5. Licence: use only translations published before 1931 (public domain in the US) unless the note
   names another; record the year. If only an in-copyright translation exists, mark the book unlocated.

## Output — one JSON file per book: /root/tab5606/refs/<LANG>/<book_id>.json
Write with python (json.dump, ensure_ascii=False). Shape:
{"book_id": "...", "page_number": 123, "id": "<book_id>_<page_number zero-padded to 5>",
 "work": "e.g. Daodejing", "located": "e.g. ch. 23 (whole) and ch. 24 lines 1-3",
 "page_content": "root text of ch. 23 with Heshang Gong commentary in small characters",
 "coverage_note": "reference covers the root text; the commentary (about 60% of the page) has no reference",
 "reference": "<verbatim English>",
 "reference_source": "James Legge, The Texts of Taoism I (Sacred Books of the East 39), Oxford 1891",
 "reference_url": "<the exact URL you fetched>", "reference_licence": "public domain (published 1891)",
 "confidence": 0.0-1.0, "skipped": [{"page_number": 101, "reason": "commentary only"}]}
If no candidate can be located: {"book_id": "...", "unlocated": true, "skipped": [...], "reason": "..."}.

## Rules
- Read-only everywhere except /root/tab5606/refs/. No database writes, no model API calls, no git.
- Keep each reference under ~6,000 characters; if the page's span is longer than that, cut exactly
  the page's span and drop the context.
- Finish with a one-line-per-book summary: book_id, page, located, confidence.
