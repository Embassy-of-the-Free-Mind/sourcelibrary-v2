<!-- PRIOR ART: scripts/eval/experiments/2026-10-02-note-facts-full-tibetan-run-5624.md — the #5624 method, unchanged: classes correct / wrong / partly-wrong / unverifiable / no-claim, a source URL fetched in THIS session for every correct/wrong/partly-wrong verdict, planted known-wrong seeds per batch. Its wave-2 line ("correct requires a page fetched in this session") is kept. -->
You are fact-checking the translator's notes (<note>…</note>) that a machine translation added to
English drafts of the Derge Tengyur (Tibetan canon of translated Indian treatises). A note that adds
a fact is fine unless the fact is WRONG. You check facts, not style.

Input: INPUT_FILE is a JSON array. Each row: {"cid", "vol", "note", "context_before",
"context_after", "tibetan_source_of_page"}. The note sits between context_before and context_after
in the English. tibetan_source_of_page is the Tibetan of the whole page (Esukhia e-text; `#` and
`{x,y}` are editorial markup) — use it to see WHICH Tibetan word the note is about.

For each row:
1. State the checkable claim(s) the note makes: a Sanskrit equivalent of a Tibetan term, an
   identification (who, which text, which school, which chapter), an attribution, a date. A bare
   transliteration of the Tibetan ("original: dkā thub"), a paraphrase, or a vague gloss is
   "no-claim". A note may make two claims; give each its own row.
2. Check each claim against an external source FETCHED IN THIS SESSION: the 84000 glossary or
   translations (84000.co / read.84000.co), Treasury of Lives (treasuryoflives.org), the Rangjung
   Yeshe wiki (rywiki.tsadra.org), the Rigpa wiki (rigpawiki.org), Wikipedia, or a standard
   dictionary page (e.g. Monier-Williams at sanskritdictionary.com / cologne-scholar). Load the web
   tools with ToolSearch ("select:WebFetch,WebSearch") first. General knowledge is not a source:
   "correct" requires a page you fetched that supports it.
3. Verdict per claim:
   correct        the source supports it (an accepted equivalent, even if not the only one);
   wrong          the source contradicts it (wrong equivalent, wrong person, wrong school/date);
   partly-wrong   one part right, another wrong (e.g. right person, wrong century);
   unverifiable   you could not find a source either way (never counts as correct);
   no-claim       nothing checkable.
   Also mark "ocr_or_source_driven": true if the error follows a misreading of the Tibetan
   rather than a wrong fact about the right word.

Output: write a JSON array to OUTPUT_FILE with one object per claim:
{"cid", "claim", "verdict", "correction" (if wrong/partly-wrong, else null), "source_url"
(required for correct/wrong/partly-wrong), "evidence" (≤ 25 words quoted or paraphrased from the
source), "ocr_or_source_driven": false, "tool_calls_used": n}
Write the file once at the end with python (json.dump, ensure_ascii=False). Do not write anywhere
else, do not open any other file under /root. Print only: `DONE <rows> rows, <wrong> wrong`.
