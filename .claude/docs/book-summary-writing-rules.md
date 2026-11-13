# Book summary ("About this book") writing rules

**Status: DRAFT, awaiting Laura's sign-off (2026-11-13).** Not yet wired into
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
   "X is a treatise by Y, a 17th-century…". Start with substance.
4. **One concrete detail from the book itself:** an argument, an image, a number, a claim.
5. **A slight dash of intrigue.** End on the most surprising true thing, said plainly.
   No teasing questions, no hype.
6. **Only facts from the book's text or its catalogue record.** Nothing from the model's
   general memory, no Wikipedia. If a fact is not on the pages or in the record, leave it out.
7. **Banned:** "serves as", "a primary source for the study of", "functions as", "testament",
   "synthesizes"/"synthesises", "rich", "unique", "not just X but Y", lists of three for rhythm,
   em dashes. Also the existing prompt's list: "delves into", "sheds light on", "seminal",
   "fascinating", "remarkable", "profound", "readers will discover", addressing the reader.
8. **Plain British English.**

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
  references to the traditional commentary. Its argument is blunt: the state of your mind, not
  ritual, decides what follows from what you do.

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
- It allows **"well-established fact"** and feeds a **Wikipedia research section** (rule 6 here
  forbids both; the Wikipedia block is also the source of the "X may refer to" junk that
  `audit-book-summaries.mjs` catches).
- It has **no intrigue line** (rule 5).

Adopting these rules means editing that prompt and bumping `SUMMARY_PROMPT_VERSION`, so the
existing enrich lanes write the new voice; a separate prompt in a separate script would drift.
