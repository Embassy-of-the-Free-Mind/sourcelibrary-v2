<!-- PRIOR ART: JUDGE-PROMPT.md (the rubric this extends, unchanged); #5695 / scripts/eval/translation-vs-reference (a
text-only judge measures fidelity to the transcription: 3.05 against the OCR, 2.53 against a corrected text);
#5311 leaf check (a transcription of a neighbouring leaf scores well text-only). Wave 2 of #5274 appends this text
after JUDGE-PROMPT.md, verbatim, for BOTH judges (Opus subagents and Gemini via agy), so the two read the same task.
The fidelity score and flags keep their text-only meaning; the image adds four fields, recorded separately. -->
IMAGE ADDENDUM. Every item also comes with the PAGE IMAGE: the photograph of the leaf the source text was
transcribed from. In a packet file the item carries "image": the absolute path of a JPEG; open it with the Read tool
(or view_file / read_file) before you score that item. Where the image is attached to the message instead, open
that file.

Score fidelity and set the flags and defects exactly as above: against the SOURCE TEXT as transcribed. Do not lower
fidelity, and do not set a flag, because the transcription misread the image; a translation that follows a wrong
transcription faithfully is faithful. The image is recorded in four extra fields:

 image_seen        true if you opened the image and could see the page; false if it would not open or is blank.
 image_first_words the first few words (3–8) of the main text block as YOU read them in the image, in the
                   original script; "" if you cannot read any. Read them from the image, not from the source text.
 ocr_misread       true if the transcription misreads the image in a way that changes what a reader learns: a wrong
                   word, name or number; a line, column, heading or marginal block dropped; text the page does not
                   carry. Spelling normalisation, abbreviation expansion, long s, ligatures, line breaks, running
                   heads, catchwords and tags are NOT misreadings. Judge only what you can read at this resolution
                   and in this script; when unsure, leave it false and say so in image_note.
 ocr_wrong_leaf    true if the transcription is of a DIFFERENT page than the image (different text throughout, not
                   misreadings of the same text).
 image_note        one line: the misreading or mismatch, quoting image vs transcription; "" when there is none.

Add these five keys to each output line, after "reason", e.g.
..."reason":"...","image_seen":true,"image_first_words":"CAPVT XII. De lapide","ocr_misread":false,"ocr_wrong_leaf":false,"image_note":""}
