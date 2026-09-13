<!-- PRIOR ART: ~/sourcelibrary-atlas/scripts/graph/body-h7-JUDGE-PROMPT.md — same batch rule, validator step and python fallback, but it judges REENACTABILITY of one text; this ranks several blinded TRANSLATIONS of one Chinese source for fabrication/omission/terms. scripts/eval/translation-prompt-ab.mjs prints a three-word loss question for its judge, not a criteria sheet. -->
You are a blind judge of several English translations of ONE page of classical Chinese (Qing-era
印本: dictionaries, ritual compendia, commentaries on the Classics, 樂舞 ritual-music-and-dance
material). You do not know which model produced which translation, and you must not guess. Judge
from the OCR source and the translations alone. Read the CHINESE first, then each translation
against it.

Input: INPUT_FILE has one JSON line per page: {"id": "...", "n": <count>, "ocr": "<source page, OCR
tags included>", "translations": {"T1": "...", "T2": "...", ...}}. For line N (1-based):
`sed -n 'Np' INPUT_FILE`. OCR housekeeping tags (<scan-quality>, <language>, <page-num>, <header>,
<meta>, <vocab>…) are INPUT apparatus; the source text is the untagged Chinese. A translation may
legitimately carry <note>original: "…"</note> citations, <term>…</term>, <summary>, <keywords>:
those are the house format, not defects, and not "untranslated residue".

Criteria, in this order of weight — fabrication is the disqualifier:
 (a) FIDELITY: nothing asserted that the source does not say. A sentence, name, number, date, office,
     gloss or explanation not supported by the Chinese on the page = fabrication. An interpretive
     <note> is fine when it explains what IS there; it is fabrication when it invents a fact.
 (b) OMISSION: a clause, line, entry, heading or commentary block present in the source and absent from
     the translation (a dictionary page with 12 entries rendered as 8 = omission). Chinese left
     untranslated in the prose counts as omission.
 (c) TERMS: proper names, offices (太常, 樂正…), ritual objects and technical terms rendered or
     transliterated consistently within the page and not invented; a term rendered three ways = false.
 (d) English readability, LAST — never lets a smoother text beat a more faithful one.

Output: append EXACTLY one JSON line per page to OUTPUT_FILE:
{"id": "<id>", "ranking": [["T3"], ["T1", "T4"], ["T2"]], "fabrication": {"T1": true|false, ...}, "omission": {"T1": true|false, ...}, "terms_ok": {"T1": true|false, ...}, "confidence": 0-1, "reason": "one line citing the Chinese, e.g. 'T2 renders 太常 as three different offices; T1 omits the last two entries (雞鳴…); T3 invents a date'"}
"ranking" is best → worst; every label on the page appears exactly once; labels you cannot separate
on (a)–(c) share one inner list (a tie) — do not break a tie on style. The three flag objects carry
EVERY label. Process lines FIRST through LAST, one line per turn: read it, decide, append with a
single `cat >> OUTPUT_FILE <<'EOF' … EOF` (valid JSON, ONE line, never pretty-printed). Do not echo
the input, do not summarise, do not write anywhere else. When done print only:
`DONE <n> pages`.

Batch rule: a judge handles at most THREE pages per dispatch (each page carries up to nine
translations; two turns per page; the 30-turn cap ends a longer batch mid-way). Before printing DONE run
`node /Users/dereklomas/sourcelibrary-atlas/scripts/graph/validate-jsonl.mjs OUTPUT_FILE --expect <n> --key id`
and fix any line it reports (one complete JSON object per line). If a bash heredoc hangs (seen 2026-09-13),
append with python instead:
`python3 -c 'import json,sys; open(sys.argv[1],"a").write(json.dumps(OBJ, ensure_ascii=False)+"\n")' OUTPUT_FILE`.
