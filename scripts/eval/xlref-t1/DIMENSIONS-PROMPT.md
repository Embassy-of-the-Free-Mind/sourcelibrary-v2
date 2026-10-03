<!-- PRIOR ART: scripts/eval/translation-vs-reference/JUDGE-PROMPT.md scores FIDELITY only, by design ("fluency and style are not criteria"). #5695 addendum B asks for a SEPARATE pass, after fidelity, over five more named dimensions and a stance label, scoring OUR English and the REFERENCE on the same rubric in every track. Fidelity is copied from the fidelity pass, never re-scored here. -->
You are reading two English translations of ONE page of a historical Latin book: `A` and `B`. One is a published
human translation, the other is a machine translation; the item tells you which is which only through the fields
`a_kind` / `b_kind` ("published" or "machine") — this is NOT a blind test of who is better, it is a profile of two
different translations. `source` is the page's Latin (an OCR transcription; it may carry OCR errors).
`reference_year` and `reference_style` describe the published translation.

Input: INPUT_FILE has one JSON line per item. Read it once with the Read tool.

Score EACH of A and B 1–5 on these five dimensions (5 = excellent, 3 = adequate with clear weaknesses, 1 = fails):
 readability   a non-specialist modern reader can follow it without the source (archaic spelling alone is not a
               failure of readability if the sense is clear; a crib that needs the Latin to make sense is)
 register      keeps the genre and voice: verse stays verse-like, liturgy liturgical, technical prose technical,
               polemic sharp, dialogue alive, scholastic argument articulated
 terminology   technical terms (alchemical, medical, scholastic, legal, botanical…) rendered consistently and
               recognisably; key terms kept or glossed, not flattened into everyday words or modernised out of
               their period meaning
 ambiguity     keeps deliberate ambiguity or polysemy of the source open rather than silently resolving it (if the
               page has none worth keeping, score 5 unless the translation INTRODUCES a false precision)
 transparency  additions, uncertainty and choices are flagged (notes, brackets); nothing silently added or dropped.
               Silent omission or silent expansion lowers this; a flagged gloss does not.

Also, per translation, `stance`: "literal" (a crib for study, follows the Latin's order and words) | "balanced" |
"free" (a reading translation that recasts sentences).

Per item also:
 disagreements  up to 3 places where A and B give a DIFFERENT MEANING for the same Latin (not style). For each:
                {"latin": "≤ 12 words of the source", "a": "≤ 12 words", "b": "≤ 12 words",
                 "right": "A" | "B" | "both_defensible" | "neither" | "cant_tell", "why": one line}.
                Judge against the Latin, not against which one is published. Empty list if none.
 legit_choice   true if A and B differ mainly by a LEGITIMATE difference of translation choice (e.g. literal vs
                free, keeping vs explaining a term, early-modern idiom vs modern), so that the page is a good example
                for a discussion of translation principles rather than of errors; else false.
 legit_note     one line, if legit_choice is true, naming the choice each made.

QUOTES: never quote more than 12 consecutive words of either translation.

Output: EXACTLY one JSON line per item, in input order, to OUTPUT_FILE:
{"id":"…","A":{"readability":4,"register":3,"terminology":4,"ambiguity":5,"transparency":3,"stance":"literal"},
 "B":{…},"disagreements":[…],"legit_choice":false,"legit_note":"","reason":"one line"}
Write the whole file in ONE Write call (valid JSON per line). Do not write anywhere else. When done print only
`DONE <n> items`.
