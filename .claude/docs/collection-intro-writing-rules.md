# Collection Intro — Writing Rules (v3)

Every collection page opens with a **three-part intro**. Same structure everywhere; the content is specific to each collection. This guide gives the structure, the rules, anti-examples, and worked examples.

---

## The three-part structure

**Part 1 — the hook (bold, larger type).** One or two sentences that make the subject feel large, strange, or alive. Names the *subject*, not its examples. No proper nouns. Leads with what the field IS or what its people DID.

**Part 2 — the works and the access problem (normal type).** 3–4 sentences. Names real figures and works, says what they achieved, and conveys that the writing is hard to reach. Opens differently every time.

**Part 3 — what opening it makes possible (normal type).** 3–4 sentences. Ends on a specific consequence, image, or example unique to THIS collection. The fact that works are digitised or newly translated is mentioned only where it lands naturally and specifically (which works, what that unlocks), never as a standalone "and now it's accessible" sentence and never as the closer. If a translation/access fact has no specific place to live, leave it out: the header already carries the counts.

---

## Rules

### Framing (the ones most likely to be violated)

1. **Positive framing throughout — every subject stands in its own right.** Describe what the subject IS, did, and contains. Never describe it by contrast with a dominant, rival, colonising, or oppressing group, and never name that group at all. The subject does not need a foil to be significant.
   - **Banned framings (apply to ALL collections):** "unlike the West," "not only Greek and Latin," "usually told through men," "beyond the canon," "overlooked by," "written out of," "before Europe," "long before the West understood." Any phrase that defines the subject against something else.
   - **Never name the dominant/oppressor group as a reference point.** Not "men" in a women's collection. Not "Greek," "European," or "the West" in Arabic, Indian, Egyptian, Chinese, or any non-European collection. Not "the British" in Indian material. Not "the Church" as the default antagonist for esoterica or heresy. These traditions are described on their own terms, by their own achievements, in their own vocabulary.
   - **Injustice, where real, is stated as bare fact, not as a frame.** "She was executed in 1310" is allowed. "Reclaiming voices the establishment silenced" is not. State what happened to a person; do not make the whole collection a corrective aimed at someone.
   - **Hard check every time:** scan the final draft for the name of any dominant/contrasting group (men, male, patriarchal, West/Western, Europe/European, Greek, Roman, British, colonial, the Church, mainstream, canon). If it appears as a comparison or foil, the sentence is wrong even when it sounds flattering. Remove it and let the subject stand alone. This has been broken repeatedly; check for it explicitly.

2. **Lead with achievement, not injury.** Where a field carries persecution, suppression, or erasure, that belongs in Part 2 as one factual clause, never as the Part 1 hook or the dominant note. The hook is what people DID, not what was done to them.

2b. **No shared sentence skeletons across collections (the anti-template rule).** The intros are written in bulk, which makes them drift toward a fill-in-the-blank shape. Guard against it hard:
   - **The swap test.** Line up the same sentence position (Part 2 opener, Part 3 closer, etc.) from several collections. If they could trade places with only the nouns changed, they are generic. Rewrite.
   - **Banned closer formula:** "so [the subject] can be read / studied / seen as [its sources / a whole / first-hand]." This exact shape crept into a whole batch. Never end this way.
   - **Banned Part 2 opener formulas:** "These are working manuals…", "What survives is…", "This is the visual record of…", "These are the texts where…". Any "here is what this stuff is" opener.
   - **Banned Part 3 opener formulas:** "Reading them directly…", "Opening it lets…", "Reading both sides…", "Access turns…". Any "[gerund] it [verb]s" opener.
   - **The closer must be unswappable.** End Part 3 on a specific consequence, image, or example that is true of THIS collection and would be false or strange for any other (a specific tension, a concrete pairing, a single vivid thing the collection makes possible).

3. **Part 3 stands on what the collection enables, not on what it corrects.** "Shows a continuous line of women's thought across six centuries" — good. "Returns them to a record that left them out" — the foil sneaking back in; banned.

