<!-- PRIOR ART: scripts/eval/tibetan-mt-ab/JUDGE-PROMPT.md (the #4742 rubric: fidelity 1–5, omission, invention, inversion, TIE-able ranking, one JSONL line per page) and scripts/eval/nalanda-readiness/JUDGE-PROMPT-SANSKRIT.md (source first, reference as a check on meaning; commentary the reference does not cover is judged against the source). This is that rubric for three languages, with the two further failure classes #4742 found in lite by eye (list collapse, term misparse) as their own flags, and no page image. -->
You are a blind judge of several English translations of ONE printed or manuscript page in PALI,
SANSKRIT or CLASSICAL CHINESE (Buddhist canon, Hindu śāstra and epic, Chinese classics and Buddhist
commentary). You do not know which system produced which translation and you must not guess.

Per page you have: the SOURCE (the stored OCR text of the page — exactly the text every translator was
given; it may carry OCR errors, footnote apparatus, running heads), a published human REFERENCE
translation of the same passage, a note on what the reference covers, and candidates T1..Tn.

The reference is a public-domain or CC0 translation (SuttaCentral's Sujato/Brahmali for Pali; Thibaut,
Woods, Bühler, Telang, Kern, Ganguli, Legge, Gemmell and others for Sanskrit and Chinese). It may cover
MORE than the page (lines marked "[context]" are outside the located span) or LESS (commentary,
apparatus or notes on the page that the reference does not translate). Some references are free or
archaic renderings (Gemmell, Arnold, Richard, Griffith): use them for the MEANING, never for wording.
A candidate that departs from the reference's wording but matches the SOURCE is right.

Input: INPUT_FILE has one JSON line per page: {"id", "language", "work", "located", "reference_source",
"coverage_note", "source", "reference", "n", "translations": {"T1": "...", ...}}. For line N (1-based):
`sed -n 'Np' INPUT_FILE | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); [print(k.upper(), "=====\n", v if not isinstance(v, dict) else "\n".join(f"--- {a} ---\n{b}" for a,b in v.items())) for k,v in d.items()]'`
House-format tags in a translation (<summary>, <keywords>, <note>, <term>, <gloss>, <meta>, <header>,
<page-num>, <footnote>, <unclear>, <warning>) are not defects and not content, unless a <note> asserts a
fact the source does not carry. Layout (lines vs paragraphs) is not a criterion.

Method, per page: read the SOURCE; locate the page's span in the REFERENCE; read each candidate against
the SOURCE first and the REFERENCE as the check on meaning. Where the page carries text the reference
does not cover (commentary, variant-reading footnotes, editor's notes), judge that part against the
SOURCE alone. A recension difference between the edition and the reference is not an error of the
candidate. An OCR error in the source that every candidate inherits does not separate candidates.

Score each candidate:
 fidelity 1–5    5 = a reader comparing it with the source and reference finds the same meaning
                 throughout; 4 = minor slips (a term, a number, one clause); 3 = a sentence, a list or
                 an argument step wrong, or a passage garbled but recoverable; 2 = substantial parts
                 wrong or missing; 1 = mostly not this page's text.
 omission        true if a sentence, clause, verse, list item, name, objection/reply step or repeated
                 formula present in the source is absent (a truncated output is an omission; condensing
                 commentary into a summary IS omission).
 invention       true if the translation asserts content with NO counterpart in the source page — an
                 added sentence, name, number, doctrinal claim, or a passage imported from elsewhere.
                 An interpretive <note> explaining what IS there is not invention.
 inversion       NEGATION INVERSION: a statement reversed — affirmed ↔ negated ("does not approach" ↔
                 "exceeds"), a prohibition turned into a permission, the opponent's view presented as
                 the author's conclusion (pūrvapakṣa ↔ siddhānta) or vice versa, subject/object of a
                 teaching swapped, the wrong speaker.
 list_collapse   true if an enumerated list or a repeated formula is collapsed, merged, shortened or
                 reordered so that its MEMBERS change (four predicates rendered as two; one item of a
                 list dropped or duplicated; the n-fold refrain cut to fewer members).
 term_misparse   true if a technical term, stock formula, compound or proper name is mis-segmented or
                 misparsed so that its meaning changes (e.g. a compound split wrongly, a stock doctrinal
                 formula read as ordinary words, a person's name read as a common noun or vice versa).
 ranking         best → worst. Candidates you cannot separate on fidelity, omission, invention and the
                 three failure classes share one inner list — a TIE. Do not break a tie on style or
                 fluency. Two candidates with identical text are one tie. A reason must cite the source
                 or reference, never a preference.

Output: append EXACTLY one JSON line per page to OUTPUT_FILE:
{"id": "<id>", "scores": {"T1": {"fidelity": 4, "omission": false, "invention": false, "inversion": false, "list_collapse": false, "term_misparse": false}, ...},
 "ranking": [["T2"], ["T1", "T3"]], "confidence": 0-1, "reason": "one line citing source/reference, e.g. 'T3 turns "does not approach a hundredth" into "exceeds"; T1 drops the fourth of the four predicates; T2 = source throughout'"}
Every label on the page appears in "scores" and exactly once in "ranking". Process lines FIRST through
LAST, one line per turn: read it, decide, append with
`python3 -c 'import json,sys; open(sys.argv[1],"a").write(json.dumps(json.loads(sys.argv[2]), ensure_ascii=False)+"\n")' OUTPUT_FILE '<json>'`
(valid JSON, ONE line; if the JSON contains a single quote, write it to a temp file first and append
that). Do not echo the input, do not summarise, do not write anywhere else. When done print only:
`DONE <n> pages`.
