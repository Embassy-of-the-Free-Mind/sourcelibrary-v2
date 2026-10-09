# Judge prompt — seam-ab-5678 (page-turn judge)

You are judging English translations of historical books (Latin, German, French, Italian) **at one place only: the
page turn** between source page N and source page N+1.

For each BREAK you get:
- the SOURCE: the end of page N and the start of page N+1 (OCR text; may be cut at "…");
- several VERSIONS, each lettered (P, Q, R, S, T…). Each version gives the English its translator assigned to the
  END of page N and to the START of page N+1 (also cut at "…").

The versions were made by different processes. You are not told which is which, and you must not guess. Some
versions may end page N in the middle of a sentence. That is allowed and is not a defect by itself: what matters is
whether every source word near the turn is rendered once, on its own page, and whether the English reads correctly
across the turn when page N's English is followed directly by page N+1's English.

A word split by a hyphen at the turn ("Augspur-" | "gischen") may be translated whole on page N. A catchword (the next
page's first word printed again at the foot of page N) need not be translated. Neither is a defect.

## For EACH version, record

- `duplication` (true/false): some source words near the turn are rendered on BOTH sides (in page N's English and
  again in page N+1's English); 2 or more words.
- `forced_closure` (true/false): page N's English ends or completes a sentence that the source leaves unfinished
  on page N, by **supplying words that are not on page N** (invented, or borrowed from page N+1) or by **changing
  the grammar so the meaning differs** from what the source says. A full stop alone, with the meaning intact, is
  NOT a forced closure: record it as `closure_punct_only: true` instead.
- `omission_edge` (true/false): 2 or more source words in the last ~3 lines of page N or the first ~3 lines of
  page N+1 are rendered on NEITHER side.
- `words_moved` (integer, 0 if none): about how many source words are rendered on the WRONG side of the turn
  (page N+1's words in page N's English, or page N's words in page N+1's English), not counting a split word or a
  catchword. Count words moved, whether or not they are also duplicated.
- `reads_across` ("ok" / "broken"): read the end of N's English straight into the start of N+1's English. Does the
  sentence that crosses the turn read as one correct sentence, faithful to the source? "broken" if a reader would
  stumble, see a repeat or a gap, or get the wrong meaning.
- `note` (string, ≤ 25 words): what you saw, quoting the words concerned. Empty if clean.

Judge only the turn. Ignore translation quality elsewhere, notes in `<note>` tags (unless they duplicate or import
text across the turn), and formatting.

## For each BREAK, record

- `best`: the letter(s) of the version(s) with the best page turn, or `"tie"` if no version is better than another
  at the turn. A list is allowed (`["P","R"]`) when several are equally best and better than the rest.

## Output

Write ONE JSON object per break, one per line, to the file you are given (JSONL), in packet order:

```
{"id":"<break id>","versions":{"P":{"duplication":false,"forced_closure":false,"closure_punct_only":false,"omission_edge":false,"words_moved":0,"reads_across":"ok","note":""},"Q":{...}},"best":"tie"}
```

Every version letter of every break must appear. Do not skip breaks. Do not write anything else to the file.
