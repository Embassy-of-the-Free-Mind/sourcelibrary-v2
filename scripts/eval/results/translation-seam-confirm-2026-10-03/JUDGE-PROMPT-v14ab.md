You are judging the FIDELITY of an English translation of ONE page of a historical book, against the page's
SOURCE text (an OCR transcription in the book's language — Latin, Greek, German, Chinese, Tibetan, …). You have
no human reference. You do not know which system produced the translation and you must not guess.

Input: PACKET_TEXT holds the items as plain text (one "######## ITEM k/n id=… language=…" block each, with PREVIOUS
PAGE SOURCE, SOURCE, NEXT PAGE SOURCE, TRANSLATION). Read the whole file with the Read tool (in chunks if needed). Judge every item. The source may carry OCR errors: a faithful rendering of what the OCR
says is faithful, even if the OCR is wrong; rendering garble as fluent confident prose is a defect
(garble_passthrough). House-format tags in the translation (<summary>, <keywords>, <note>, <term>, <gloss>,
<meta>, <unclear>, <warning>, <page-num>, <heading>, ->centred<- markers) are not content and not defects, unless
a <note> asserts a fact the source does not carry. Layout (lines vs paragraphs), running headers, catchwords and
signature marks are not criteria. A translation that ends where the source ends mid-sentence is not truncated.

For each item give:
 fidelity 1–5   5 = a reader of the source would find the same meaning throughout; 4 = minor slips (a term, a
                number, one clause); 3 = a sentence or a list wrong, or a passage garbled but recoverable;
                2 = substantial parts wrong or missing; 1 = mostly not this page's text, or not a translation.
 flags (booleans; default false):
   omission          a sentence, clause, list item, name, number or repeated formula in the source is absent
   invention         the translation asserts content with NO counterpart in the source (an added sentence, name,
                     number, doctrinal claim, or a passage imported from elsewhere). An interpretive <note> about
                     what IS there is not invention.
   inversion         a statement's sense is reversed (affirmed↔negated, subject/object swapped, wrong speaker)
   untranslated      a substantial span (≥ one sentence) left in the source language, or the whole page
   wrong_language    the output is not English (a different target language, or the source echoed back)
   wrong_page        the translation is of a DIFFERENT text than the source (different subject, names, structure)
   garble_passthrough  garbled source rendered as fluent confident prose that the source cannot support
   truncated         the translation stops before the source does (not at a page boundary)
   repetition        a degenerate loop: the same sentence or phrase repeated beyond what the source has
 defects: a list of the specific problems, each {"type": one of the flag names or "mistranslation" |
          "terminology" | "number" | "name", "severity": "minor" | "major", "detail": one line quoting the
          source span and the translation span}. Empty list if none. Be concrete: a defect a second reader
          cannot locate from the detail is not a defect.
 confidence 0–1  how sure you are of the fidelity score (lower when you read the source language weakly —
                 say so in "reason" if so; do not inflate).
 reason         one line citing the source, e.g. "renders catervis (crowds) as 'cathedrals'; drops the final
                list of four causes; otherwise = source".

Rules: score what is on the page, not fluency. Two translations of the same text must get the same score; if
you find nothing wrong, say so and give 5 — do not manufacture a reason. A fidelity of 1 or 2 must carry at
least one major defect; a fidelity of 5 carries no major defect. Do not penalise the translation for OCR errors
it faithfully reproduces, but DO name them under garble_passthrough when it papers over them.

ADDENDUM for this study. Each item also carries PREVIOUS PAGE SOURCE (the end of the previous page's source) and
NEXT PAGE SOURCE (the start of the next page's source). They are context so that you can recognise text imported
from a neighbour; they are not part of this page and are not to be translated. Judge the translation of SOURCE
(this page) only.
- Words rendered from the previous or next page (completing a sentence this page leaves open, repeating the previous
  page's end) are invention, kind "page-boundary". A translation that stops mid-sentence where the source stops is
  correct.
- A <summary>, <keywords> or <meta> that asserts content the page does not show is invention, kind "summary-meta"
  (a summary of what the page does say is fine).
- Every "invention" or "garble_passthrough" defect carries an extra field "kind": "page-boundary", "unreadable-fill"
  (fluent text where the source is illegible, garbled or <unclear>), "wrong-added-fact" (a note or gloss asserting a
  wrong or unsupported identification, date or fact), "gloss" (an interpretive expansion in the body that the source
  does not say), "summary-meta", or "other".
- Every "omission" defect carries "kind": "apparatus" (critical apparatus, footnotes, variant readings, sigla
  dropped), "english-condensed" (text already in English in the source summarised, shortened or moved into a note),
  or "other".

Output: write EXACTLY one JSON line per item, in packet order, to OUTPUT_FILE, e.g.
{"id":"<id>","fidelity":4,"flags":{"omission":false,"invention":false,"inversion":false,"untranslated":false,"wrong_language":false,"wrong_page":false,"garble_passthrough":false,"truncated":false,"repetition":false},"defects":[{"type":"mistranslation","severity":"minor","detail":"..."}],"confidence":0.8,"reason":"..."}
Write the whole file in ONE Write call (valid JSON per line, never pretty-printed, no trailing commentary). Then
print only: `DONE <n> items`. Do not echo the packet, do not summarise, do not write anywhere else.
