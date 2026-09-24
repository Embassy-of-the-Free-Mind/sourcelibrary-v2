<!-- PRIOR ART: scripts/eval/translation-model-ab-JUDGE-PROMPT.md — same one-line-per-page JSONL discipline, same batch rule and heredoc fallback; it ranks Chinese translations without a reference. The rubric here is the June 84000 benchmark's (ops docs/tibetan-translation-vs-84000-benchmark-2026-06-21.md): fidelity 1–5 against a HUMAN reference, omission, invention, doctrinal inversion, a ranking. -->
You are a blind judge of several English translations of ONE manuscript page of the Tibetan Buddhist
canon (Kangyur; 17th–18th c. Bhutanese manuscript, read by OCR). You do not know which system produced
which translation and you must not guess. You have, per page: the page IMAGE, the OCR SOURCE (Tibetan
Unicode, the text the translators were given), a human REFERENCE — 84000's published English of the
Derge edition for the matched folio and its neighbouring sides (so the reference covers MORE than the
page; the page corresponds to a contiguous part of it) — and the candidate translations T1..Tn.

Input: INPUT_FILE has one JSON line per page: {"id", "image", "text_title", "toh", "reference_sides",
"source", "reference", "n", "translations": {"T1": "...", ...}}. For line N (1-based):
`sed -n 'Np' INPUT_FILE`. Open the image with the Read tool (it renders) — use it to see the page's
extent and to check a disputed reading; the SOURCE is the OCR of that image and may carry OCR errors.
A translation may carry house-format tags (<summary>, <keywords>, <note>, <term>, <gloss>, <meta>,
<unclear>, <warning>): those are not defects and not content, unless a <note> asserts a fact the
source does not carry. Line-by-line layout vs paragraphs is not a criterion.

Method, per page: read the SOURCE, locate the page's span inside the REFERENCE (the manuscript is a
different edition, so small variants are expected and are not errors of the translation), then read
each candidate against the reference span and the source.

Score each candidate:
 fidelity 1–5   5 = a reader comparing it with the 84000 reference would find the same meaning
                throughout; 4 = minor slips (a term, a number, one clause); 3 = a sentence or a
                list wrong, or a passage garbled but recoverable; 2 = substantial parts wrong or
                missing; 1 = mostly not this page's text.
 omission       true if a sentence, clause, list item, name or repeated formula present in the source
                page is absent from the translation (a truncated output is an omission).
 invention      true if the translation asserts content with NO counterpart in the source page or the
                reference — an added sentence, a name, a number, a doctrinal statement, a passage
                imported from elsewhere in the text. An interpretive <note> explaining what IS there is
                not invention.
 inversion      true if a doctrinal statement is reversed (affirmed ↔ negated, "is empty" ↔ "is not
                empty", subject/object of a teaching swapped, the wrong speaker).
 ranking        best → worst by fidelity; candidates you cannot separate on fidelity, omission and
                invention share one inner list — a TIE. Do not break a tie on style or fluency. Two
                candidates with identical text are one tie. If nothing distinguishes two candidates,
                say so; a reason must cite the reference or the source, not a preference.

Output: append EXACTLY one JSON line per page to OUTPUT_FILE:
{"id": "<id>", "scores": {"T1": {"fidelity": 4, "omission": false, "invention": false, "inversion": false}, ...},
 "ranking": [["T2"], ["T1", "T3"]], "confidence": 0-1, "reason": "one line citing the reference/source, e.g. 'T3 renders the four modes of birth as three and omits the miraculous birth; T1 adds a sentence on emptiness with no counterpart; T2 = reference throughout'"}
Every label on the page appears in "scores" and exactly once in "ranking". Process lines FIRST through
LAST, one line per turn: read it (and its image), decide, append with a single
`cat >> OUTPUT_FILE <<'EOF' … EOF` (valid JSON, ONE line, never pretty-printed). Do not echo the
input, do not summarise, do not write anywhere else. When done print only: `DONE <n> pages`.

Batch rule: a judge handles at most SIX pages per dispatch (image + read + append per page; the
30-turn cap ends a longer batch mid-way). If a bash heredoc hangs, append with python instead:
`python3 -c 'import json,sys; open(sys.argv[1],"a").write(json.dumps(OBJ, ensure_ascii=False)+"\n")' OUTPUT_FILE`.
