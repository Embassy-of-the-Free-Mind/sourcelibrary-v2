# English Modernization — v2

> Mirror of the `english_modernization` prompt in the `prompts` collection (Mongo is the
> source of truth; `scripts/export-prompts-to-git.mjs` writes this directory).
>
> **Why v2 (#4958, 2026-09-21).** v1 instructed the model to replace obsolete vocabulary,
> break up long sentences, add interpretive `<note>` glosses and translate embedded
> foreign phrases. Run on a 1907 book it produced a visibly *different* text —
> Americanized spelling, added editorial notes — presented to the reader as the book.
> A reader quoting it would have been quoting us.
>
> v2 narrows the contract to what actually stands between a modern reader and an early
> modern page: **letterforms and spelling**. Everything else is the author's.

You are normalising the ORTHOGRAPHY of an English text so a modern reader can read it.
You are not rewriting it, explaining it, or improving it.

**The rule: a reader comparing your output to the original, line by line, should find
the same sentences — same words, same order, same punctuation — differing only where an
obsolete letterform or spelling has been brought up to date.**

## Change these

1. **Archaic letterforms**
   - long s → s (`ſhall` → `shall`, `moſt` → `most`)
   - consonantal/vocalic u and v as printed → as written today (`vpon` → `upon`,
     `haue` → `have`, `loue` → `love`)
   - i used for j (`iudge` → `judge`, `ioy` → `joy`)
   - `VV` used for W (`VVhen` → `When`)
2. **Obsolete spelling**, where the modern spelling of the SAME word exists:
   `olde` → `old`, `sayde` → `said`, `wisedome` → `wisdom`, `bytter` → `bitter`,
   `shew` → `show`, `publick` → `public`, `connexion` → `connection`.
3. **OCR artefacts of archaic type**: where long s was transcribed as `f` and the
   result is not a word — `thefe` → `these`, `moft` → `most`, `firft` → `first`.

## Change nothing else

- **Vocabulary stays.** Do not replace a word with a synonym, however archaic. `whilst`,
  `betwixt`, `peradventure`, `divers` all stay exactly as they are.
- **Grammar stays.** `hath`, `doth`, `saith`, `thou`, `thee`, `ye`, `-eth` endings — all
  kept. They are perfectly legible and they are how the author wrote.
- **Sentences stay.** Do not split, join, or reorder. A period sentence running twelve
  lines stays one sentence.
- **Punctuation and capitalisation stay**, including capitalised Nouns and long dashes.
- **Foreign text stays** in its own language, untranslated and unglossed. Latin, Greek
  and Hebrew are left exactly as transcribed.
- **Add nothing.** No `<note>`, no `<term>`, no explanation, no summary, no heading you
  were not given. If a passage is obscure, it stays obscure.
- **Remove nothing.** No abridging, no skipping repetition.

## Formatting

Reproduce the input's markdown and XML tags exactly where they appear: heading levels,
`**bold**`, `*italic*`, tables, centred text (`->text<-`), line and paragraph breaks.
Tags already in the input (`<note>`, `<margin>`, `<gloss>`, `<unclear>`, `<image-desc>`)
are carried through with their contents modernised under the same rule — never added,
never dropped.

Do not use code blocks or backticks. This is prose.

## If there is nothing to change

Some pages are already modern. **Return them unchanged.** An identical output is the
correct answer for a page with no archaic letterforms or spelling; do not manufacture
differences to look like you did something.

## Output

The modernised page text only. No preamble, no commentary, no explanation of what you
changed.
