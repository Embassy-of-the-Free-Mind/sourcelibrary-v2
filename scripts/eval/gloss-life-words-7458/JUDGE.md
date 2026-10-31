# Judge instructions: three translations of one page (#7458)

You are judging English translations of pages from historical books: Chinese, Sanskrit, Latin, German and French. The
three translations of each page are labelled X, Y and Z, and the order is random. They come from the same model under
slightly different instructions. Do not guess which is which; judge each one on its own against the source.

For each page in your packet you get:
- `image`: the page image. **Open it with the Read tool and look at it.** The image is the authority.
- `source_text`: a machine transcription of the page. It may contain misreadings; where it disagrees with the image,
  the image wins.
- `book`: title, language and date.
- `translations`: X, Y, Z. Each one is the English plus the translator's inline apparatus:
  - `<gloss>` and `<term>` give a short definition beside a kept word;
  - `<note>` is an explanatory note;
  - `<summary>` and `<keywords>` are for indexing, and you can ignore them.
  The apparatus is part of what a reader reads, so judge it as part of the translation.

## For each translation, give

1. **fidelity**, 1–5, for the whole page, apparatus included:
   - 5: complete and accurate.
   - 4: minor slips that do not change the sense.
   - 3: some errors of sense, or a small omission.
   - 2: a major omission, invented content, or several errors of sense.
   - 1: mostly wrong, or not a translation of this page.
   Do not reward or penalise style, length or the number of notes as such. A note that says something false about the
   text is an error.

2. **Life words.** Find every place where the translation renders a source word for any of these: breath, vapour,
   air, qi (氣/气), prāṇa, āyus, jīva, 命, pneuma, spiritus, anima, soul, life, lifespan, vigour, or a named vital
   force. Look in the running English and in every gloss, term and note. Count:
   - `life_words_correct`: renderings that say what the word means here;
   - `life_words_wrong`: renderings that say something else.
     - This includes calling breath, vapour, air or lifespan a "life force", "vital energy", "vital force" or
       "energy", in the text or in a gloss or note.
     - It also includes a note that reads a modern idea of a vital force into a word the source does not use that
       way.
     - Where the source itself names a vital force (Lebenskraft, vis vitalis, force vitale), "life force" or "vital
       force" is **correct**. Dropping or blurring that term is **wrong**.
   - `life_wrong_examples`: up to 3 short quotes of the wrong renderings, each with the source word.

3. **serious_errors**: a list. Each item is `{ "type": "omission" | "invention" | "mistranslation", "what": "<short quote or description>" }`.
   - omission: source text left out;
   - invention: text with no source;
   - mistranslation: a rendering that changes the sense of a sentence.
   Only list errors a careful reader would care about. Trivial slips go into the fidelity score, not here.

## Output

Write ONE JSON array to the output file you are given, and nothing else in it:

```json
[{ "id": "G01",
   "translations": {
     "X": { "fidelity": 4, "life_words_correct": 2, "life_words_wrong": 1, "life_wrong_examples": ["<gloss>vital energy</gloss> for 氣"], "serious_errors": [] },
     "Y": { "fidelity": 4, "life_words_correct": 3, "life_words_wrong": 0, "life_wrong_examples": [], "serious_errors": [] },
     "Z": { "fidelity": 3, "life_words_correct": 2, "life_words_wrong": 0, "life_wrong_examples": [], "serious_errors": [{ "type": "omission", "what": "last two lines of the column" }] } },
   "note": "<one line, optional>" }]
```

Every page in the packet gets an entry. If an image will not open, judge against the source text and say so in `note`.
