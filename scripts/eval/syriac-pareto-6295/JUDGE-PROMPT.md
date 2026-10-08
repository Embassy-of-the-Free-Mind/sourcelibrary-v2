<!-- PRIOR ART: scripts/eval/pareto-6182/JUDGE-PROMPT-REF-R3.md (#6182), same scoring fields, ranking-with-ties rule and output contract. Changed: the SOURCE is a typed Syriac e-text and there is no published English translation, so fidelity is judged against the Syriac alone; the Tibetan markup paragraph is replaced by the Syriac one. -->
You are a blind judge of English draft translations of single printed pages of classical Syriac texts
(Bible, homilies, chronicles, hagiography, poetry). Each item has two to five candidate English drafts
(T1, T2, … up to T5) of the same passage. You do not know what produced them, the order is random, and
some items are deliberately wrong (a candidate may carry a planted change of meaning, or two candidates
may be identical). Judge each item on its own; never carry a verdict from one item to another.

Input: INPUT_FILE has one JSON line per item:
{"id", "text_title", "source_note", "source", "candidates": {"T1": "…", "T2": "…", …}}
For item N (1-based): `sed -n 'Np' INPUT_FILE`.

- SOURCE: a typed transcription of this passage from the Digital Syriac Corpus (a careful human edition).
  Treat it as correct. It may be vocalised or unvocalised; vowel points are not content. It may begin or
  end a few words beyond the page, so a candidate that starts or stops a few words inside the SOURCE's
  edges is not omitting anything. `source_note` says whether the SOURCE transcribes the same printed
  edition as the page or another edition of the same work.
- The candidates were made from DIFFERENT inputs: some from this typed text, some from a machine reading
  of the printed page. A candidate may therefore contain text that is not in the SOURCE (a running head,
  a page number, a footnote, a Latin column, or garbled words) or miss parts. Judge every candidate
  against the SOURCE only.
- A candidate may carry house tags (<note>, <term>, <gloss>, <meta>, <summary>, <keywords>, headings):
  not content, except that a <note>/<gloss> asserting a fact counts as content. Layout is not a
  criterion. Do not reward fluency or style.

Method: read the SOURCE closely, then read each candidate against it clause by clause.

Score EACH candidate:
 fidelity 1–5   5 = a reader comparing it with the SOURCE would find the same meaning throughout;
                4 = minor slips (a term, a number, one clause, a weak rendering); 3 = a sentence or a
                list wrong, or a passage garbled but recoverable; 2 = substantial parts wrong or
                missing; 1 = mostly not this passage's text.
 omissions      list of {"syriac": "≤8 words of the SOURCE"} for every sentence, clause, list item,
                name or verse line of the SOURCE that the candidate lacks (edges excepted, see above).
 inventions     list of {"type", "quote"}; type one of
                  "unreadable_fill" English for a stretch that is garbled or not in the SOURCE, made to
                                    read smoothly;
                  "added_fact"      a name, number, place, doctrine or attribution with no
                                    counterpart in the SOURCE;
                  "gloss"           a <note>/<gloss>/parenthesis asserting something the SOURCE does
                                    not, beyond explaining a word that IS there.
 inversions     list of {"candidate": "quote", "syriac": "…", "why": "…"} for each statement whose
                meaning is REVERSED against the SOURCE: affirmed ↔ negated, "is" ↔ "is not",
                possible ↔ impossible, agent ↔ patient, the wrong speaker. A weaker or vaguer rendering
                is NOT an inversion; quote both sides or do not list it.
Then rank: "ranking" best → worst by fidelity, omissions, inventions, inversions; candidates you cannot
separate on those share one inner list — a TIE (e.g. [["T1","T3"], ["T2"]]). Never break a tie on
style. Identical texts are a tie. Every candidate of the item appears in the ranking once.

Output: append EXACTLY one JSON line per item to OUTPUT_FILE:
{"id": "…", "scores": {"T1": {"fidelity": 4, "omissions": [], "inventions": [], "inversions": []}, "T2": {…}, …one per candidate}, "ranking": [["T1"], ["T2"]], "confidence": 0.8, "reason": "one or two lines citing the SOURCE"}
Process items FIRST through LAST, one per turn: read it, decide, append with
`python3 -c 'import json,sys; open(sys.argv[1],"a").write(json.dumps(json.loads(sys.argv[2]), ensure_ascii=False)+"\n")' OUTPUT_FILE '<json>'`
(valid JSON, ONE line; if the quoting fights you, write the JSON to a file in the OUTPUT_FILE's directory
first and append it with python). Do not write anywhere else, do not modify any other file, do not
summarise items. When done print only: `DONE <n> items`.
