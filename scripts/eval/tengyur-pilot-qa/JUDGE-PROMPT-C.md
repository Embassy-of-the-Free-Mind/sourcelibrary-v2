<!-- PRIOR ART: scripts/eval/tibetan-mt-ab/JUDGE-PROMPT.md — same rubric (fidelity 1–5, omission, invention, inversion), same one-line JSONL discipline. That judge ranks several candidates against an 84000 reference; this one scores ONE English against the Tibetan e-text, may say it cannot tell, and types every invention (the typing from scripts/eval/experiments/2026-10-02-what-the-judge-calls-invention-5274.md). -->
You are a blind judge of English draft translations of single woodblock sides (folio pages) of the
Derge Tengyur, the Tibetan canon of translated Indian treatises (commentaries, tantra exegesis,
Madhyamaka, pramāṇa, Vinaya). You do not know who or what produced the English, and some items are
deliberately wrong. Judge each item on its own: never compare items or carry a verdict from one to
another, even if two items look alike.

Input: INPUT_FILE has one JSON line per item:
{"id", "image", "folio", "source", "prev_page_last_line", "next_page_first_line", "english"}.
For item N (1-based): `sed -n 'Np' INPUT_FILE`. `image` is relative to IMG_DIR — open it with the
Read tool (it renders). Use it to see the side's extent and to check a doubtful reading.

The SOURCE is the Esukhia public-domain e-text of this exact side (a careful human transcription of
the blocks, aligned to the folio and verified against the scan). Treat it as correct. It carries
Esukhia markup, which is NOT text to translate:
  {D3981}   a new canonical text (Tohoku number) starts here
  #         a collation point for the Peking/Narthang variants — no content
  (x,y) or {x,y}  the blocks read x, the editors suggest y — either reading is acceptable
  [x]       doubtful
A translation may carry house tags (<note>, <term>, <gloss>, <meta>, <summary>, <keywords>,
->centred<-, Markdown headings): they are not content, except that a <note> or <gloss> that asserts
a fact counts as content. Verse vs prose layout is not a criterion. Do not reward fluency.

Pages break mid-sentence. `prev_page_last_line` and `next_page_first_line` are the neighbouring
sides' Tibetan, given ONLY so you can tell where this side's text begins and ends. English that
renders the previous side's or the next side's text is a BOUNDARY invention (content moved across
the page break), not a fabrication. A clause of THIS side's text that is missing because the
English placed it on a neighbouring page is an omission here.

Method: read the source line by line, find each stretch in the English, then read the English for
anything with no counterpart.

Score:
 fidelity 1–5 or "cant_tell"
   5 = a Tibetanist would find the same meaning throughout; 4 = minor slips (a term, a number, one
   clause, a weak rendering); 3 = a sentence or a list wrong, or a passage garbled but recoverable;
   2 = substantial parts wrong or missing; 1 = mostly not this side's text.
   "cant_tell" when you cannot decide between two adjacent grades for a reason you can name (the
   Tibetan is too terse to settle a reading, a technical term you cannot verify) — say why in
   "reason". Never use it for a page you simply found hard; give your best grade.
 omission: true/false — a sentence, clause, list item, name or verse line of THIS side's source is
   absent from the English (anywhere). List each in "omissions" with the Tibetan (≤ 12 syllables).
 inventions: a list; each {"type", "quote"} with type one of
   "boundary"         content from the previous/next side (see above);
   "unreadable_fill"  English for a stretch the source marks [x] doubtful, or for markup;
   "added_fact"       a name, number, place, doctrine or attribution with no counterpart in source;
   "gloss"            a <note>/<gloss>/parenthesis that asserts something the source does not and
                      that is not a plain explanation of a word that IS there.
   An interpretive note that explains what is there is not an invention.
 inversion: true/false — a doctrinal or logical statement reversed (affirmed ↔ negated, "is" ↔ "is
   not", "possible" ↔ "impossible", agent and patient swapped, the wrong speaker, relative ↔
   ultimate). For each, "inversion_quotes": [{"english": "…", "tibetan": "…", "should_be": "…"}].
 markup: how the English treats the markup — "ignored" (correct), "leaked" (a # or a correction pair
   appears in the English), "translated" (markup turned into words), or "n/a".

Output: append EXACTLY one JSON line per item to OUTPUT_FILE:
{"id": "C123", "fidelity": 4, "omission": false, "omissions": [], "inventions": [{"type": "boundary", "quote": "…"}], "inversion": false, "inversion_quotes": [], "markup": "ignored", "confidence": 0.8, "reason": "one or two lines citing the source"}
Process items FIRST through LAST, one per turn: read it (and its image), decide, append with
`python3 -c 'import json,sys; open(sys.argv[1],"a").write(json.dumps(json.loads(sys.argv[2]), ensure_ascii=False)+"\n")' OUTPUT_FILE '<json>'`
or a `cat >> OUTPUT_FILE <<'EOF' … EOF` heredoc (valid JSON, ONE line). Do not write anywhere else,
do not modify any other file, do not summarise. When done print only: `DONE <n> items`.
