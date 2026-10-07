# Embeddings: what they are for, and what to build next

<!-- PRIOR ART: .claude/docs/embeddings.md — the stores, writers, readers and costs (how it works; no ranking of uses). scripts/eval/experiments/2026-10-07-embedding-*.md — four evals of model, format, unit and lane (each answers one question). Neither surveys uses or ranks them. Issue #6201. -->

**Read this when** you are deciding what to build on the vectors, or someone asks what the "meaning layer" is for. How the stores work is in `embeddings.md`. The public version of this page is `/about/meaning`.

Living doc. Written 2026-10-07 (#6201). Update the status column when something ships; re-rank when an eval changes a number.

## What we hold

- **One vector per page** (`page_translations`, about 6.7M rows, `gemini-embedding-2`, 768 dims): the English translation when there is one, else the original text.
- **One per book**, one per picture description (about 117K), one per artwork, and a separate CLIP vector per picture (about 152K) for visual likeness.
- Readers today: site search, in-book search, the Librarian, the MCP tools (`search_concept`, `search_translations`, `search_within_book`, `search_images`), gallery "similar", `/identify`.

## What today's evals say the layer cannot yet do

| need | measured today | source |
|---|---|---|
| An English question finds an untranslated page | right page in the top 10 for **0.10** of queries through the shared index; **0.64** in a lane of its own; 0.93 in a small pool | `2026-10-07-orig-lang-embedding-recall-5729.md` |
| A concept search shows several traditions | **1.68** traditions with a relevant page in the top 10; **2.80** with a plain-language abstract per page; 15 of 25 queries stuck at one tradition, 4 with the abstract | `…-embedding-granularity-cross-tradition.md` |
| The stored vector matches its own text | 16% of sampled vectors have cosine < 0.9 with a fresh embed of their text; 2.1% are from another model | `…-embedding-models-qwen3-dual.md`, #6175 |
| A different model would do better | no model or format clears the bar; preview and GA `gemini-embedding-2` are identical | `…-embedding-format-ga.md`, `…-qwen3-dual.md` |

Three repairs are in flight and are **prerequisites, not opportunities**: the untranslated-pages lane (#5729), tradition labels with a diversity re-rank (#4773, #3514), and vector integrity (#6175). Everything below assumes them.

## The opportunities, ranked

Mission value = does it put primary sources in front of a reader who would not have found them. Cost is model spend to a first public result, not engineering time.

| # | opportunity | mission | feasible on our stack | model cost | state |
|---|---|---|---|---|---|
| 1 | **A page per idea**: passages on one idea from several traditions, each checked and quoted | high | high: #6173 gold set is 25 ideas, 252 checked passages | $0 for the first 25; about $50 for the staged concept lane | gold set exists; no page |
| 2 | **Picture ↔ passage**: a plate links to the page that explains it, and back | high | high in-book: picture descriptions are already vectors in the same space | $0 in-book | prototype: 34 of 44 emblems |
| 3 | **A public benchmark** for historical cross-lingual retrieval | high (credibility, partners) | high: four gold sets, 116 queries | $0; needs a human pass | sets exist, AI-read |
| 4 | **Demand map**: which untranslated books do searches keep landing on | high | high: `search_queries`, `mcp_tool_calls` | under $1 | not built |
| 5 | **Text reuse across languages**: translations, borrowings, the same passage in another edition | high for scholars | medium: needs paragraph units and an alignment step | $0 to pilot one cluster; about $100–300 corpus-wide | not built |
| 6 | Quality screens: translation that does not match its page; text that does not match its image | high | medium | about $120 for a second vector per translated page | Clef does the image check without embeddings (#5803) |
| 7 | "Same idea elsewhere" on every reader page | high if right | **low today**: 13 of 75 proposals were real parallels | about $0.002 a pair for a checking step | prototype: not shippable as a bare list |
| 8 | An idea over time: share of pages near a concept, by half-century and language (#3215) | medium | high | $0 | not built |
| 9 | Map of the library by meaning | medium (entry point, press) | high: `/research/atlas` exists on an older model and 8,937 books | $0 | rebuild from `book_embeddings` |
| 10 | Glass Bead Game in public: a path of passages between two ideas | medium | medium | per-session | skill only |
| 11 | Grounded answers for other sites; published citation accuracy for MCP | medium | high | $5–20 for the eval | MCP live; no accuracy number |
| 12 | Same woodcut in another book | medium | medium: CLIP proposes, a geometric check must confirm | $0 | `clip_embeddings` has known drift (#5195) |
| 13 | Unknown editions and witnesses | medium | medium | $0 | `check-duplicate` uses book vectors |
| 14 | Dating and attributing anonymous texts | low | low: these vectors hold topic, not style; our OCR normalises spelling | n/a | not proposed |
| 15 | Recommendations, reading trails | low | high | $0 | not proposed |

### Why this order

1. **A page per idea** is the only item whose content is already checked. The #6173 gold set has, for "what happens to the soul after death", passages from Plato, a Sufi manuscript, a Purana and a 1476 German vision, each with a verbatim quote and a URL. Publishing those 25 as pages costs nothing and shows the library's subject in one screen. The concept lane then proposes more passages, and a reader or a model confirms each before it is shown. Analogy mining found the same thing in another field: embed an abstraction of the item, and retrieval crosses domains [1].
2. **Picture ↔ passage** has no peer. Compositor and Bodleian ImageMatch match ornaments and woodblocks to each other [2][3]; Iconclass with CLIP labels pictures [4]. None links a plate to its text. Our prototype did it for 34 of 44 emblems with vectors we already store (`2026-10-07-meaning-prototypes-6201.md`). A raw image vector does not work against the whole library; the description text does.
3. **A benchmark** is cheap and has an audience. MMTEB lists no historical or classical-language retrieval task [5]. Gretino, the first for Latin and Greek, has 40 hand-made queries [6]. MITRA covers Buddhist languages only [7]. Ours span Latin, German, French, Chinese and eight traditions. They were written and read by an AI reader, so a human pass comes first.
4. **Demand map**: we log every query. No library we found ranks translation work by the queries that land on untranslated text; request-driven digitisation exists (eBooks on Demand) [8]. It turns the meaning layer into a planning tool.
5. **Text reuse**: every existing tool stays inside one language family (passim/KITAB for Arabic [9], ctext for Chinese [10], SPhilBERTa for Greek–Latin [11]). We hold English for most pages, so the translation is a pivot across all of them. It needs paragraph units; a page is too coarse for alignment.

### What the prototypes changed

- **See-also moved from 2nd to 7th.** It was the obvious feature. Blind grading found a real parallel in 13 of 75 proposals (concept vectors) and 9 of 75 (page vectors), and similarity did not tell good from bad. Related-item rails also get few clicks elsewhere: 0.21% over 1.8 million recommendations in one scholarly service [12]. A list that is wrong five times in six teaches readers to ignore it. Build idea pages first; put a "see also" on a page only when it points to a checked idea page.
- **Picture ↔ passage moved up.** It works with no new index.

### Things that look attractive and are not

- **A second, open embedding model.** Tested twice today; no gain that clears the bar.
- **Dating by embedding.** Ithaca and Aeneas work on inscriptions with models trained for it, and the value was the parallels shown to a historian [13]. Our vectors encode subject.
- **A map of 6.7M pages.** Public maps that lasted are of images or books, with labels, and the interaction people kept was "more like this" [14].
- **Retrieval as proof.** Grounded legal tools still invented citations 17–33% of the time in a preregistered study [15]. Our tools return verbatim quotes with page URLs; we should measure and publish how often an answer built on them cites a page that says what is claimed.

## Open decisions

- Publish the 25 idea pages from the #6173 gold set as they are (AI-found, quote machine-checked), or after a human read?
- Spend about $50 on the staged concept lane (#6173) now, or after the re-test with human-written queries?
- A human pass on the gold sets, and by whom, before a benchmark is published under the library's name.

## Sources

1. Hope, Chan, Kittur, Shahaf, "Accelerating Innovation Through Analogy Mining", KDD 2017. https://arxiv.org/abs/1706.05585
2. Wilkinson, Briggs, Gorissen, "Computer Vision and the Creation of a Database of Printers' Ornaments", DHQ 15(1), 2021. https://www.digitalhumanities.org/dhq/vol/15/1/000537/000537.html
3. Bodleian Broadside Ballads ImageMatch. https://blogs.bodleian.ox.ac.uk/theconveyor/broadside-ballads-imagematch/
4. Santini, Posthumus et al., "Multimodal Search on Iconclass using Vision-Language Pre-Trained Models", 2023. https://arxiv.org/abs/2306.16529
5. Enevoldsen et al., "MMTEB: Massive Multilingual Text Embedding Benchmark", ICLR 2025. https://arxiv.org/abs/2502.13595
6. Toyin et al., "Gretino", LREC 2026. https://aclanthology.org/2026.lrec-1.70/
7. Nehrdich, Keutzer, "MITRA", 2026. https://arxiv.org/abs/2601.06400
8. eBooks on Demand. https://books2ebooks.eu/about
9. KITAB text reuse methods. https://kitab-project.org/methods/text-reuse
10. Sturgeon, "Unsupervised identification of text reuse in early Chinese literature", DSH 33(3), 2018. https://dsturgeon.net/text-reuse-chinese-literature/
11. Riemenschneider, Frank, "Graecia capta ferum victorem cepit: Detecting Latin Allusions to Ancient Greek Literature", 2023. https://arxiv.org/abs/2308.12008
12. Beel et al., "Online Evaluations for Everyone: Mr. DLib's Living Lab for Scholarly Recommendations", 2018. https://arxiv.org/abs/1807.07298
13. Assael et al., "Contextualizing ancient texts with generative neural networks" (Aeneas), Nature 2025. https://deepmind.google/discover/blog/aeneas-transforms-how-historians-connect-the-past/
14. Lee, Newspaper Navigator, Library of Congress, 2020. https://labs.loc.gov/work/experiments/newspaper-navigator ; Yale DHLab PixPlot. https://dhlab.yale.edu/projects/pixplot
15. Magesh et al., "Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools", 2025. https://arxiv.org/abs/2405.20362
16. Dale, Voita, Barrault, Costa-jussà, "Detecting and Mitigating Hallucinations in Machine Translation", ACL 2023 (for item 6). https://aclanthology.org/2023.acl-long.3
17. Hamilton, Leskovec, Jurafsky, "Diachronic Word Embeddings Reveal Statistical Laws of Semantic Change", ACL 2016 (for item 8). https://arxiv.org/abs/1605.09096

Sources 1–17 were collected by a research pass on 2026-10-07. Numbers quoted from them were read from the paper or project page, except [8], which is from the project's own summary.
