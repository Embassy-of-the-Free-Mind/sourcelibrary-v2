---
stage: translation
measure: [judged, agreement]
languages: [la, de, grc, lzh]
scripts: [Latn, Grek, Hani]
canons: []
n_books: 2993
n_pages: 3040
verdict: "Notes can be a separate, anchored layer. A tolerant parser splits 3,000 stored pages into text + annotations byte-exactly, and its anchors re-find their words in the page's next stored version with 0 misplaced after a by-eye read. Asked to return text + annotations as JSON, Opus is not less faithful than today's inline prompt (S−T +0.13 [−0.05, +0.30], 40 pages); 40 of 40 replies were valid JSON and 367 of 367 anchors resolved. It costs 2.6× the output tokens."
status: undecided
decision: "Preregistered rule met: adopt S for new translations on the Opus CLI lane once the notes-layer storage (step 2) exists; not yet for Gemini lanes (not measured). Default prompt unchanged (#5942)"
superseded_by: null
issue: 5942
---
## 2026-10-24 · Notes as their own layer, tried two ways: parse today's markup into anchored annotations, and ask the translator for text + annotations directly (#5942)
<!-- PRIOR ART: 2026-10-06-notes-layer-phase1-2-5942.md (src/lib/translation-layers.ts, the exact TS split of stored translations; its round-trip measure is repeated here on the new parser) and 2026-10-15-plain-vs-notes-translation-6728.md (the PLAIN arm, prompts, sealed claude -p runner and the #6545 judge rubric are reused unchanged). New here: W3C TextQuoteSelector anchors, a tolerant parser for malformed tags, anchor survival across real revisions, and the S arm. -->

**Who this is for.** A reader of a translated page and anyone who quotes it: the author's words and the machine's
commentary should be two things. Today a note is a tag inside the text; when it does not close it leaks into the
text or swallows the page (#5644, #3698, #5055). Correction lanes are about to rewrite much stored text (#7263,
#5924), so an anchor must survive a rewrite or be visibly orphaned, never misplaced.

**Code.** Parser `scripts/lib/annotation-layer.mjs` (`splitAnnotations`, `resolveAnchor`, `renderInline`,
`renderMarkup`), 19 unit tests in `tests/unit/annotation-layer.test.ts`. Eval `scripts/eval/notes-layer-5942/`
(PREREG.md written before any Part B output). Numbers `scripts/eval/results/notes-layer-5942/`. $0: Opus through
`claude -p` on the subscription, one Gemini judge through `agy`; no API key, no write to pages, books or revisions.

### Part A — the parser over existing text

**The model of a page.** `text` holds the book's words only, with no tag of the closed vocabulary (#3825).
Annotations come in three kinds:
- **commentary** (`<note>`, `<image-desc>`, a `<gloss>` straight after a `<term>`) leaves the text, keeps its body,
  and is anchored to the phrase before it;
- **marks** (`<margin>`, printed `<gloss>`, `<insert>`, `<unclear>`, `<term>`) keep their words in the text and
  span them;
- **page-level** blocks (`<summary>`, `<keywords>`, `<vocab>`, `<warning>`, `<meta>`, page data) have no anchor.

An anchor is `{exact, prefix, suffix, start, end}`, with 32 characters of context on each side. An unclosed tag
becomes an annotation flagged `malformed: 'unclosed'`; only the tag leaves the text, never the words after it.

**Draw.** Seed 5942, one page per book: 2,000 live translations (23,818 books in frame) and 1,000 OCR pages
(70,592 books).

| | translations (2,000) | OCR (1,000) |
|---|---:|---:|
| pages with any annotation | 1,780 | 927 |
| commentary / marks / page-level annotations | 7,298 / 9,170 / 3,499 | 265 / 793 / 5,106 |
| top types | term 6,083 · note 2,835 · definition 2,810 · original 1,612 · margin 1,190 · summary 1,012 · unclear 1,011 | page data 3,982 · vocab 678 · margin 439 · meta 342 · image 243 |
| pages with an **unclosed** tag | 5 (0.25%) | 0 |
| pages with a **stray close** tag (e.g. `<margin></margin>` … `</margin>`) | 31 (1.6%) | 0 |
| `renderInline(split)` = stored markup, byte for byte | 1,997 (the 3 others: a definition lifted out of a `<term>` chip, as every reader does) | 1,000 |
| `text` = today's notes-off reader output (whitespace aside) | 1,921 | 994 |
| text + annotations alone (no layout) → today's reader, notes on / off | 1,886 / 1,944 | 983 / 997 |
| anchors resolving in their own text | 16,467 of 16,468 (one empty mark) | 1,058 of 1,058 |

**The 79 translations whose text differs from notes-off today:**
- 55: today's reader shows a note's words as book text. The cause is a note nested inside a page mark (the
  reader flattens it into the mark) or an unclosed chip. Here they are notes. This is a reader leak the split fixes.
- 16: spacing only.
- 1: the text keeps a word that notes-off drops.
- 7: other. One of them is a `<insert>` closed by `</note>`.

Against the TS parser of phase 2 on the same 2,000 pages, the texts are equal on 1,490. In a 400-page check of the
rest, 77 of 97 differ only because the TS split leaves page-data tags (`<page-num>`, `<header>` …) in its text, and
20 are the nested-note leak above. The commentary count is equal on 1,947 pages.

**Anchor survival on real rewrites.** These are pages whose `page_revisions` history holds an earlier version.
Each note and mark of version *k* is re-resolved in the text of version *k+1*, and the word diff of the two texts
is the truth. Pairs are banded by how much of the text the diff keeps.

| translations: 241 version pairs with anchors (405 pages with history; 153 pairs had the same text) | edit, ≥0.8 kept (48 pairs) | partial, 0.4–0.8 (51) | rewrite, <0.4 (142) |
|---|---:|---:|---:|
| anchors | 478 | 458 | 1,585 |
| resolved by offset / quote / fuzzy | 148 / 278 / 1 | 5 / 57 / 0 | 0 / 15 / 0 |
| resolved where the diff lost the words, then read by eye | 29 | 29 | 10 |
| orphaned, words gone (correct) | 17 | 349 | 1,536 |
| orphaned, words still there (lost, not wrong) | 3 | 18 | 24 |
| **misplaced** (the diff disagrees) | **2** | 0 | 0 |

The OCR pairs (74 pairs, 253 anchors): 76 resolved, 7 resolved where the diff lost the words, 162 orphaned with
the words gone, 5 orphaned with the words still there, 0 misplaced.

**By eye.** The by-eye read found a bug, now fixed. A note standing in its own paragraph has a zero-width anchor.
When it was re-found by the fuzzy pass, it landed before the trailing full stop instead of after the blank line:
10 of the first 26 cases read. The cause was that folding drops punctuation. `resolveAnchor` now places the point
where the suffix's words begin, and a unit test pins it.

After the fix:
- all 13 point anchors re-read are right;
- 31 phrase anchors read from the "diff lost the words" class all sit on the corresponding words (case changes,
  a reworded clause, a moved sentence);
- the 2 "misplaced" are one newline apart inside a run of blank lines.

**Misplaced after the by-eye read: 0.** The parser prefers to orphan: a repeated phrase whose context has gone is
dropped, never guessed.

### Part B — new translations with notes as separate fields

**Pages.** 40 pages, 10 each in Latin, German, Greek and Chinese, seeded. Books are live, not held, have no
withheld page and are not `reocr_candidate`. Each page has model OCR of 600–3,500 characters and the page before
it has a stored translation. Only 87 Chinese books passed the hold filter.

**Arms.** All three use the same OCR, book line and page-break devices, through Opus via sealed `claude -p`:
- **T** — today's Standard Translation v13 (`51651014`), tags inline;
- **S** — v13 word for word, plus an appended OUTPUT FORMAT block (`s-format.mjs`): return
  `{"text", "annotations":[{type, exact, prefix, suffix, body}]}`, with `text` carrying no markup;
- **P** — #6728's PLAIN prompt (`10151f1b`).

**(a) Fidelity, blind.** Judges read bodies only, all through `splitAnnotations(...).text`. Each page had three
candidates in seeded order, plus a planted-error control on 7 pages. The rubric is #6545's, with the reference cut.

| judge | n | T | S | P | S − T [95% CI] (W/L/T) | P − T | pages with a reversal T / S / P | omission T / S / P |
|---|---:|---:|---:|---:|---|---|---|---|
| Opus | 40 | 4.60 [4.43, 4.75] | 4.72 [4.58, 4.88] | 4.63 [4.45, 4.80] | **+0.13 [−0.05, +0.30]** (9/4/27) | +0.03 [−0.17, +0.25] | 1 / 1 / 0 | 5 / 3 / 2 |
| gemini-3.8-flash-low | 20 | 4.75 | 4.90 | 4.55 | +0.15 [−0.05, +0.35] (4/1/15) | −0.20 [−0.45, +0.05] | 1 / 0 / 1 | 0 / 0 / 0 |

- Planted errors were found 7 of 7 (Opus) and 4 of 4 (Gemini), each scored below T.
- By language (Opus), T / S / P:
  - Latin 4.2 / 4.6 / 4.6;
  - German 4.8 / 4.9 / 4.7;
  - Greek 4.7 / 4.5 / 4.6;
  - Chinese 4.7 / 4.9 / 4.6.
- **The preregistered rule passes:** S − T ≥ −0.15 with its lower bound above −0.30, and S has no more reversal
  pages than T + 2.
- These are ceiling scores: 27 of 40 pages tie. #6728's Opus gain for PLAIN (+0.30) does not repeat on these
  pages (+0.03).

**(b) S form, (c) T form.**

| | |
|---|---|
| S replies that are valid JSON | **40 / 40** (no fence or stray text to strip) |
| markup left in S `text` | 0 pages |
| S annotations | 490: note 208, original 51, definition 44, image 16, unclear 20, margin 16, gloss 8, insert 5; summary 40, keywords 40, meta 42 |
| anchored S annotations whose `exact` is not in `text` | **0 of 367** |
| … resolved by `resolveAnchor` | **367 of 367** (offset 361, quote 6); 17 `exact`s occur more than once and the context chose |
| the model's own prefix / suffix match the text | 359 / 360 of 367 (13.7% of the reply's characters) |
| T replies with an unclosed or stray tag | 0 of 40 (one reply had text outside the markers) |

**(d) Are the notes right?** One Opus reader per page had the page image (Read tool) and the OCR. It judged every
note of T and S, pooled and shuffled, with the arm hidden.

| | T | S |
|---|---:|---:|
| notes (per page) | 258 (6.5) | 319 (8.0) |
| right | 244 (94.6%) | 291 (91.2%) |
| wrong | 12 (4.7%) | 20 (6.3%) |
| invented | 2 (0.8%) | 8 (2.5%) |
| attached to the wrong words | **36 (14%)** | **5 (1.6%)** |
| by type, wrong + invented | note 9/145 · definition 2/60 · original 3/53 | note 20/208 · definition 2/44 · original 1/51 · **image 5/16** |

- The reader was not shown the book line or the previous page, and the translator was. 7 of S's 8 "invented"
  notes draw on exactly that:
  - the edition's date (1495, 1553);
  - the title (*Der andächtige Beter*, Plotinus);
  - a place in the title line (Academia Marchica);
  - the previous page (twice).
  
  Only one ("the main theme of the treatise") has no basis.
- S's wrong + invented rate is 8.8% against T's 5.4%, +3.4 points, inside the preregistered 5. S writes 24% more
  notes, and its image descriptions are the weakest type: 5 of 16 wrong.
- The **misattachment gap is the parser's, not the model's**:
  - T's anchors are inferred, as the 3–12 words before the note on its line. A note about a name early in a clause
    gets attached to the clause's last words ("Isidore of Pelusium …" attached to "373 and 374").
  - S's anchors are the model's own `exact`.
  - For a backfill of stored notes this matters. The note is in the right place, but the phrase it "attaches to" is
    a guess, wrong 14% of the time.

**(6) Do S's anchors survive a rewrite of the English?** Two rewrites were tried. The scripted set was, per page:
a sentence put in front, one sentence deleted, two words swapped, one word re-cased with a comma added. The other
was an Opus correction pass against the source, on 20 pages (19 returned text; similarity 0.97–1.00).

| | anchors | resolved (offset / quote) | resolved where the diff lost the words (all read: right) | orphaned, words gone | orphaned, words still there | misplaced |
|---|---:|---:|---:|---:|---:|---:|
| scripted edit set (40 pages) | 367 | 0 / 320 | 19 | 26 | 2 | **0** |
| Opus correction pass (19 pages) | 191 | 119 / 62 | 5 | 5 | 0 | **0** |

The two orphans with their words still there are a six-character label ("WB-WCX") whose only context was the page
start, which the inserted sentence changed. It was orphaned, not misplaced.

**(e) Cost.** These are `claude -p` usage means per page. The run moved the box's weekly Claude meter from 72% to
74%, for about 260 Opus calls in Part B, all lanes on the box included.

| | T | S | P |
|---|---:|---:|---:|
| output tokens | 1,851 | **4,794 (2.6×)** | 1,123 |
| visible reply characters | 3,137 | 4,910 (1.57×) | 1,820 |
| prompt tokens (cache read + creation) | 6,262 | 6,852 | 5,259 |
| seconds | 20 | 44 | 13 |

S's metered output grows much more than its visible text: 1.02 characters per token against 1.69. The likely
causes are JSON escaping and the model's own reasoning, and they cannot be separated here.

### Five pages as a reader would see them

These are excerpts, about 600 characters of text each:
- **T** is today's inline form with notes on, a note shown ⟨in place⟩.
- **S** is the text with a superscript after each anchored phrase and its notes listed below, as a layered reader
  would show it.
- **P** is the text alone.

#### la-4 · Latin · De carthusiana religione panegyricum funebris threnodia in mortem illustrissimi Hessie principis gvilielmi phllippi patris ricio cordo simssusio autore aedita. De carthusiana religione panegyricum. p. 6

**T (today, notes on)**

Alas, this sovereign power could avail him nothing:
    Rather, he has just now fallen before cruel death.
There is no disgrace in having fallen beneath that foe,
    Who by a fixed law seizes all living things.
Him neither the livid weights of the whirling sling ⟨Lead shot hurled from slings, which leaves bruises⟩,
    Nor stones driven by kindled powder, can subdue ⟨A reference to cannon and firearms⟩:
Against him the triple-woven mail one wears can offer no resistance,
    Though at other times the shield-boss protects the head in safety.
Not even if you fought girded with the aegis of Pallas ⟨The protective goatskin or shield of Athena (Pallas), bearing the Gorgon's head⟩,
    And the sickle of Perseus brought you faithful aid ⟨Perseus beheaded Medusa with a curved blade given to him by the gods⟩:
The club that laid low the mon […]

**S (text + notes as their own layer)**

Alas, this commanding power could avail him nothing:
    Rather, he has just now fallen before cruel death.
It is no disgrace to have fallen beneath that foe,
    Who by a fixed law snatches away all living things.
Whom neither slings whirling their leaden weights¹²
    Nor stones driven by kindled powder³ can subdue:
Against whom no triple-woven mail⁴ one wears can stand,
    Nor the shield-boss that otherwise guards the head in safety.
Not even if you fought girded with the aegis of Pallas⁵,
    And the sickle of Perseus⁶ brought you faithful help:
The club that laid low the monstrous lion⁷ avails  […]

**Notes**
1. *leaden weights* — (original) liuentia pondera
2. *leaden weights* — Literally "livid weights": the dull grey lead bullets hurled by ancient slingers.
3. *stones driven by kindled powder* — A reference to cannon balls fired by gunpowder. The poet sets modern artillery beside the weapons of antiquity.
4. *triple-woven mail* — The Latin trilix, a coat of mail woven with triple links, a phrase familiar from Virgil.
5. *aegis of Pallas* — The aegis was the protective goatskin or shield of Pallas Athena, bearing the Gorgon's head.
6. *sickle of Perseus* — The curved blade with which the hero Perseus beheaded Medusa.
7. *the monstrous lion* — The club of Hercules, who killed the Nemean lion as the first of his labors.

Summary: The poet laments that no earthly power or weapon, ancient or modern, can resist death. He praises the prince for meeting death bravely and without complaint, and affirms that his spirit now lives in heaven.

**P (plain)**

Alas, this commanding power could avail him nothing:
    Rather, he has just fallen before cruel death.
It is no disgrace to have fallen beneath that foe,
    Who by a fixed law seizes all things that have life.
Him neither the whirling slings with their leaden weights,
    Nor stones hurled by kindled powder can subdue:
Against him triple mail, once put on, can offer no resistance,
    Nor the boss of a shield, which otherwise guards the head in safety;
Not if you should fight girded with the aegis of Pallas,
    And the sickle of Perseus should bring you faithful aid:
Nothing avails the club […]

---

#### ge-9 · German · Johann Boschenstain, Hebrayscher zungen Lerer, wünschet allen tantzern und tantzerin ein schnell umbkeren am Rayen p. 12

**T (today, notes on)**

Scripture, dancing is nowhere given praise or credit, but always something evil. The Jews danced around the calf ⟨the golden calf, Exodus 32⟩; Saul's daughter mocked David for his dancing ⟨Michal, 2 Samuel 6⟩; the wretched little maid of Herod danced for the head of John, the holy Baptist ⟨Salome, Mark 6 and Matthew 14⟩. Indeed, a thousand more instances could be told where dancing is always a vice and never a virtue. Listen, you dear dancers, men and women: you have never had a good foundation in Holy Scripture for your foolish, sinful game.

Dancing is also entirely against nature and against all good order. Where is a man or a woman more like a senseless, irrational beas […]

**S (text + notes as their own layer)**

Scripture, no reward or praise of dancing is mentioned anywhere, but always evil. The Jews danced around the calf¹; Saul's daughter mocked David for his dancing²; the vile little maid of Herod danced for the head of John³, the holy Baptist. Indeed, a thousand more instances could be recounted where dancing is always a vice and never a virtue. Listen, you dear dancers, men and women: you have never had any good foundation in Holy Scripture for your foolish, sinful game. Dancing is also entirely against nature and against all good order. Where is a man or a woman more like a senseless, irrational b […]

**Notes**
1. *The Jews danced around the calf* — The golden calf in Exodus 32, around which the Israelites danced while Moses was on Mount Sinai.
2. *Saul's daughter mocked David for his dancing* — Michal, daughter of King Saul, despised David for dancing before the Ark of the Covenant (2 Samuel 6:16-20).
3. *the vile little maid of Herod danced for the head of John* — The daughter of Herodias, unnamed in the Gospels and traditionally called Salome, danced before Herod Antipas and asked for the head of John the Baptist as her reward (Mark 6:21-28).

Summary: Agrippa's text, in Böschenstein's German, argues that Scripture never praises dancing and cites the golden calf, Michal's scorn of David, and Salome's dance as proof. He calls dancing a bottomless pool of vices and blames gorging, drinking, and dancing for the excesses that forced towns to regulate wedding feasts.

**P (plain)**

Scripture, no praise or honor of dancing is mentioned anywhere, but always evil. The Jews danced around the calf; Saul's daughter mocked David for dancing; the shameless little maid of Herod danced for the head of John, the holy Baptist; indeed, a thousand more examples could be told, where dancing is always a vice and never a virtue. Listen, you dear dancers, men and women: you have never had a good foundation from Holy Scripture for your foolish, sinful game. Dancing is also entirely against nature and all good order. Where is a man or a woman more like a senseless, irrational beast than at  […]

---

#### gr-6 · Greek · Stoicorum Veterum Fragmenta, vol. 4: Indices p. 14

**T (today, notes on)**

# INDEX
## OF WORDS, NOTIONS, AND THINGS PERTAINING TO STOIC DOCTRINE.

---

### A

**ἀβλαβής ⟨definition: harmless⟩ ** that all good people are **harmless**, *explained* III 154, 10. 12
**ἀγαθόν; ἀγαθά ⟨definition: good; goods⟩ **
(for "noble and good" ⟨original: original: "καλὸν κἀγαθόν," the Greek ideal of the perfect gentleman⟩ *see under* καλόν ⟨definition: noble, beautiful⟩; for the highest good *see under* τέλος ⟨definition: end, goal⟩)
On Goods, *title of a book* by Chr. III 194, 4
the topic of goods and evils, *a part of ethics* III 3, 2; one cannot approach the account of goods and evils except from common nature 17, 4-11. 80, 37; the account of goods and evils touches most closely on the innate preconceptions ⟨original: original: "ἔμφυτοι προλήψεις," the natural notions that every human mind forms⟩ 17, 13; *the good is perceived and named not by compar […]

**S (text + notes as their own layer)**

# INDEX
## OF WORDS, CONCEPTS, AND MATTERS PERTAINING TO STOIC DOCTRINE.

---

### A

**ἀβλαβής** harmless: that all good people are harmless, explained III 154, 10. 12¹
**ἀγαθόν· ἀγαθά** good; goods
(for "noble and good" see under καλόν; for the highest good see under τέλος)
On Goods, title of a book by Chr. III 194, 4
the topic of goods and evils, a part of ethics III 3, 2; one cannot approach the account of goods and evils except from common nature 17, 4-11. 80, 37; the account of goods and evils touches most of all on the innate preconceptions² 17, 13; the good is perceived and named not by  […]

**Notes**
1. *explained III 154, 10. 12* — References give the volume of the Stoicorum Veterum Fragmenta in Roman numerals, followed by page and line numbers. Later references without a Roman numeral stay in the same volume.
2. *the innate preconceptions* — The Stoics held that human beings naturally form basic notions, called prolepseis or preconceptions, of things such as good and evil. Chrysippus treated these as a starting point for ethical reasoning.

Summary: This first page of von Arnim's subject index opens the letter A with entries on harmlessness and on the good. It gathers the Stoic definitions of the good as benefit and virtue, its identity with the noble, and the classes of goods.

**P (plain)**

# INDEX
## OF WORDS, NOTIONS, AND THINGS PERTAINING TO STOIC DOCTRINE.

---

### A

**harmless**: that the good are **all** harmless *explained* III 154, 10. 12
**good; goods**
(noble-and-good *see under* noble; *the highest good under* end)
On Goods *title of book* Chr. III 194, 4
the topic concerning goods and evils *part of ethics* III 3, 2 one cannot approach the account of goods and evils except from common nature 17, 4-11. 80, 37 that the account of goods and evils touches most of all upon the innate preconceptions 17, 13 *the good is perceived and named not by comparison with other thin […]

---

#### ch-2 · Chinese · 李卓吾先生批評浣紗記 (The Tale of Washing Silk, with Li Zhuowu's Commentary) p. 89

**T (today, notes on)**

# Table of Contents of *The Tale of Washing Silk*, with Commentary by Master Li Zhuowu

 ⟨Li Zhuowu is Li Zhi (1527–1602), a famously unconventional Ming thinker. Many commentaries printed under his name were likely produced by publishers seeking to profit from his reputation.⟩### Second Volume

| | |
| :--- | :--- |
| Scene 23 ⟨original: original: "齣," the standard unit of a Ming southern drama, often translated "scene" or "act"⟩ | Welcoming Xi Shi ⟨Xi Shi is the legendary beauty whom Fan Li of Yue sends to the King of Wu.⟩ |
| Scene 24 | Dispatching a Petition |
| Scene 25 | Rehearsing the Dance |
| Scene 26 | Entrusting the Son ⟨Wu Zixu, the loyal minister of Wu, entrusts his son to a family in the state of Qi.⟩ |
| Scene 27 | Parting from Xi Shi |
| Scene 28 | Audience with the King |
| Scene 29 | The Sovereign's Farewell ⟨original: original: "聖別"; "聖" here refers to the ruler.⟩ |
| Scene 30 | Gathering Lotuses | ⟨A small square red ink seal appears at the bottom right of the table. It is probably a collector's or publisher's mark.⟩

**S (text + notes as their own layer)**

# Table of Contents of The Tale of Washing Silk, with Commentary by Master Li Zhuowu¹

### Second Volume²

| | |
| :--- | :--- |
| Scene 23³ | Welcoming Xi Shi⁴ |
| Scene 24 | Sending an Envoy with a Petition |
| Scene 25 | Rehearsing the Dance |
| Scene 26 | Entrusting the Son⁵ |
| Scene 27 | Parting from Xi Shi |
| Scene 28 | Audience with the King |
| Scene 29 | The Royal Farewell⁶ |
| Scene 30 | Gathering Lotuses⁷ |

**Notes**
1. *Master Li Zhuowu* — Li Zhuowu is the literary name of Li Zhi (1527 to 1602), an iconoclastic Ming thinker. Many late Ming publishers attached his name to drama and fiction commentaries to boost sales, so some of these commentaries may not be his own work.
2. *Second Volume* — (original) 下卷
3. *Scene 23* — (definition) Each entry is a chu (齣), the standard unit of a long Ming southern drama (chuanqi), roughly equal to a scene or act.
4. *Welcoming Xi Shi* — Xi Shi is the legendary beauty of the state of Yue, found washing silk by a stream. The play tells how the Yue minister Fan Li presents her to King Fuchai of Wu so that her charms will weaken the rival kingdom.
5. *Entrusting the Son* — In this scene the loyal Wu minister Wu Zixu, foreseeing his state's ruin, leaves his son in the care of a friend in the state of Qi.
6. *The Royal Farewell* — The title reads literally "sage parting"; "sage" is a conventional term of respect for the ruler, so the scene marks a farewell involving the king.
7. *Gathering Lotuses* — (image) A small square red ink seal appears at the bottom right of the table of contents, probably the mark of a collector or publisher.

Summary: This page lists scenes 23 to 30 in the second volume of Liang Chenyu's Ming drama The Tale of Washing Silk, in an edition carrying commentary attributed to Li Zhuowu. The scenes cover Xi Shi's journey to the court of Wu and Wu Zixu's arrangements for his son.

**P (plain)**

# Table of Contents of *The Tale of Washing Silk*, with Commentary by Master Li Zhuowu

### Second Volume

| | |
| :--- | :--- |
| Scene Twenty-Three | Welcoming Xi Shi |
| Scene Twenty-Four | Sending an Envoy to Plead |
| Scene Twenty-Five | Rehearsing the Dance |
| Scene Twenty-Six | Entrusting the Son |
| Scene Twenty-Seven | Parting from Xi Shi |
| Scene Twenty-Eight | Audience with the King |
| Scene Twenty-Nine | The Royal Farewell |
| Scene Thirty | Gathering Lotuses |

---

#### ge-10 · German · Metallischer Baumgarten p. 76

**T (today, notes on)**

The primum mobile ⟨definition: the "first moved" sphere, the outermost heaven that drives all the others⟩ and the **stars** ⟨original: original: "Astra"⟩, under which the warmth of the sun is also to be understood, must therefore carry forward and ripen all things through their invisible breath and fire, which is properly called the heavenly fire.

Fire, as the foremost element, moves and drives the other elements so that they must act. Through its warmth it promotes **growth** ⟨original: original: "Wachsthum"⟩, and it keeps each thing in constant living motion for as long as that thing is meant to live; yet the air must also contribute its share to this.

All the seed that the earth holds within itself passes into **putrefaction** ⟨original: original: "Fäulung"⟩ through th […]

**S (text + notes as their own layer)**

The primum mobile¹ and the stars², under which the warmth of the sun is also to be understood, must therefore bring forth and ripen all things through their invisible breath and fire, properly called the heavenly fire³.

Fire, as the foremost element⁴, moves and drives the other elements, so that they must act; through its warmth, moreover, it promotes growth and keeps each thing in constant living motion for as long as it is meant to live; yet the air must also contribute its share.

All seed that the earth holds within itself passes into putrefaction⁵ through the warmth stirred up by the stars, a […]

**Notes**
1. *primum mobile* — (definition) Latin for 'first mover': in medieval and early modern cosmology, the outermost heavenly sphere, which set all the inner spheres of the heavens in motion.
2. *the stars* — (original) Astra
3. *properly called the heavenly fire* — The author distinguishes this invisible celestial fire, which works through the stars and the sun, from ordinary burning fire. Alchemists held that this heavenly influence ripened metals in the earth just as it ripened plants.
4. *as the foremost element* — Of the four classical elements (fire, air, water, earth), fire was often ranked highest because it was thought to be the most active and the least bound to matter.
5. *putrefaction* — (definition) Rotting or decay. In alchemy and natural philosophy, putrefaction was the necessary first stage of all generation: a seed must first break down before new life can grow from it.

Summary: The author explains how the heavenly fire of the stars and sun, working with air and moisture, drives growth, putrefaction, and the ripening of all things. Fire is presented as the chief element, which alone can perfect, fix, and also break substances down into their first principles.

**P (plain)**

The prime mover and the stars, among which the warmth of the sun is also to be understood, must therefore advance and ripen all things through their invisible breath and fire, properly called the heavenly fire.

Fire, as the foremost element, moves and drives on the other elements so that they must act; but through its warmth it promotes growth, and keeps each thing, for as long as it is meant to live, in constant living motion; yet the air must also contribute its own share to this.

All seed that the earth holds within itself passes into putrefaction through the warmth stirred up by the star […]

### Recommendation

**Adopt S for new translations on the Opus CLI lane, with conditions. It is not yet the default anywhere, and not
for the Gemini lanes.** Every preregistered condition passes:
- fidelity not worse;
- 100% valid JSON;
- 100% of anchors resolve;
- wrong + invented within 5 points;
- 0 anchors misplaced after rewrites.

S maps straight onto the storage Derek chose on 2026-10-10: `text` becomes `translation.text`, and the annotations
become one `page_annotations` document, with no parser in between.

Conditions:
1. **Storage first.** S needs roadmap step 2 (`translation.text` + `page_annotations` + the `text_from` accessor).
   Until then an S reply has nowhere to go. Writing it back into `translation.data` as tags would undo the point.
2. **Not the Gemini lanes yet.** Most production translation runs on Flash and Flash-Lite. JSON validity, anchor
   quality and thinking cost there are unmeasured. Repeat (b), (d) and (e) on 40 Flash/Lite pages before switching
   any Gemini lane.
3. **Cut the cost before scaling.** Drop `prefix`/`suffix` from the model's reply and compute them from `exact`.
   The model's matched 98% of the time anyway, and they are 14% of the reply. Then re-measure tokens: the 2.6× is
   the price of the current form.
4. **Image descriptions are the weak note type** (5 of 16 wrong in S). Check them against the image in the notes
   step, or keep them out of S until checked.
5. **Backfill of stored pages uses the parser, and its phrases are guesses.** Store backfilled anchors as positions
   (the note followed these words, `attach: 'after'`) and mark them inferred. Do not present them as the words the
   note is about: 14% are not.

**What this does not change.** The default prompt stays v13. The prompt switch (roadmap step 5) remains Derek's
decision. The roadmap's other route, a plain translation plus a separate notes step, is not ruled out: P was not
worse than T here either. S is the cheaper path where one Opus call should produce both layers.

### Threats and limits

- These are AI judges against the source, not a scholar. The scores sit at the ceiling (T 4.60), so a small loss
  could hide under the ties. The planted controls were all found.
- Opus judged Opus output (Part B (a)). The Gemini judge on 20 pages agrees in direction.
- The note reader saw the page and OCR, but not the book line or the previous page the translator saw. That
  overstates "invented" for whichever arm uses context more, here S.
- Part A's "truth" is a word diff. On a re-translation it loses words that did survive in other wording. Those
  cases were resolved by the parser and read by eye; none was wrong.
- One run per arm; no A-vs-A floor for S. Chinese drew from 87 unheld books.
- *Grade:* moderate for the parser (n = 3,000, by-eye read); preliminary for S (40 pages, one model).
