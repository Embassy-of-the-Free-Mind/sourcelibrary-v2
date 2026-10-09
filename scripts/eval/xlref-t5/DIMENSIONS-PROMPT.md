<!-- PRIOR ART: scripts/eval/translation-vs-reference/JUDGE-PROMPT.md scores fidelity, omission, invention and reversal — accuracy only. #5695 Addendum B asks for a SEPARATE pass on five further dimensions plus stance, with a rubric fixed across the five tracks; this is that pass for T5 (fidelity is copied from the harness, never re-scored here). -->
You are assessing two English translations, X and Y, of ONE page of a historical book (Pali, Sanskrit or classical
Chinese). You do not know who or what produced either; do not guess. Per item you have `source` (an OCR
transcription of the page), and `X`, `Y`. One of them may cover a little more or less than the page; ignore extent.
Translations may carry house tags (<summary>, <keywords>, <note>, <term>, <gloss>, <meta>…): treat <note>/<gloss>
and brackets as the translator's apparatus (they matter for "transparency"), ignore <summary>/<keywords>/<meta>.

Do NOT score fidelity (accuracy of meaning) — it has been scored elsewhere. Score each of X and Y, 1–5, on exactly:
 readability    a non-specialist can follow it without the source (5 = reads easily; 1 = impenetrable)
 register       keeps the genre's voice: verse stays verse-like, liturgy liturgical, technical prose technical,
                polemic sharp, narrative lively (5 = the genre is unmistakable; 1 = flattened or wrong voice)
 terminology    technical terms rendered consistently and recognisably; key terms kept or glossed, not flattened
                into everyday words (5 = a specialist can map every term back; 1 = terms lost)
 ambiguity      keeps deliberate ambiguity or polysemy open rather than silently resolving it (5 = open where the
                source is open; 3 = nothing notable either way; 1 = repeatedly forces one reading)
 transparency   additions, uncertainty and choices are flagged (notes, brackets); nothing silently added or dropped
                (5 = every intervention visible; 1 = silent expansion/compression)
and label each one's
 stance         "literal" (a crib for study) | "balanced" | "free" (a reading translation)

Per item also:
 disagreement   where X and Y differ in MEANING on a point you can check against the source, who is right:
                "X" | "Y" | "both_defensible" | "none" (no meaningful difference) | "cant_tell"; with `point`: one line
                quoting ≤ 12 words of each and the source words.
 different_choice  true if X and Y make DIFFERENT but both LEGITIMATE translation choices worth showing side by
                side (e.g. literal vs free, term kept vs translated, verse vs prose); `choice_note`: one line.

QUOTES: never quote more than 12 consecutive words of X or Y. Output EXACTLY one JSON line per item, input order, to
OUTPUT_FILE in ONE Write call:
{"id":"…","X":{"readability":4,"register":3,"terminology":4,"ambiguity":3,"transparency":4,"stance":"balanced"},"Y":{…},"disagreement":{"who":"both_defensible","point":"…"},"different_choice":true,"choice_note":"…","confidence":0.7}
Read INPUT_FILE once with the Read tool. Do not look for other files. When done print only: DONE <n> items.
