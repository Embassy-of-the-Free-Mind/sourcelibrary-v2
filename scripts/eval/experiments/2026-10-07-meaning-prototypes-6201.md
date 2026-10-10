---
stage: pipeline
measure: [accuracy, judged]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "A centred emblem image vector ranks the right Atalanta fugiens passage first for 34 of 44 emblems (5 uncentred); a see-also list from a page finds a real parallel only 13 of 75 times."
status: informational
decision: null
superseded_by: null
issue: 6201
---
## 2026-10-07 · Two cheap prototypes on the stored page vectors: does a picture find its passage, and can one page propose the same idea in other traditions? (#6201)
<!-- PRIOR ART: 2026-10-07-embedding-granularity-cross-tradition.md (#6173; typed concept queries over the same pool, never a page as the query, and it lists the see-also case as "not tested"); 2026-10-04-clef-page-image-screens.md (#5803; a decision model asked whether a text transcribes an image, not an embedding). Neither embeds an image into the page-text space or ranks pages from a page. -->

- **Question.** Two opportunities in `.claude/docs/embeddings-opportunities.md` had no measurement: (1) linking a plate to the passage that explains it, and (2) a "same idea in other traditions" list on a page. Can either be built from vectors we already hold?
- **Answer.**
  - **(1) Yes, inside a book, with one correction.** The picture of an *Atalanta fugiens* emblem ranked a page of the right emblem first for **34 of 44** emblems in a picture-less English manuscript translation (chance is 3 in 194), once the image and page vectors were each centred on their own mean. Without centring it was 5 of 44. The one-line gallery description, embedded as text, did the same (34 of 44; 39 of 44 in the top three).
  - **A raw image vector is not usable against the whole library.** `match_semantic` returned dictionaries and near-empty pages for every picture tried. Image and text vectors from `gemini-embedding-2` sit in separate regions of the space.
  - **(2) Not as a list on every page.** From a page squarely about an idea, the nearest page in each other tradition was a real parallel **13 times in 75** with concept vectors and **9 in 75** with page vectors. Similarity did not separate the good proposals from the rest. 9 of 25 seed pages got at least one real parallel.
- **measure:** (1) accuracy against a known answer (the emblem number); top-1 over 44 emblems, single run. (2) accuracy against blind by-eye grades from one AI reader (`read-from-text`; not a human reference), 25 seeds × 3 proposals × 2 arms. Both are small and directional.

### Design

**(1) Picture to passage** (`scripts/eval/meaning-prototypes/image-to-passage.mjs`).
- **Source.** The 44 emblem engravings the gallery holds for the Oppenheim 1618 *Atalanta fugiens* (`69520c46ab34727b1f044141`), cropped (`gallery_images.extracted_url`). Emblems 5, 7, 26, 27, 36 and 50 have no usable crop.
- **Target.** The c. 1625 English manuscript translation (`86fe639a-5f3d-4e9e-9d99-128742a10809`), 194 pages with a stored vector. It has no pictures. Emblem N fills pages 22+3(N−1) to 24+3(N−1): motto and epigram, then two pages of discourse. Checked by eye at emblems 1, 3, 21 and 48.
- **Arms.** All ranked exactly against the stored `page_translations` vectors of the target.
  - `image`: the crop embedded as an image (`gemini-embedding-2-preview`, 768 dims).
  - `centred`: the same, after subtracting the mean of the 44 image vectors from each query and the mean of the 194 page vectors from each page.
  - `words`: `gallery_images.description` embedded as text.
- **Leak check.** The crop for emblem 21 was read by eye and holds no printed motto. The `words` arm is not clean: the vision model that wrote the descriptions saw the whole page, and 9 of the 44 descriptions name the myth (Latona, Osiris, Oedipus).

**(2) See also from a page** (`see-also.mjs`).
- **Pool and vectors.** The #6173 pool as built (12,154 English pages, 304 books, a by-eye tradition label per book) and its stored page vectors (`vec-a`) and concept-abstract vectors (`vec-c`). No new model calls.
- **Seeds.** The 84 gold passages marked `central`. For each, the nearest page in every other tradition (never the seed's book), keeping the three closest traditions.
- **Grading.** One seed per idea drawn at random (seed 6201): 25 seeds, 150 proposals, 148 distinct. An AI reader graded each from the page text with the arm hidden, on the #6173 rubric (2 = states or develops the idea, 1 = touches it, 0 = not about it).

### Results

**(1) Rank of the first page of the right emblem, 44 emblems, 194 candidate pages**

| arm | top 1 | top 3 | MRR |
|---|---|---|---|
| image | 5 | 12 | 0.25 |
| centred image | **34** | 35 | 0.80 |
| words (gallery description) | **34** | 39 | 0.84 |

- Example, checked by eye: the engraving for emblem 21 (a man with compasses drawing a circle around a triangle, a square and two figures) ranks manuscript page 84 first, "Discourse 21 … the squaring of a circle", and page 82, the motto of emblem 21, second.
- The `words` vector sent to the whole library returned the same emblem in other books: for emblem 29, the salamander in the hand-coloured French manuscript copy (Manly P. Hall Collection, Box 27, p. 71), in Lambspring (1625), in Jacob Cats's *Maegden-plicht* (1618) and in the *Musaeum Hermeticum* (1678). The Hall and Cats pages were checked against their images, the other two from the returned text. Not scored.
- Centring uses the target book's own mean, so it is an in-book operation. A library-wide version needs a mean over a sample of all page vectors and its own test.

**(2) Blind grades of the three proposals per seed**

| vectors | grade 2 | grade 1 | grade 0 | seeds with a grade 2 |
|---|---|---|---|---|
| page (stored today) | 9 of 75 (12%) | 17 | 49 | 7 of 25 |
| concept abstract | 13 of 75 (17%) | 26 | 36 | 9 of 25 |

- Concept vectors, by similarity third: 6, 5 and 2 grade-2 proposals of 25 each. No threshold makes the list reliable.
- When it works it is good. From Plato's myth of Er (*Republic* X, p. 479) the three proposals were all graded 2: where souls dwell after death in the *Daqāʾiq al-ḥaqāʾiq* (p. 29), the soul sent to Yama's realm in the *Brahma Purana* (p. 592), and the field of the blessed in the German *Vision of Tundale* (1476, p. 314).

### What follows

- **Picture to passage is worth a build**: in-book first (every emblem book and every illustrated treatise), using the description text as the query, which needs no new index. Next test: 5 more illustrated books with a known plate-to-chapter key, and a clean description written from the crop alone.
- **See-also needs a second step before any reader sees it**: a model that reads both passages and either states the shared idea or drops the pair. `measurement-instruments.md` applies: a ranked list on a page is read as meaningful. A page per idea, gathered from a typed query and checked, is the stronger form (#6173 measured that case).
- **Cost of this run.** 44 image embeddings and 44 short texts, under $0.01, logged to `gemini_usage` as `eval/meaning-prototypes` and `eval/embed-granularity`. Results: `scripts/eval/meaning-prototypes/results/`.
