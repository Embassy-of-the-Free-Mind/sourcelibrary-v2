# Translation-relation check (issue #6012) — instructions for the reader

A matcher claims that an early modern ENGLISH printed text (typed by the Text Creation Partnership) is a translation of a work we hold in Latin or German as page images. You check that claim. Internal quality measurement; be strict and honest. A wrong "yes" is worse than a "cannot tell".

For each packet NN in the directory you are given:
1. Read `NN.txt`: our book (catalogue line + image path of what should be its title page), and the English text (catalogue line + its first leaves as typed, usually its title page).
2. Open `NN-full.jpg` with the Read tool and READ OUR TITLE PAGE FROM THE IMAGE: author, title, language, place, year. If the image is not a title page, say so and use our catalogue line instead (and say you did).
3. Decide the relation of the ENGLISH text to OUR work:
   - `translation-of-this-work`: the English text is a translation of the work on our title page (whole or substantial part), whatever edition it was made from.
   - `contains-translation-of-this-work`: the English volume is a collection or a larger book that includes a translation of our work among other things (say what else).
   - `our-book-contains-the-original`: our book is a collection (Opera, a compendium, an anthology) that contains the original of the English text among other works.
   - `same-author-different-work`: same author, but the English text translates (or is) a different work.
   - `not-a-translation`: the English text is an original English work, or our book is itself an English edition, or the two are unrelated. Say which.
   - `cannot-tell`.
4. Evidence in one or two sentences: quote the words on each side that decide it (e.g. the English title page's "translated out of Latin", the shared title).

Write one JSON line per packet, appended to `verdicts.jsonl` in the same directory, IMMEDIATELY after each packet:
{"id":"NN","verdict":"translation-of-this-work|contains-translation-of-this-work|our-book-contains-the-original|same-author-different-work|not-a-translation|cannot-tell","our_title_from_image":"<author, short title, place, year as read>","our_language":"<language of our book as read from the image>","evidence":"<1-2 sentences>","confidence":"high|medium|low","read_from":"image|catalogue"}

Rules: you may use your own knowledge of early modern books to recognise a work under a translated title, but say so in the evidence ("known: …"). Do not open any other file in the parent directories. No web. Do not edit anything except verdicts.jsonl. When done, reply with one line: the count per verdict.

<!-- PRIOR ART: scripts/eval/translation-vs-reference/JUDGE-PROMPT.md (#5695, a fidelity judge over text) and #5126 leaf-check instructions (job-local, never committed); none asks a blind reader to compare a page image with a typed text for edition, leaf or passage. Paths in this file are the job box scratch paths the 2026-10-06 readers were given. -->
