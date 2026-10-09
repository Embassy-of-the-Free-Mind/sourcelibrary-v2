# Translation-passage check (issue #6012) — instructions for the reader

A word-overlap placer claims that one typed page of a 17th-century (or 16th-century) ENGLISH translation renders the passage printed on one page image of a Latin or German book we hold. You check that claim by reading our page from the image. Internal quality measurement; be strict and honest.

For each packet NN in the directory you are given:
1. Read `NN.txt`: it names our page and its images (`NN-full.jpg` whole page; `NN-s1.jpg`..`NN-s3.jpg` top/middle/bottom strips at reading resolution), and gives three consecutive typed pages of the English, the middle one marked CHOSEN.
2. Open the strips with the Read tool and READ OUR PAGE FROM THE IMAGE (Latin or German; Fraktur or roman). Note its first sentence, its last sentence, and two or three distinctive things in between (names, numbers, a quotation, a heading).
3. Decide:
   - `passage`: `same-passage` if the English CHOSEN page translates text that is on our page image (it need not cover the whole page, and page breaks will differ); `adjacent` if our page's text is rendered in the "before" or "after" English page but not in the CHOSEN one; `same-work-elsewhere` if the English is clearly the same work but none of the three pages renders this page; `different-text` if the English does not translate this text at all; `not-text` if our image is blank, a plate or unreadable.
   - `coverage`: roughly how much of OUR page's text is rendered within the three English pages: `most`, `part`, `little`.
   - `fidelity_note`: one sentence on how the old English relates to our text: close, free/paraphrase, abridged, expanded with commentary, or made from another version (e.g. our German vs an English made from the Latin).
4. Write one JSON line per packet, appended to `verdicts.jsonl` in the same directory, IMMEDIATELY after each packet:
{"id":"NN","passage":"same-passage|adjacent|same-work-elsewhere|different-text|not-text","coverage":"most|part|little|n/a","our_first_sentence":"<as read from the image, original language>","english_match":"<the English words that render it, quoted, or 'none'>","fidelity_note":"<one sentence>","read_from":"image"}

Rules: do not open any other file in the parent directories. No web. Do not edit anything except verdicts.jsonl. When all packets are done, reply with one line: counts per `passage` and `coverage`.

<!-- PRIOR ART: scripts/eval/translation-vs-reference/JUDGE-PROMPT.md (#5695, a fidelity judge over text) and #5126 leaf-check instructions (job-local, never committed); none asks a blind reader to compare a page image with a typed text for edition, leaf or passage. Paths in this file are the job box scratch paths the 2026-10-06 readers were given. -->
