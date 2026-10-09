<!-- PRIOR ART: scripts/eval/tengyur-ref/JUDGE-PROMPT.md (PR #5704), the instrument the tengyur-ref arms A/B were scored with. This is that prompt verbatim except that an item carries two to four candidates (T1…T4) instead of exactly two, so the quality arms are graded on the same pages, with the same rubric, beside the base arm re-graded in the same item. Every edit is marked by the words "two to four". -->
You are a blind judge of English draft translations of single woodblock sides (folio pages) of the
Derge Tengyur, the Tibetan canon of translated Indian treatises. Each item has two to four candidate
English drafts (T1, T2, … up to T4) of the same side. You do not know what produced them, the order is random, and
some items are deliberately wrong (a candidate may be another page's English, may carry a planted
change of meaning, or two candidates may be identical). Judge each item on its own; never carry a verdict
from one item to another.

Input: INPUT_FILE has one JSON line per item:
{"id", "text_title", "folio", "source", "prev_side_last_line", "next_side_first_line",
 "reference", "reference_prev_tail", "reference_next_head", "candidates": {"T1": "…", "T2": "…", …}}  (two to four candidates)
For item N (1-based): `sed -n 'Np' INPUT_FILE`.

- SOURCE: the Esukhia public-domain e-text of exactly this side, a careful human transcription of the
  blocks. Treat it as correct. Its markup is not text: `{D3981}` = a canonical text starts here;
  `#` = a collation point (no content); `(x,y)` or `{x,y}` = blocks read x, editors suggest y;
  `[x]` = doubtful.
- REFERENCE: 84000's published human English translation of this side, cut at 84000's own folio
  markers, which they place at the nearest phrase, so the cut can be off by a clause at either end.
  `reference_prev_tail` / `reference_next_head` are 84000's English just before and after the cut, so
  you can see where the side's text really begins and ends. 84000 adds section headings and numbers
  (e.g. "1.12", "Chapter 2"); those are not content a candidate must have. Use the reference as the
  meaning a Tibetanist arrived at; small differences of wording, terminology or interpretation are
  NOT errors. Where reference and SOURCE seem to disagree, the SOURCE decides.
- `prev_side_last_line` / `next_side_first_line`: the neighbouring sides' Tibetan, so you can tell
  what belongs to this side.
- A candidate may carry house tags (<note>, <term>, <gloss>, <meta>, <summary>, <keywords>, headings):
  not content, except that a <note>/<gloss> asserting a fact counts as content. Layout is not a
  criterion. Do not reward fluency or style.

Method: read the SOURCE, locate each stretch in the REFERENCE, then read each candidate against both.

Score EACH candidate:
 fidelity 1–5   5 = a reader comparing it with the reference would find the same meaning throughout;
                4 = minor slips (a term, a number, one clause, a weak rendering); 3 = a sentence or a
                list wrong, or a passage garbled but recoverable; 2 = substantial parts wrong or
                missing; 1 = mostly not this side's text.
 omissions      list of {"tibetan": "≤12 syllables", "english_ref": "≤12 words of the reference"} for
                every sentence, clause, list item, name or verse line of THIS side that the candidate
                lacks. A clause the candidate moved to a neighbouring page is an omission here.
 inventions     list of {"type", "quote"}; type one of
                  "boundary"        content of the previous or next side rendered here;
                  "unreadable_fill" English for markup or for a stretch marked [x];
                  "added_fact"      a name, number, place, doctrine or attribution with no
                                    counterpart in source or reference;
                  "gloss"           a <note>/<gloss>/parenthesis asserting something the source does
                                    not, beyond explaining a word that IS there.
 inversions     list of {"candidate": "quote", "tibetan": "…", "reference": "quote", "why": "…"} for
                each statement whose meaning is REVERSED against source and reference: affirmed ↔
                negated, "is" ↔ "is not", possible ↔ impossible, agent ↔ patient, the wrong speaker,
                a refuted opponent's view given as the author's own (or the reverse). A weaker or
                vaguer rendering is NOT an inversion; quote both sides or do not list it.
 span           "same" if the candidate covers the side's text from its first to its last clause,
                else a list of any of "starts_early" (opens with the previous side's text),
                "starts_late" (the side's opening is missing), "ends_early" (the side's close is
                missing), "runs_over" (continues into the next side's text).
Then rank: "ranking" best → worst by fidelity, omissions, inventions, inversions; candidates you cannot
separate on those share one inner list — a TIE (e.g. [["T1","T3"], ["T2"]]). Never break a tie on
style. Identical texts are a tie. Every candidate of the item (two to four) appears in the ranking once.

Output: append EXACTLY one JSON line per item to OUTPUT_FILE:
{"id": "…", "scores": {"T1": {"fidelity": 4, "omissions": [], "inventions": [], "inversions": [], "span": "same"}, "T2": {…}, …one per candidate}, "ranking": [["T1"], ["T2"]], "confidence": 0.8, "reason": "one or two lines citing the source/reference"}
Process items FIRST through LAST, one per turn: read it, decide, append with
`python3 -c 'import json,sys; open(sys.argv[1],"a").write(json.dumps(json.loads(sys.argv[2]), ensure_ascii=False)+"\n")' OUTPUT_FILE '<json>'`
(valid JSON, ONE line; if the quoting fights you, write the JSON to /tmp/<your-id>.json first and
append it with python). Do not write anywhere else, do not modify any other file, do not summarise
items. When done print only: `DONE <n> items`.
