# How Do You Search for "Sex, Drugs, and Aliens" in a Library of 17,000 Pre-Modern Books?

*On the three layers of search, and why finding Huygens's extraterrestrials requires more than a search box.*

---

## The Experiment

We asked a simple question: can you search Source Library for sex, drugs, and aliens?

The results were humbling. Searching "sex" returned Latin titles containing the word *sex* — meaning *six*. Frontinus's *De re militari*, Vitruvius's architecture books, Lipsius's *Six Books of Politics*. Searching "drugs" found Pliny cataloging "47 drugs from copper scales" and Sushruta describing "sweet, bitter, and astringent drugs." Searching "aliens" returned the Federalist Papers discussing immigration policy and Plato's *Laws* on the rights of resident foreigners.

None of this is wrong. These are real matches for these words. But none of it is what you meant. You meant erotica, psychoactive substances, and life on other worlds. And all of those things *are* in the library — we just couldn't find them.

## What's Actually in There

Once we stopped searching like a computer and started thinking like a librarian, the results transformed.

**Erotica:** Vatsyayana's *Kama Sutra* (1883 Burton translation and 1912 Sanskrit original). Edo-period Japanese *shunga* prints. Boccaccio's *Caccia di Diana*. The *Scriptores Erotici Graeci* — Longus, Heliodorus, Achilles Tatius. Martial's epigrams, where he casually jokes about using his hand "instead of a Ganymede." Herodas's *Mimes*, where two Greek women discuss the craftsmanship of a leather dildo.

**Psychoactive substances:** Avicenna's *Canon of Medicine* contains a remarkable index entry: "Opium is stronger than all stupefying agents... the weight of 11 drachms is fatal in two days... Opium works more when taken with wine." Paracelsus's "Holy Laudanum." Hartmann's 1684 pharmacology with the memorable note: "Opium does not stimulate Venus... but prolongs the act of Venus." Gruling's 1665 observation that "opium is nothing other than the tear or gum of a certain poppy in Cambay."

**Life on other worlds:** Christiaan Huygens's *Kosmotheoros* (1699) seriously argues for extraterrestrial life, discusses "the physical anatomy of extraterrestrial beings," and claims their logic and geometry "must be identical to ours." Kepler's *Somnium* (1634), a fictional voyage to the moon with detailed descriptions of lunar creatures. Cyrano de Bergerac's *Comical History of the Moon* (1654), the original science fiction moon voyage. Francis Godwin's *Man in the Moone*.

All of it was there. The problem was finding it.

## Three Layers of Search

Finding pre-modern content with modern vocabulary requires three fundamentally different approaches. Each catches things the others miss. None is sufficient alone.

### Layer 1: Keywords

Keyword search is the backbone. You type a word, the system finds pages containing that word. It's fast, precise, and scales to millions of pages. Atlas Search indexes every word in every OCR transcription and translation across 17,000 books.

**What it catches:** When the exact word exists in the text. Searching "opium" finds Avicenna's index entry. Searching "masturbator" finds Martial's epigram on page 392: *"Make even Hippolytus a masturbator."* Searching "extraterrestrial" finds Huygens because our AI translation used that modern English word to describe what Huygens was writing about in Latin.

**What it misses:** Everything where the concept exists but the word doesn't. "Masturbation" misses "masturbator" (different suffix). "Aliens" misses "inhabitants of other worlds." "Drugs" misses "opium." The vocabulary gap between the 21st century and the 16th century is vast, and keyword search can't bridge it.

**The morphology trap:** We added fuzzy matching for long single words — "masturbation" now matches "masturbator" within one edit distance. But this is a band-aid. The real problem isn't spelling variants; it's that concepts change names across centuries.

### Layer 2: Semantic Embeddings

Embedding search converts both the query and every book's content into points in a 768-dimensional vector space. Books that are *about* similar things end up near each other, regardless of the specific words used. We embed each book using a rich text composed from its AI-generated summary, vocabulary index, named entities, and topic keywords.

**What it catches:** Conceptual proximity. Searching "extraterrestrial beings" finds Huygens's *Kosmotheoros* even though those exact words don't appear in the book's title — the embedding captures that the book is *about* life on other worlds. Searching "erotic love desire" finds Boccaccio and the *Dialogues of Love* because they occupy similar regions in meaning-space.

**What it misses:** Lateral connections that require world knowledge. Would embedding find the story of Onan from a search for "masturbation"?

Almost certainly not. Genesis 38 tells the story of Onan, who refuses to impregnate his dead brother's widow (a duty called levirate marriage) and "spills his seed on the ground." God kills him for this disobedience. The actual biblical text is about **coitus interruptus, filial duty, and divine punishment** — the word "masturbation" appears nowhere, and the semantic content is about obedience to kinship law.

