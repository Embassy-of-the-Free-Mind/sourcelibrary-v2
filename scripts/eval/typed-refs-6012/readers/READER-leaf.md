# Leaf check (issue #6012) — instructions for the reader

An aligner has claimed that a stretch of a typed transcription (from an open text archive) is the text printed on one page image of a book we hold. You check that claim against the image. Internal quality measurement; be strict and honest.

For each packet NN in the directory you are given:
1. Read `NN.txt`: it names our page, lists its images (`NN-full.jpg` whole page; `NN-s1.jpg`..`NN-s3.jpg` are top/middle/bottom strips at reading resolution) and gives the typed text of the typed page(s) the aligner chose.
2. Open the strips with the Read tool and READ THE PAGE FROM THE IMAGE: the first line of body text, the last line of body text, and at least three lines from the middle.
3. Decide:
   - `leaf`: `same-leaf` if the typed text given is the text printed on this image; `wrong-leaf` if it is other text (a neighbouring page, another passage, another book); `not-text` if the image is blank, a plate, or unreadable.
   - `boundaries`: `exact` if the typed page(s) begin and end where this image's body text begins and ends (ignore running head, page number, signature, catchword); `superset` if the typed text given contains the image's text plus more before or after (typical when the typed text is another edition with different page breaks); `partial` if the image has body text the typed text given lacks.
   - `wording`: compare at least 5 lines word by word. `same-setting` if spelling, abbreviations, punctuation and line breaks agree (ignoring long s, umlaut-e, u/v conventions); `same-text-other-setting` if the words are the same but spelling/punctuation/line division differ systematically (another edition or printing); `differs` if the text itself differs (revised text, different readings).
   - `typed_errors`: any place where the IMAGE clearly reads differently from the typed text and the typed text looks wrong (typo, dropped word). Quote up to 3 (image reading → typed reading). Empty list if none seen.
4. Write one JSON line per packet, appended to `verdicts.jsonl` in the same directory, IMMEDIATELY after each packet:
{"id":"NN","leaf":"same-leaf|wrong-leaf|not-text","boundaries":"exact|superset|partial|n/a","wording":"same-setting|same-text-other-setting|differs|n/a","image_first_line":"<as read from the image>","image_last_line":"<as read from the image>","typed_errors":["image → typed", ...],"note":"<one sentence>","read_from":"image"}

Rules: do not open any other file in the parent directories (the index holds the machine's claim and would bias you). Do not use the web. Do not edit anything except verdicts.jsonl. When all packets are done, reply with one line: counts per `leaf`, `boundaries` and `wording`.

<!-- PRIOR ART: scripts/eval/translation-vs-reference/JUDGE-PROMPT.md (#5695, a fidelity judge over text) and #5126 leaf-check instructions (job-local, never committed); none asks a blind reader to compare a page image with a typed text for edition, leaf or passage. Paths in this file are the job box scratch paths the 2026-10-06 readers were given. -->
