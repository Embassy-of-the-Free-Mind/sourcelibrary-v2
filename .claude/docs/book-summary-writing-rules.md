# Book summary ("About this book") writing rules

**Status: signed off by Laura, 2026-11-13** (the "dash of intrigue" rule was dropped). Not yet wired into
`scripts/workers/lib/summary-prompt.mjs`, which still asks for the opposite opening (see
"Conflicts with the current prompt" below). Used by the trial tooling in `scripts/summaries-batch/`.

**Read this when** writing, generating, reviewing or prompting a book-level summary
(`summary_candidate.brief` / `.abstract`, and the live fields they are promoted to).

PRIOR ART: `.claude/docs/collection-intro-writing-rules.md` (collection intros),
`.claude/skills/featured-work-description/skill.md` (featured-work blurbs: same no-tropes
list, different job), `scripts/workers/lib/summary-prompt.mjs` (the live prompt).

## The rules

1. **Describe this book.** What it is, what it argues or shows, and the one specific thing
   that makes it worth opening.
2. **Brief: two or three sentences, about 60 words.** An optional abstract may run one
   paragraph longer; the same rules apply.
3. **Do not open with the label.** The page already shows title, author and date. No
   "X is a treatise by Y, a 17th-century…". Start with substance, but **name the author
   naturally in the first sentence** ("Dee claims…"): the brief is also the search snippet
   and appears on cards without the title, so it must still say whose book it is.
4. **One concrete detail from the book itself:** an argument, an image, a number, a claim.
5. **Facts from the book, its catalogue record, or well-established knowledge.** Nothing guessed:
   if a fact is uncertain, leave it out.
6. **Banned:** "serves as", "a primary source for the study of", "functions as", "testament",
   "synthesizes"/"synthesises", "rich", "unique", "not just X but Y", lists of three for rhythm,
   em dashes. Also the existing prompt's list: "delves into", "sheds light on", "seminal",
   "fascinating", "remarkable", "profound", "readers will discover", addressing the reader.
7. **Plain British English.**
8. **Say what this copy is when it matters:** a translation, a later edition, a manuscript copy,
   one volume of several. "An English manuscript version of…" tells the reader what they hold.
9. **Only describe what was read.** If the summary was written from part of the book, say so
    plainly ("The first volume…") rather than describing the whole work.
10. **Keep doubt visible.** "Attributed to", "probably" when the record or text says so; never
    turn an attribution into a fact for the sake of a cleaner sentence.
11. **Neutral on belief and sex.** Describe what a religious, magical or erotic text says and does
    without endorsing or mocking it.
## Before and after

The "after" versions use only facts already in each book's stored summaries (the full texts
were not read for these samples); a real run works from the book's own pages.

**John Dee, *The Hieroglyphic Monad* (1564)**
- Before: "…is a philosophical treatise by John Dee, an English mathematician, astronomer, and
  occultist… It serves as a primary source for the study of Renaissance Hermeticism…"
- After: Dee claims that all of reality, heavenly and earthly, grows from a point, a line and a
  circle, and fuses the three into a single sign: the hieroglyphic monad. Dedicated to Emperor
  Maximilian II, it is both a geometry lesson and a manual for the art of fire.

**Michael Maier, *Atalanta Fugiens* (English manuscript, c.1625)**
- Before: "…presents a series of emblems and discourses that synthesize chemical processes with
  classical mythology… It serves as a primary record of early 17th-century hermetic thought…"
- After: An English manuscript version of Maier's emblem book, where classical myths are read as
  coded laboratory instructions. The alchemist here is nature's servant, helping along changes
  that still need the right conditions and time.

**Li Yu, *The Carnal Prayer Mat***
- Before: "…uses erotic narrative as a didactic framework to argue for the moral regulation of
  sexual desire… It serves as a primary example of the use of vernacular fiction…"
- After: Li Yu's erotic novel argues that desire works like medicine: healing in moderation,
  poison in excess. The explicit scenes are deliberate bait, holding the reader long enough for
  the moral, and the story turns on Buddhist ideas of retribution.

***Dhammapada* (Pali text, 1914 edition)**
- Before: "…is a collection of verses attributed to the Buddha… The text serves as a primary
  anthology of ethical and spiritual teachings…"
- After: Short verses attributed to the Buddha on taming the mind, printed in Pali with
  references to the traditional commentary. Its argument is blunt: the state of the mind, not
  ritual, decides what follows from a person's actions.

**Franciscus van Sterbeeck, *Theatre of Mushrooms* (1675)**
- Before: "…is a mycological and botanical treatise by Franciscus van Sterbeeck… serving as a
  primary source for 17th-century European folk knowledge…"
- After: A Flemish priest's guide to telling edible mushrooms from deadly ones in the Brabant
  countryside. Van Sterbeeck sets Pliny and Dioscorides aside and trusts what he sees in the
  field, even watching how animals behave.

## Conflicts with the current prompt (decide before adopting)

`scripts/workers/lib/summary-prompt.mjs` (version `2026-10-07-no-ai-vocabulary`), which writes
every pipeline summary today, differs in three places:
- It requires the brief to **open by naming the work** and identifying the author (rule 3 here
  says the opposite).
- It allows **"well-established fact"** and feeds a **Wikipedia research section** (rule 5 here
  forbids both; the Wikipedia block is also the source of the "X may refer to" junk that
  `audit-book-summaries.mjs` catches).
- It has none of rules 8 to 11 (what the copy is, only what was read, visible doubt, neutral tone).

Adopting these rules means editing that prompt and bumping `SUMMARY_PROMPT_VERSION`, so the
existing enrich lanes write the new voice; a separate prompt in a separate script would drift.
