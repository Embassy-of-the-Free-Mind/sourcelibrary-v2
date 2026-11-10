PRIOR ART: scripts/eval/enrich-from-page-summaries-8512.mjs (pack writes the packets this prompt reads; the #8512
judge was run from the experiment file's rubric and its prompt was not committed, so this is that rubric written
down, unchanged: unsupported/wrong claims per summary with the pages checked, specificity 1-5, chapter completeness
1-5 against the headings, preference). Used for #8521 (arm C, sampled text) with `{OUTPUTS}`, `{TEXT}`, `{VERDICT}`
filled in per book; one blind Opus Agent call per book.

---

You are judging two machine-written reference apparatuses (a book summary and a chapter list) for one digitized
historical book in a reading library. They are labelled X and Y. You do not know how either was made; do not guess.

Files:
- `{OUTPUTS}`: JSON with `book` (title, author, language, pages), `X` and `Y` (each: `summary` with brief, abstract,
  detailed and section summaries with page ranges; `chapters`: "p.N [Lk] title" lines), and `headings` (the headings a
  detector found in the English text, with pages; the source of truth for chapter completeness).
- `{TEXT}`: the book's whole English text, page by page, each page headed `[Page N]`. This is the ground truth. It is
  long: read it with the Read tool in parts (offset/limit), and search it with Grep for names, numbers and phrases.

Do this:
1. For EACH of X and Y, read every sentence of the summary prose (brief, abstract, detailed, section summaries) and
   list every claim that is unsupported by the text or wrong: an invented fact, a wrong name, number, count, date or
   attribution, a detail placed in the wrong part of the book or said by the wrong person, a characterisation the text
   contradicts, a claim about the book as a whole ("the earliest", "concludes with", "throughout") the text does not
   bear out. Check each specific claim against the text (Grep is cheap). Do not count style, emphasis, vagueness or
   omissions as unsupported claims; count only what is false or not in the text. For each claim give the arm, the
   claim (short quote), what the text says, and the page(s) you checked.
2. Specificity 1-5 for each summary: 5 = names the book's actual people, works, arguments and structure; 1 = generic
   prose that could describe many books.
3. Chapter completeness 1-5 for each chapter list against `headings` and the text: 5 = the book's real divisions,
   right pages, nothing invented; 1 = missing most divisions or wrong pages.
4. Preference: which apparatus would you rather a reader of this book got, X, Y or tie? Accuracy first, then
   specificity, then chapters.

Write ONLY this JSON to `{VERDICT}` with the Write tool, then reply with the one line `done`:
{"unsupported": {"X": [{"claim": "...", "text_says": "...", "pages": "..."}], "Y": [...]},
 "specificity": {"X": n, "Y": n}, "chapters": {"X": n, "Y": n}, "preference": "X"|"Y"|"tie", "why": "two sentences"}
