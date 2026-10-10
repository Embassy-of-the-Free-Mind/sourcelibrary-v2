---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "A bracket-after-term rule caught supplied words half the time; cut to brackets the sentence names as a term, it fires 0-2 times per ~12.5K stored pages, all glosses."
status: adopted
decision: "bracketDefinitionsToNotes runs in the translation write guard (translate-write, #5902)"
superseded_by: null
issue: 5902
---
## 2026-10-06 · Can a write-time rule tell a bracketed gloss after a `<term>` from the translator's supplied words?

**Design.** `bracketDefinitionsToNotes` (scripts/lib/translation-write-guard.mjs, #5902) run, $0, over (a) the
#5919 note-free arm and its two v13 arms (48 pages each), and (b) repeated random draws of ~12.5K stored pages
whose translation has a `<term>`, every new `<note>` read by eye. Then a 3-page live run through the production
prompt and routing (Latin, Chinese, Arabic; nothing stored).

**Result.**
- The first rule (any bracket after a term) fired on 147 brackets in 99 of 12,584 stored pages, about half of
  them supplied words: `hot <term>apathetic</term> [conditions]`, `<term>Tiphereth</term> [is denoted]`,
  legal names completed (`<term>Vincentius</term> [Hispanus]`), long-s respellings (`<term>Fufina</term> [fusina]`).
  Moving one into a note takes a word out of the sentence when notes are off, while a gloss left in brackets
  still reads as the translator's (#4385). So the rule was cut to **precision**: a bracket becomes a note only
  when the sentence NAMES the term ("called", "the term", "the word", "the name", "said"…), and never a
  supplied-clause opener, a speech verb, a one-word past tense, an abbreviation, a respelling or a reference.
- Final rule, stored draws: 0, 2, 1, 2 fires on four draws of ~12.5K term pages; the last draw's 2 are both glosses
  (`the word <term>gale</term> [itch]`, `When I said <term>ficus</term> [fig]`). Each false fire seen on the way
  is a unit test.
- #5919: **5 of the 12** bracket glosses in the note-free arm become notes; 0 fires on v13-a / v13-b; the
  supplied verb `<term>Zisang Hu</term> [replied]` stays.
- Live run ($0.0076): the guard changed nothing on any of the 3 pages — no definition inside a `<term>`, no
  bracket gloss. The Arabic page has 3 `<term>…</term> <gloss>` pairs, the out-of-scope #5942 case.

**Replicated?** The stored check four times on independent draws; the live run once.
**Artifact.** scripts/eval/translation-write-guard-5902/ (live-dry.mjs, stored-draw.mjs),
scripts/eval/results/translation-write-guard-5902/.