The connection between Onan and masturbation was forged *centuries later*, when the Swiss physician Samuel Tissot published *L'Onanisme* in 1760, reinterpreting Onan's "spilled seed" as a general warning against self-pleasure. The word "onanism" ��� meaning masturbation — is a cultural artifact, not a textual one. It exists in the history of ideas, not in embedding space.

An embedding model trained on modern text might weakly associate "Onan" with "masturbation" because they co-occur in modern discussions, but the biblical text itself — describing a man's refusal of levirate duty — would not be near "masturbation" in any meaningful way. The connection requires *knowing the history of the word's reinterpretation*, which is exactly what the third layer does.

### Layer 3: LLM Query Expansion

When you search Source Library, a language model reads your query and generates context: a brief scholarly note explaining the concept, plus a list of expanded search terms — Latin equivalents, historical spellings, key authors, related works.

Search "aliens" and the model might generate: *"The plurality of inhabited worlds was a major theme in early modern natural philosophy. Fontenelle's Entretiens and Huygens's Kosmotheoros argued that other planets must harbor intelligent life."* Plus expanded terms: `["Kosmotheoros", "plurality of worlds", "Somnium", "lunar inhabitants", "Fontenelle"]`.

Each expanded term is then searched via the keyword and semantic layers. This is the bridge that connects modern concepts to their pre-modern incarnations.

**What it catches:** The things only a knowledgeable human would think to search for. "Masturbation" → "onanism" → Tissot → Onan → Genesis 38. "Drugs" → "opium, laudanum, Paracelsus, materia medica." "Aliens" → "Kosmotheoros, Somnium, plurality of worlds." The model does exactly what a scholar does: it translates between vocabularies, names specific texts, and bridges centuries of terminological drift.

**What it misses:** It's only as good as the model's training. Obscure connections — a specific passage in a specific medieval manuscript — won't be expanded unless the model happens to know about it. And it adds latency: generating expanded terms takes 1-2 seconds, which is noticeable in a search interface.

## Why All Three Layers Matter

Each layer has a different failure mode:

| Layer | Finds | Misses |
|-------|-------|--------|
| **Keywords** | Exact words in text | Concepts under different names |
| **Embeddings** | Conceptual neighbors | Lateral/etymological connections |
| **LLM Expansion** | Cross-century vocabulary bridges | Obscure passages the model doesn't know |

Searching "masturbation" without all three:
- Keywords alone → 3 copies of Tissot (the word is in the title) and nothing else
- Embeddings alone → Pseudo-Aristotle's reproductive physiology, monastic texts on self-discipline
- LLM expansion alone → would generate "onanism, Priapeia, Martial" but couldn't search them

Together: Tissot (keyword), Martial's "masturbator" (fuzzy keyword), the *Secret of Secrets* on sexual physiology (embedding), Diogenes Laertius and the olisbos of Herodas (LLM expansion → keyword).

## The Deeper Problem: Text Has to Exist

All three layers share a dependency: the text must be in the system. Herodas's *Mimes* — containing one of the most famous sexual passages in Greek literature — exists in our library as three editions. But none have been through the OCR and translation pipeline yet. No text means no keywords, no embeddings, no enrichment data. The book is invisible to every search layer.

This is the unsexy infrastructure problem beneath every search improvement. You can build the most sophisticated retrieval system in the world, but if the Loeb Herodas is sitting there with 1 page and status "draft," no one will ever find the cobbler and his leather goods.

## What We Learned

1. **Modern words are terrible search terms for pre-modern content.** "Sex" means six. "Drugs" means remedies. "Aliens" means foreigners. The vocabulary gap is the fundamental challenge.

2. **Embeddings bridge concepts but not etymologies.** Vector similarity finds books that are *about* similar things. It doesn't know that "onanism" was coined in 1760 by reinterpreting a Bronze Age kinship law.

3. **LLMs are the missing bridge.** A language model can reason: "the user means psychoactive substances → opium was the major one → Avicenna and Paracelsus wrote about it → search those terms." No other technology does this.

4. **The three layers are complementary, not competing.** Keywords for precision, embeddings for conceptual discovery, LLM for vocabulary translation. Remove any one and the system goes blind to a class of queries.

5. **Pipeline coverage is the ceiling.** The most brilliant search architecture can't find text that hasn't been transcribed. Every unprocessed book is a hole in the collection's searchability.

---

*Source Library is a digital library of 17,000+ rare historical books, freely searchable at [sourcelibrary.org](https://sourcelibrary.org). All translations are AI-generated and released under CC BY-SA 4.0.*
