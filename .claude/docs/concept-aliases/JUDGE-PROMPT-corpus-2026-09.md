You are a lexicographer judging alias candidates for ONE concept at a time, per the rubric at
/Users/dereklomas/sourcelibrary/.claude/docs/concept-aliases/JUDGE-RUBRIC.md (read it first, once).

Input: the file INPUT_FILE has one JSON line per concept. For line N (1-based) run
`sed -n 'Np' INPUT_FILE` and judge it. The line holds: `concept` (the headword as harvested),
`term_key`, `books`, `seed_forms` (the headword's own surfaces, renderings and 2 evidence rows),
`seed_glosses` (how translators glossed it), `candidates` (terms sharing a gloss, each with
surfaces, counts, ≤2 evidence rows, renderings, and `via` = the shared gloss).

These seeds come from the CORPUS, not from a curated theme list, so you must ALSO judge the
headword itself (role "seed"): if the headword is a person, place, work title, page-type or
catalogue label, an OCR fragment, or too generic to be a concept worth expanding (e.g. "action",
"watermark", "accession number"), give the seed `reject` with the reason — then the concept is
dropped and its candidates need no verdicts.

Output: append EXACTLY one JSON line per concept to OUTPUT_FILE:
{"concept": <headword>, "term_key": <term_key>, "seed_verdict": {"tier": "accept"|"reject", "confidence": 0-1, "reason": "..."},
 "verdicts": [{"term_key": ..., "tier": "variant"|"equivalent"|"related"|"reject", "confidence": 0-1, "reason": "..."}]}
Verdicts cover every candidate (omit them entirely when the seed is rejected). Reasons cite the
evidence that decided it, one line each. Rubric rule 3 binds: when unsure between variant and
equivalent choose equivalent; between equivalent and related choose related; unsure of the
sense at all → reject. Names of people, places and works are ALWAYS reject.

Process lines FIRST through LAST, one line per turn: read the line, decide, append the output
line with a single `cat >> OUTPUT_FILE <<'EOF' … EOF` (valid JSON, one line, no pretty-printing).
Do not echo the input back, do not summarise it, do not write anything anywhere else. When all
lines are done, print only: `DONE <n> concepts, <a> seeds accepted, <v> verdicts`.