### Part 1 specifics

4. **No proper nouns in Part 1.** No book, person, place, or title names — those are Part 2's job. Part 1 names the subject. (This trades a little vividness for consistency across hundreds of collections; it's the right trade at scale.)

5. **Vary the hook move; don't use a formula.** Options: a reframe of what the subject is; a surprising scale or stakes; a native paradox; a concrete (unnamed) image; genuine deep time (only when age is truly the hook). **Banned formula:** "People did [X] for thousands of years before they wrote it down. What survives in books is only the most recent chapter." The test: could this line open any other collection? If yes, rewrite.

6. **Extend the subtitle, don't restate it.** Part 1 must add something the one-line subtitle didn't already say.

### Specificity & honesty

7. **Name real works and people in Parts 2 and 3**, pulled from the actual collection.

8. **Translation honesty.** Part 3 may claim "translated for the first time" only for works the collection actually tags as first translations. Scope it ("the most important," "many"), never the whole collection. If a collection has **zero** first translations, make **no** translation claim — lead on gathered / made searchable / read as the sources they are. Never imply a first translation for a work with a known prior English edition.

9. **Use real endpoints for the span** (Part 3): two actual works, ideally oldest and most monumental/latest, chosen to show breadth.

10. **Each collection gets its own Part 1 hook and its own Part 2 barrier.** Don't transplant frames between collections.

11. **Only claim what's true of the field.** Formal-nomenclature claims fit natural science, not esoterica or history. Swap for the real foundational claim.

### Mechanics

11b. **The header owns the numbers; the intro never repeats them.** The page header dynamically shows the live count of works, the languages, and the date range. Never restate any of these in the intro: they change as the collection grows, and a hardcoded copy falls out of date.
   - **No counts.** Not "twenty-three works," "13 books," "six volumes." Use durable phrasing: "the major works," "many," "key works," "the core works," or simply "translated into English for the first time" with no tally.
   - **No date spans or years.** Not "from 1533 to 1678," not "a fourteenth-century treatise to a 1927 bibliography." Describe range by **era** ("from Renaissance occult philosophy to the great Baroque folios," "from medieval manuscripts to the foundations of modern scholarship").
   - Named *works* may anchor the span ("from the Canon to Leclerc's history") as long as no year is attached.

11c. **Every work you name is clickable.** Parts 2 and 3 name real works (rule 7); each of those names must link to its book page. Write inline `[Short Title](/book/<slug>)` using slugs read back from the collection's own books, or cover the mention in `mentioned_books`. **Internal hrefs only** — an absolute `https://sourcelibrary.org/...` is not parsed and renders as literal brackets, and so do `**bold**` and `*italic*` (emphasis is not parsed — the Part 1 hook is marked bold in this guide's examples to show structure, never by typing asterisks into the field). Don't assume auto-linking covers it: the renderer looks for a book's *full* title inside the prose, and these intros name short forms. Mechanism and verification: `.claude/docs/collection-description-linking.md`.

12. **No em-dashes.** Use commas, colons, or full stops. (Site style.)

13. **Vary paragraph openings.** Parts 2 and 3 should not begin the same way ("This collection…") every time, across the page or across collections.

14. **No AI-writing tropes.** Avoid "not just X but Y," rule-of-three rhetorical lists, "in a world where," "more than ever," "stands/serves as a testament," empty intensifiers (truly, deeply, profoundly).

15. **Verify every factual anchor.** Every named person, work, date, and every "first/oldest/only" is checked before publishing.

16. **Length & tone.** Part 1: 1–2 sentences. Parts 2–3: 3–4 each. Plain, declarative, understated. Confident without selling. Concise and straightforward; never boring.

---

## Anti-examples

