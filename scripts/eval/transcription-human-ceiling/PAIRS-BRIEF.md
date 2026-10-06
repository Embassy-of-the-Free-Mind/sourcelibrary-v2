<!-- PRIOR ART: scripts/eval/build-edition-refs.mjs (one open edition cut to our page, scored against OUR OCR), scripts/eval/en-ocr-reference-5124.mjs (Wikisource/Gutenberg page references for English) and scripts/eval/zh-skqs-5568-kanripo.mjs (Kanripo page ↔ scan page). Each holds ONE human transcription per page. This brief collects TWO independent human transcriptions of the same page of the same edition, which none of them does (#5762 track 2). -->
# Two human transcriptions of one page — #5762 track 2, {{LANG}}

**What this measures.** Our OCR is scored as character error rate (CER) against one human transcription. Nobody has
measured how far two careful human transcriptions of the SAME printed page differ: that is the floor below which a
CER means nothing. You collect the pairs; a shared scorer (`scripts/eval/transcription-human-ceiling/score.mjs`)
computes every number, so do not compute or report CERs yourself except as a sanity check while aligning.

**A pair is valid only if all four hold.**
1. *Same edition, same page.* Both transcriptions were made from the same printed edition (ideally the same scan or
   the same press run), and both are cut to the same page. A different edition is NOT an error to be forced: record
   `edition_check: "mismatch"` with what differs and keep the row only if you can say so; never silently mix editions.
2. *Independent.* Two separate keyings/proofreadings. If one transcription was derived from the other (imported,
   corrected from it, or both descend from one e-text), the pair measures nothing: record that under
   `independence` and do NOT put it in `pairs.jsonl`; put it in `rejected.jsonl` with the evidence. A CER of exactly
   0 over thousands of characters is itself evidence of a shared ancestor: check it.
3. *Human.* Keyed or proofread by people (double-keying, Distributed Proofreaders, validated Wikisource pages,
   scholarly TEI). Raw OCR or "OCR, not proofread" does not count.
4. *We hold the page.* Where possible the page is one of OUR book pages of that same edition, so our served OCR can
   be scored against both transcriptions on the same page. If no book of ours is that edition, still collect the
   human pair (set `ours: null`): the floor is worth having on its own.

**Edition check by eye.** For 5 pages per source (fewer if you have fewer), look at the page IMAGE (ours, or the
scan the transcription names) and confirm that both transcriptions give that page's first and last line. Record
`edition_check_by: "eye"` on those rows with one line of what you saw; other rows `"metadata"` (title page / TEI
header / colophon agree) or `"unchecked"`.

## Tools
- Working dir `{{WT}}` (run node from there). Read-only on the database. No git, no repo edits, no subagents.
- One of our pages (OCR as served, image URL): `node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/xlref-t1/page-tool.mjs dump --book <id> --page <n> --no-translation`
  (`list --book <id>` lists pages; `book --book <id>` prints the book record). Find our books with a small read-only
  node script against `books` (db `bookstore`; live filter `visible: true, pages_count > 0`; look a book up by `id`).
- Cutting an edition text to a page: `scripts/eval/lib/edition-window.mjs` (`cutEditionWindow`, `foldedWords`).
  Sanity scoring: `scripts/eval/lib/metrics.mjs` `scoreAgainstReference(reference, hypothesis, script)` with script
  `latin` | `greek` | `cjk`.
- Downloads: `curl -sL -A "Mozilla/5.0"` into `/data/scratch/sl/hc5762/t2/{{KEY}}/src/`. WebSearch/WebFetch via ToolSearch.
- Keep any helper scripts you write in `/data/scratch/sl/hc5762/t2/{{KEY}}/` (they are evidence of the cut method).

## Cutting
Cut both transcriptions to exactly the page: from the page's first word of running text to its last. Use the
transcriptions' own page-break markers where they have them (`<pb n>`, `[Pg 12]`, Wikisource `Page:` namespaces,
Kanripo `<pb:…>`, CBETA `<lb n>`); otherwise cut by anchors from the other transcription and say so. Leave out
running heads, page numbers, catchwords, signatures, footnote apparatus and editorial notes on BOTH sides in the
same way; keep the body exactly as transcribed (no spelling repair, no normalising: the scorer normalises).

## Output (`/data/scratch/sl/hc5762/t2/{{KEY}}/`)
`pairs.jsonl`, one line per page:
{"id":"<short unique slug>","lang":"{{LANG}}","script":"latin|greek|cjk","work":"…","edition":"…printed edition both transcribe…",
 "book_id":"<our books.id or null>","page_number":<our page number or null>,"printed_page":"…",
 "a":{"source":"EEBO-TCP A28975","how_made":"double-keyed, …","licence":"CC0 1.0","url":"…","text":"…"},
 "b":{"source":"Project Gutenberg #14504","how_made":"Distributed Proofreaders","licence":"public domain","url":"…","text":"…"},
 "ours":{"text":"…our served OCR for the page, as dumped…","model":"…"} or null,
 "edition_check":"same|mismatch","edition_check_by":"eye|metadata|unchecked","edition_note":"…",
 "independence":"…one line: why these two are separate keyings…","cut_method":"…"}
`rejected.jsonl`: candidates you ruled out, `{"candidate":"…","reason":"…","evidence":"…"}`.
`NOTES.md`: what you searched, which sources overlapped, how many pages exist in principle, what blocked more.

Aim for 30+ pages from as many distinct books/works as you can (results are graded by book count; at most 3 pages
per book). Fewer honest pairs beat more doubtful ones. If no valid pair exists for this language, say exactly why in
`NOTES.md` and write an empty `pairs.jsonl`. Licences: text that is CC BY-NC or in copyright must be marked in
`licence` (the scorer keeps such text out of the repo). When finished print ONLY the counts.

## Where to look — {{LANG}}
{{WHERE}}
