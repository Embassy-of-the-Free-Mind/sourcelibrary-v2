<!-- PRIOR ART: scripts/eval/xlref-t1/DIMENSIONS-PROMPT.md (#5695 addendum B) scores OUR English and the published reference, unblinded, on five dimensions. The dimension wording is copied from it. It cannot be reused as-is: #5698 compares several of our own candidates BLIND, and needs a per-note audit (ours vs the source's printed notes, clutter, whether an offered alternative reading is real) that no track prompt has. -->
You are a blind judge of several English translations of ONE page of a historical book. You do not know which
system or instructions produced which translation, and you must not guess. Per item you have:

- `source`: the page's text in its own language (an OCR transcription; it may carry OCR errors and house tags).
- `reference`: a published human English translation of the same passage (`reference_style`: literal | free |
  early-modern). A guide to MEANING only; it may start or end a little off the page.
- `translations`: candidates T1..Tn. They carry house tags: <term>, <gloss>, <margin>, <meta>, <summary>, <keywords>,
  <unclear>, and <note>…</note>. A <note> is meant to be the TRANSLATOR's own voice. Some candidates open a note with
  a type word ("original:", "clarification:", "context:", "alternative:", "image:"); others do not. Neither habit is
  better in itself: judge what a reader can SEE and CHECK.

Input: INPUT_FILE has one JSON line per item. Read the whole file once with the Read tool.

Score EACH candidate 1–5 on five dimensions (5 = excellent, 3 = adequate with clear weaknesses, 1 = fails):
 readability   a non-specialist modern reader can follow it without the source. Notes that interrupt every clause
               lower this; a crib that needs the source to make sense lowers it.
 register      keeps the genre and voice: verse stays verse-like, liturgy liturgical, technical prose technical.
 terminology   technical terms rendered consistently and recognisably; key terms kept or glossed, not flattened.
 ambiguity     keeps a real ambiguity of the source open, or flags the second reading, rather than silently resolving
               it (if the page has none worth keeping, score 5 unless the translation INTRODUCES a false precision).
 transparency  a reader can tell what is the source's and what is the translator's: supplied words, uncertainty,
               corrections and choices are flagged; the source's own wording is quoted where a scholar would check
               it; the source's printed notes are not presented as the translator's; nothing is silently added,
               dropped or corrected. A flagged gloss does not lower this; an unflagged one does. A note whose
               content is wrong or misleading lowers it.
Do NOT score fidelity here; another pass does. Two candidates with identical text get identical scores.

Per candidate also:
 stance        "literal" (a crib that follows the source's order and words) | "balanced" | "free"
 notes         an audit of its <note> tags, as counts:
               {"ours": n, "source_printed": n, "clutter": n, "malformed": n}
               - ours            the translator's own remark (original wording, clarification, context, alternative,
                                 image description of real content)
               - source_printed  a footnote, marginal note, editor's note or interlinear commentary that is PRINTED ON
                                 THE PAGE (it is in `source`) but is wrapped in <note> as if it were the translator's
               - clutter         a remark about the scan or the paper, or a description of a decorative initial,
                                 ornament, border or printer's device
               - malformed       not a note at all: a bare tag name, a term or gloss stuffed into <note>, an empty note
               The four counts sum to the number of <note> tags in the candidate.
 alternatives  a list, empty if none: every place where the candidate OFFERS A SECOND READING of the source (typed
               "alternative:" or not: "or …", "lit. …", "could also mean …"). Each
               {"quote": "≤ 12 words of the note", "verdict": "real" | "spurious" | "wrong"}:
               real = the source (or a plausible OCR slip in it) does admit that reading and it differs in sense;
               spurious = a synonym or a restyling, no second sense; wrong = the source cannot mean that.
 silent        a list, empty if none, at most 2: places where the candidate SILENTLY resolved or changed something a
               reader should have been told about: a real ambiguity decided without a flag, a number, name or word of
               the source corrected or changed in the text, words supplied with no mark. Each
               {"quote": "≤ 12 words of the candidate", "source": "≤ 12 words", "what": one line}.
               A plain mistranslation is not "silent"; this is about undisclosed CHOICES.

Per item: "confidence" 0–1 (lower when you read the source language weakly; say so) and "reason", one line.

QUOTES: never quote more than 12 consecutive words of the reference.

Output: EXACTLY one JSON line per item, in input order, to OUTPUT_FILE:
{"id":"…","scores":{"T1":{"readability":4,"register":4,"terminology":3,"ambiguity":5,"transparency":3,"stance":"balanced","notes":{"ours":3,"source_printed":0,"clutter":1,"malformed":0},"alternatives":[{"quote":"or \"do not abide\"","verdict":"real"}],"silent":[]},"T2":{…}},"confidence":0.7,"reason":"…"}
Every label of the item appears in "scores". Write the whole file in ONE Write call (valid JSON per line, never
pretty-printed). Do not write anywhere else, do not look for other files. When done print only: `DONE <n> items`.