- **Defining by contrast (rule 1):** ✗ "The history of the world was not written only in Greek and Latin." → ✓ "For more than a thousand years, the courts of Asia wrote their own histories."
- **Injury-first (rule 2):** ✗ "Women who claimed knowledge of the divine were punished for it." → ✓ "For six centuries, women produced some of the boldest thought in the Western tradition."
- **Foil in Part 3 (rule 3):** ✗ "returned to a record that mostly left them out." → ✓ "a body of work six hundred years deep can be read as a whole."
- **Proper noun in Part 1 (rule 4):** ✗ "The Samguk Sagi, written in 1145…" → ✓ "For more than a thousand years, the courts and scholars of Asia wrote their own histories."
- **Formula (rule 5):** ✗ "People studied X for millennia before anyone wrote it down."
- **False translation claim (rule 8):** ✗ claiming first translations for a collection with none tagged.

---

## Worked examples

These eight span the easy and the contentious cases. Scan them as a set: no two Part 2s open the same way, no two Part 3 closers share a skeleton, and none names an oppressor, rival, or dominant group to justify itself. (Date-anchors like "four thousand years," "fourteen hundred drugs," and the sabbath pharmacology are flagged for source-check before publishing.)

### Mycology
> **Fungi were gathered for food, brewed into medicine, and puzzled over for centuries before anyone could say what they even were: plant, animal, or something stranger that earned a kingdom of its own.**
>
> The books that worked this out stay closed to most of the people who depend on them. Persoon and Fries fixed the rules of fungal naming in dense Latin; Sterbeeck wrote the first book devoted entirely to mushrooms, in Dutch; Bulliard's plates are among the finest ever made, the most important of these appearing in English here for the first time. Centuries of close observation, reachable until now mainly through citation while the pages themselves sat unread.
>
> The detail in those pages is startlingly fine. A mushroom Persoon pinned down in a single Latin sentence can be matched against the specimen in your hand, the name you use every day traced back to the exact words that first fixed it to a living thing.

### Women of the Secret Tradition
> **For six centuries, women produced some of the boldest thought of their age: visionary theology, working chemistry and medicine, and entire philosophical systems of their own design.**
>
> They wrote as mystics, physicians, alchemists and reformers. One published a chemistry meant to put practical knowledge in ordinary hands; another wrote on medicine and the cosmos nine hundred years ago; others built spiritual systems that drew followers across a continent. Their work survives scattered across Latin, French, German and early English, much of it translated here for the first time, and some of it cost them dearly: a few rose to fame, others were silenced or killed for what they wrote.
>
> Read in sequence, the voices answer one another across the centuries. A medieval abbess prescribing remedies and a seventeenth-century chemist writing recipes for the household turn out to be working the same seam, both convinced that the deepest knowledge could be set down plainly and handed on.

### Asian Historical Texts
> **For more than a thousand years, the courts and scholars of Asia wrote their own histories: dynastic records, founding myths, and royal chronicles that told whole civilisations where they came from.**
>
> These works shaped how millions understood their past. The oldest surviving Korean history dates to the twelfth century; beside it stand the great chronicles of Japan, Persia, Burma and the Malay world, each central to its own tradition. Most reach modern readers through a single ageing edition, if any, the writing held in Classical Chinese, Persian, Burmese and Malay that few can now read.
>
> Set together, the chronicles show how differently a beginning can be told. A Korean court accounting for a dynasty's rise and a Malay sultanate narrating its own origin each carry their own sense of what a history is for, and where a people's story properly starts.

### Arabic Medicine
> **For six hundred years, the most advanced medicine on earth was written in Arabic. Its textbooks trained physicians across three continents, and some of the surgical instruments it described are still in use.**
>
> The achievement was vast and practical. Avicenna's Canon organised the whole of medicine into a single system taught for centuries; al-Zahrawi designed instruments and set down operations no one had recorded before; Ibn al-Baytar catalogued some fourteen hundred drugs from fieldwork across Málaga to Cairo. The works survive in Arabic manuscripts and early printed editions, several rendered into English here for the first time.
>
> What these books show is medicine being built, not inherited. You can watch al-Zahrawi reason from a wound to a new instrument, or follow a single drug from Ibn al-Baytar's field notes into the formal pharmacopeia, the discipline assembling itself case by case on the page.

