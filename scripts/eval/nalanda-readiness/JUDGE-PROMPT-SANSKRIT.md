<!-- PRIOR ART: scripts/eval/tibetan-mt-ab/JUDGE-PROMPT.md — same rubric (fidelity 1-5, omission, invention, inversion, TIE-able ranking); adapted to Sanskrit śāstra with commentary and public-domain references (Woods, Thibaut, Bühler). -->
You are a blind judge of English translations of ONE printed page of a Sanskrit text (a classical
śāstra with commentaries: Yoga-sūtra with bhāṣya, Śaṅkara's Brahmasūtra-bhāṣya, or the Manusmṛti with
commentaries). You do not know which system produced which translation and you must not guess.

Per page you have: the SOURCE (Devanagari OCR of the page — the text the translator was given; it is
accurate to roughly 1 character in 100 on the root text), a published human REFERENCE translation of the
same passage (Woods 1914 / Thibaut 1890–96 / Bühler 1886 — public domain; it may cover MORE or LESS
than the page: for the Manusmṛti it translates only the ROOT VERSES, never the commentaries), and
candidate translations T1..Tn.

Input: INPUT_FILE has one JSON line per page: {"id", "work", "reference_note", "source", "reference",
"translations": {"T1": "...", ...}}. For line N (1-based): `sed -n 'Np' INPUT_FILE | python3 -c
'import json,sys; d=json.loads(sys.stdin.read()); [print(k.upper(), "=====\n", v if not isinstance(v, dict) else "\n".join(f"--- {a} ---\n{b}" for a,b in v.items())) for k,v in d.items()]'`.
House-format tags in a translation (<summary>, <keywords>, <note>, <term>, <gloss>, <meta>, <header>,
<page-num>) are not defects and not content, unless a <note> asserts a fact the source does not carry.

Method: read the SOURCE; locate the page's span inside the REFERENCE; judge each candidate against
the SOURCE first and the REFERENCE as a check on meaning. Where the reference renders a technical
term differently (e.g. "concentration" vs "samādhi"), that is not an error. Where the page carries
commentary the reference does not translate, judge that part against the SOURCE alone. Small
differences of recension between the edition and the reference are not errors of the candidate.

Score each candidate:
 fidelity 1–5   5 = a reader comparing it with the source and reference would find the same meaning
                throughout; 4 = minor slips (a term, a number, one clause); 3 = a sentence or an
                argument step wrong, or a passage garbled but recoverable; 2 = substantial parts wrong
                or missing; 1 = mostly not this page's text.
 omission       true if a sentence, clause, verse, objection/reply step or quoted authority present
                in the source page is absent (a truncated output is an omission). Condensing the
                commentary into a summary IS omission.
 invention      true if the translation asserts content with NO counterpart in the source page — an
                added sentence, a name, a number, a doctrinal claim, a passage imported from elsewhere.
 inversion      true if a claim is reversed (affirmed ↔ negated; the opponent's view (pūrvapakṣa)
                presented as the author's conclusion (siddhānta) or vice versa; subject/object swapped).
 ranking        best → worst; candidates you cannot separate on fidelity, omission and invention share
                one inner list — a TIE. Never break a tie on style or fluency.

Output: append EXACTLY one JSON line per page to OUTPUT_FILE:
{"id": "<id>", "scores": {"T1": {"fidelity": 4, "omission": false, "invention": false, "inversion": false}, ...},
 "ranking": [["T1"], ["T2"]], "confidence": 0-1, "reason": "one line citing source/reference, e.g. 'T1 renders
 the pūrvapakṣa as Śaṅkara's view at sūtra 2.2.26; T2 = reference throughout'"}
Every label appears in "scores" and exactly once in "ranking". Process lines FIRST through LAST, one
line per turn: read it, decide, append with
`python3 -c 'import json,sys; open(sys.argv[1],"a").write(json.dumps(json.loads(sys.argv[2]), ensure_ascii=False)+"\n")' OUTPUT_FILE '<json>'`
(valid JSON, ONE line). Do not echo the input, do not summarise, do not write anywhere else. When done
print only: `DONE <n> pages`.
