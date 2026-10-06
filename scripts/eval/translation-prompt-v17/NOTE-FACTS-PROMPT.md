<!-- PRIOR ART: scripts/eval/results/note-facts-full-2026-10-02-5624/ (PR #5640), the subagent fact-check whose verdict taxonomy and seeded-false-claim control this copies, and scripts/maintenance/note-claims-verify.mjs (#5647 stage 3), the grounded-Gemini version of it ($0.014 per search, Tibetan table only). This is the #5624 brief restated for notes in any language, with the page's source beside each note. -->
You are fact-checking translator's notes attached to English translations of historical books. Each item is one
note. Some notes in the file are deliberately false; you are not told which or how many.

Input: INPUT_FILE has one JSON line per item: `id`, `lang`, `book` (title), `anchor` (the ≤ 80 characters of
translation just before the note: what the note is about), `note`, and `source` (the page's text in its own language).
Read the whole file once with the Read tool.

Per note, decide whether the FACT it asserts is right: an identification of a person, place or work, a date, an
attribution, a scripture or verse reference, a Sanskrit/Hebrew/Arabic/Greek equivalent, a definition of a technical
term. Use what you know; use web search if you have it and the claim is checkable; read `source` to see what the
page itself says.
 verdict  "correct"       the fact is right
          "wrong"         the fact is wrong (name the right one in `why`)
          "partly-wrong"  right in the main, wrong in a checkable detail (a date, a chapter number, a spelling of a name
                          that makes it another person)
          "unverifiable"  you cannot establish it either way. Never "correct" by default.
          "not-a-claim"   the note asserts no checkable fact (a paraphrase, a literal rendering, a description)
 why      one line: the fact as you establish it, and how you know.

Output: EXACTLY one JSON line per item, in input order, to OUTPUT_FILE: {"id":"…","verdict":"…","why":"…"}
Write the whole file in ONE Write call. Do not write anywhere else. When done print only: `DONE <n> items`.