### Ancient Egypt
> **Four thousand years ago, Egyptian scribes were already writing adventure tales, bitter laments, surgical case notes, and a father's advice to his son. It is the oldest literature on earth, and it reads as the work of people wholly recognisable as us.**
>
> The range is extraordinary. A courtier's exile and homecoming, a peasant who argues so well that officials keep him talking just to hear more, a vizier's maxims that held their authority for a thousand years, a surgeon's calm notes on a shattered skull. The writing comes down in hieroglyphic script that very few people alive can read, which has kept the literature itself at a distance even where its stories are famous.
>
> Here the script is set beside its own sound and sense, line by line, against a photograph of the papyrus. A reader with no training can put a finger on a single glyph, hear what it said, and watch a four-thousand-year-old sentence resolve into something a person actually wrote.

### Indic Magic: Tantra & Mantra
> **In the tantric traditions, sound itself was power. A syllable correctly uttered could move the world, and whole systems of ritual, alchemy, and philosophy were built on the exact force of the spoken word.**
>
> Much of this was written as working instruction. Ritual collections specify precisely how a rite must be performed; alchemical treatises chase mercury and immortality; the Kashmir Shaiva masters built a metaphysics of consciousness around mantra and deity. The texts survive in Sanskrit and Tibetan, in critical printings and in monastery manuscripts written in scripts only a handful of scholars can read, several appearing in English here for the first time.
>
> What the page reveals is how seamless the system was. A recipe for transmuting mercury and a method for liberating the soul turn out, in these manuals, to be written as the same instructions, the chemistry and the spiritual discipline indistinguishable from one another.

### The Witches' Sabbath
> **The witches' sabbath was one of the most vivid fantasies Europe ever produced: a night flight to a secret gathering of demons. Behind it lay a pharmacology, ointments of belladonna and henbane that genuinely produced sensations of flight and transformation.**
>
> The fantasy was built, enforced, and challenged on paper. Inquisitors' manuals laid out how to find and break a witch; doubters like Weyer and Scot argued the whole structure was delusion dressed as justice. These books, in Latin, German, and early English, carry an entire apparatus of fear, surrounded by the woodcuts that fixed the sabbath in the visual imagination, several of the manuals translated here for the first time.
>
> The prosecutors and the sceptics sit side by side, and that is the unsettling part. The same confession reads as proof of a demonic conspiracy or proof of a judicial atrocity, and which one you see depends entirely on whether you trust a word extracted under torture.

### Reformation Theology
> **A single dispute over how a soul is saved split Western Christianity and redrew the map of a continent. The argument ran in print, at enormous length, among people who believed the stakes were eternal.**
>
> What it left behind is the machinery of belief itself: confessions written to bind whole churches, catechisms to drill children, and ferocious polemics between rival theologians. Luther, Calvin, and Beza set the terms; confessional statements like the Book of Concord tried to lock them in place. Most of it sits in Latin and early German, much of the polemical literature reaching English readers here for the first time.
>
> Set in order, these texts let you watch a creed being made. The doctrines that still divide Protestant churches can be caught mid-formation, in the moment they hardened out of argument into the fixed wording a congregation would come to recite.

---

## Fill-in template

> **[Part 1: broad hook, NO proper nouns. What the subject IS or what its people DID. Pass the "could this open any other collection?" test. Extend the subtitle.]**
>
> [Part 2: name 2–4 real figures/works and what they achieved; convey the access difficulty as one thread, not the whole point. Open differently than "This collection." Real stakes only if true, stated plainly.]
>
> [Part 3: the consequence of access — what someone can now do/see/read. Real span, earliest to latest. First-translation claim ONLY if true. End on the subject, never on a foil.]
