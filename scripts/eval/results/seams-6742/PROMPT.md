# Opus reference prompt (#6742)

```
You are checking ONE page turn in an AI English translation of a historical book. A reader pages from
page N to page N+1 and reads the English straight across. Your job: does the English at the turn faithfully and
readably continue what the SOURCE continues?

You get four excerpts (each may be cut at "…" on its far side — judge only the turn, not the cut ends):
- SOURCE N (end of page N, OCR text) and SOURCE N+1 (start of page N+1);
- ENGLISH N (end of page N's translation) and ENGLISH N+1 (start of page N+1's translation).

Allowed, NOT defects: page N's English ending mid-sentence where the source does; a word split by a hyphen at the
turn translated whole on page N; a catchword (next page's first word printed at the foot of page N) left
untranslated or rendered once; a full stop added at the turn when the meaning is intact; running heads, page
numbers, signatures; translation-style choices away from the turn.

Labels (taxonomy codes from page-error-taxonomy.md):
- "ok": every source word near the turn is rendered once, on its own page, and the English reads across correctly.
- "omission" (T9/T1): 2+ source words in the last ~3 lines of N or first ~3 lines of N+1 are rendered on NEITHER side.
- "duplication" (T5): source words near the turn are rendered on BOTH sides (2+ words).
- "drift" (T4): ~6+ source words are rendered on the WRONG side of the turn (N+1's words in N's English or the
  reverse), not counting a split word or catchword, with nothing lost.
- "broken_syntax" (T6 forced closure / fabricated bridge): read across, the sentence does not parse or changes
  meaning — the translator closed a sentence the source leaves open by supplying words not on page N, inserted a
  bracketed or invented bridge, or restarted N+1 so the carried clause is mistranslated.
- "catchword" (T6): a catchword or split word mishandled — rendered twice, or the word half mistranslated as its own word.
- "other": a different defect AT the turn (e.g. one side's English is not a translation of its source, left untranslated).

If more than one applies, give the main one as "label" and all in "labels".

Then, ONLY if the label is not "ok", write a MINIMAL repair: replace the last sentence(s) of ENGLISH N and/or the
first sentence(s) of ENGLISH N+1 so that each page renders exactly its own source words and the two read across as
one correct sentence. Copy the text you replace VERBATIM from the excerpt (exact substring, including punctuation)
as tail_old (must be the END of ENGLISH N) and head_old (must be the START of ENGLISH N+1); use "" for a side you do
not change. Change as few words as possible; keep the translator's style and terms. Page N may end mid-sentence
(no full stop) when the source does, and N+1 then continues in lowercase.

Reply with ONE JSON object and nothing else:
{"label":"ok|omission|duplication|drift|broken_syntax|catchword|other","labels":["..."],"severity":"none|minor|major",
 "confidence":0.0-1.0,"evidence":"<= 40 words, quoting the words concerned",
 "repair":null | {"tail_old":"...","tail_new":"...","head_old":"...","head_new":"..."}}
severity: "major" if a reader loses or is misled about content, "minor" if it reads awkwardly but the content is all there.
```
