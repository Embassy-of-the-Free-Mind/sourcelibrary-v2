# Title-page check (issue #6012) — instructions for the reader

You are checking whether a typed transcription (from an open text archive) was made from THE SAME EDITION as a book we hold as page images. Internal quality measurement; be strict and honest. A wrong "yes" is worse than a "cannot tell".

For each packet NN in the directory you are given:
1. Read `NN.txt`. It names our book, gives the image path of our title page, the typed text's catalogue line, and the typed text's own transcription of its title page.
2. Open the image `NN-full.jpg` with the Read tool and READ THE TITLE PAGE FROM THE IMAGE yourself: title wording, author, place, printer/publisher, year (convert roman numerals), volume/part, edition statement. If the image is not a title page (blank, binding, frontispiece, half-title), say so.
3. Compare image against the typed transcription, in this order: imprint (place, printer, year) → title wording and spelling → line breaks and capitalisation of the title lines → volume/part.
4. Verdict, one of:
   - `same-edition`: imprint agrees (same place, printer and year) AND the title wording/spelling/line division agree. Minor differences that are transcription conventions (long s, umlaut-e, u/v, ligatures, a library stamp) do not count.
   - `same-work-other-edition`: same work (same author and title, perhaps another volume of the same set → say so), but the imprint, year, spelling, line breaks or layout differ, so it is another edition or printing.
   - `different-work`: not the same work.
   - `cannot-tell`: the image is not a title page or is unreadable, or the typed side has no title page transcription. Say which.
5. Give the evidence in one or two sentences: quote what the IMAGE says (imprint line, year) and what the typed text says.

Write one JSON line per packet, appended to `verdicts.jsonl` in the same directory, IMMEDIATELY after each packet (do not batch at the end; images can drop out of your context):
{"id":"NN","verdict":"same-edition|same-work-other-edition|different-work|cannot-tell","image_imprint":"<place, printer, year as read from the image>","typed_imprint":"<as in the packet>","evidence":"<1-2 sentences>","confidence":"high|medium|low","read_from":"image"}

Rules: do not open any other file in the parent directories (the index holds the machine's claim and would bias you). Do not use the web. Do not edit anything except verdicts.jsonl. When all packets are done, reply with one line: the count per verdict.

<!-- PRIOR ART: scripts/eval/translation-vs-reference/JUDGE-PROMPT.md (#5695, a fidelity judge over text) and #5126 leaf-check instructions (job-local, never committed); none asks a blind reader to compare a page image with a typed text for edition, leaf or passage. Paths in this file are the job box scratch paths the 2026-10-06 readers were given. -->
