---
stage: metadata
measure: [judged]
languages: [zho, lat, deu, eng, nld, fas]
scripts: [Hani, Latn, Arab]
canons: []
n_books: 10
n_pages: 2042
verdict: "One agy request over a sample of a book's English text (at most 120K characters: the opening 15 pages, the first 1-2 pages of every planned section, then evenly spaced pages) passes the #8521 rule against the live full-text lane. Blind Opus judge on the 10 #8512 books: 19 unsupported or wrong claims in C's summaries against 21 in A's (the rule allowed C up to 22); preference A 6, C 4 (the rule fails C only at 7). Cost: 10 requests against 24, 388K input tokens against 1.75M, 593 s against 914 s. The pass is fragile: one book (Tuhfat, A 7 / C 0) carries it, and on the 3 books whose whole text fits 120K, so that C's prompt is A's, the two runs differed by 5 claims. The index is thinner: C names 47% of A's people and 43% of its concepts on the 7 sampled books, against 84% and 53% between two runs of the same input."
status: undecided
decision: "The rule says switch the lane to the sample. Owed: whether the index (book_indexes) may lose about half its named people on long books, or stays on the full text while summary + chapters use the sample."
superseded_by: null
issue: [8521, 8512, 8515, 7628]
---
PRIOR ART: `2026-11-10-enrich-from-page-summaries-8512.md` (same 10 books, same judge rubric, arm B over stored page
summaries; rejected) and `scripts/workers/lib/enrich-agy-lane.mjs` (arm A, the live lane, run in `--compare-out`).
Script: `scripts/eval/enrich-from-page-summaries-8512.mjs` (`armc | score | pack --arm=c`). Judge prompt, now
committed: `scripts/eval/enrich-judge-prompt-8521.md`. Per-book outputs, packets and verdicts are in the job's scratch
(`/root/jobs/enrich-sample-8521/run/` on gex45), not committed.

## 2026-11-10 · Can enrichment read a sample of a book's text instead of the whole of it? (#8521)

**Why.** The agy lane pastes the whole English text, ≤150K characters a message, so requests and input tokens grow
with book length (#7628; #8515 cuts long books' input 54%, but a book is still read whole). #8512 tried the stored
page summaries instead and was rejected narrowly (15 claims against 12). This arm keeps the real text but reads only
part of it, in one message.

**Arms.**
- **A (live):** `enrich-worker.mjs --agy --dry-run --compare-out=DIR --book-ids-file=… --agy-home=/root/.agy-james`.
  Nothing written; `--dry-run` also keeps the run out of `cron_runs`. A ran again today because #8512's A outputs were
  on another box. Same lane code as #8512 (the `--agy` path is unchanged on the branch).
- **C (sample):** one agy 3.8 Flash-low request a book, pool `.agy-james`, job ledger `enrich-sample-8521` (not the
  lane's `enrich-agy`). The lane's own prompt (`buildAgyEnrichPrompt`) with the same want (extractions per section +
  summary + chapters) and the same section ranges (`planPageBatches`), over a sample of the pages: the first 15 text
  pages, then the first page of every section, then the second, then the remaining pages in van der Corput order,
  each added while it fits the budget. The budget is 120K characters of text, cut further when the chapter task's
  heading list would push the message over 150K (Hermetic Rosary 108K, Diophantus 87K, Purest Love 91K). Three lines
  say it is a sample: in the intro, at the end of the text ("That is the whole sample, 101 of 132 pages"), and in the
  summary's material line ("Claim nothing about pages not shown…"). Parsed by the lane's parse function. Quotes are
  grounded against the whole book's pages (`quote-grounding.mjs`).
- **3 of the 10 books fit whole** once the tags are stripped (Ancient Music 115K, Mountain Hall 104K, Coclico 65K
  characters), so C got the whole text and A's prompt. The brief said to score them anyway. They show how much two
  runs of the same input differ. Shijing Baishu was nearly whole (86 of 101 pages).

**Judge.** One blind Opus Agent call per book, X/Y order from `sha256(8512:order-c:id)` (C came out as X on 8 of 10).
Each call got both summaries and chapter lists plus the whole English text, and used the #8512 rubric: unsupported or
wrong claims with the pages checked, specificity 1-5, chapters 1-5 against the detected headings, preference.
**Instrument check:** 2 false claims planted in one output each for 2 books. Steiner, C side: "an appendix of twelve
meditation diagrams" and "dedicated to Count Keyserling". Herder, A side: "aboard a ship from Hamburg to Livorno" and
"Theophron reads from Kant's *Critique of Pure Reason*". **Caught 4/4.** As in #8512, recall of real errors varies:
the planted Steiner run found 2 of C's 3 real claims, and the planted Herder run found none of the 4 real claims its
clean run listed (2 per side).

## Results

| book | lang | text pages | sample | req A/C | input tok A/C | s A/C | unsupported A/C | spec A/C | chapters A/C | pref | people / concepts of A's named by C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Ancient Music j.1 | zho | 100 | **whole** | 1/1 | 31K/31K | 28/30 | 1/5 | 4/4 | 4/4 | A | 35/40 · 33/44 |
| Mountain Hall j.53-54 | zho | 100 | **whole** | 1/1 | 35K/35K | 27/40 | 1/0 | 3/5 | 4/5 | C | 13/21 · 6/14 |
| Shijing Baishu j.4 | zho | 101 | 86 | 2/1 | 85K/36K | 76/40 | 5/3 | 5/4 | 4/4 | C | 24/47 · 15/49 |
| Coclico, Compendium musices | lat | 122 | **whole** | 1/1 | 33K/33K | 74/73 | 0/2 | 5/4 | 5/5 | A | 26/27 · 18/49 |
| Hermetic Rosary | deu | 132 | 101 | 2/1 | 119K/40K | 36/165 | 1/2 | 2/5 | 4/5 | C | 12/14 · 48/69 |
| Diophantus (Heath) | eng | 377 | 51 | 7/1 | 754K/56K | 96/81 | 2/1 | 3/5 | 2/3 | C | 34/119 · 24/97 |
| Herder, God | deu | 290 | 151 | 2/1 | 101K/37K | 40/32 | 2/2 | 5/4 | 5/5 | A | 18/24 · 19/35 |
| God is the Purest Love | nld | 286 | 111 | 3/1 | 267K/44K | 445/53 | 1/1 | 5/2 | 5/4 | A | 6/12 · 106/242 |
| Steiner, Way of Initiation | deu/eng | 260 | 140 | 2/1 | 105K/39K | 53/55 | 1/3 | 5/5 | 5/5 | A | 12/16 · 34/54 |
| Tuḥfat al-ʻIrāqayn | fas | 258 | 106 | 3/1 | 216K/38K | 40/24 | 7/0 | 5/2 | 2/2 | A | 20/34 · 9/49 |
| **total** | | **2,026** | | **24/10** | **1.75M/388K** | **914/593** | **21/19** | **42/40** | **40/42** | **A 6 · C 4** | **200/354 · 312/702** |

Output tokens: A 141K, C 120K. Quotes verbatim on a page: A 383/503 (76%), C 333/432 (77%). Seconds are summed per
book (A ran 2 books at a time). On the 7 sampled books only: 21 requests against 7, 1.65M input tokens against 290K.

**Rule (#8521).** Switch if C's unsupported claims are at most A's + 1 over the 10 books, and the judge does not
prefer A on 7 or more. **C 19 ≤ 22, and the judge prefers A on 6: the rule passes.**

**How firm that is.**
- One book carries it. On Tuḥfat, A made 7 claims, all of them outside knowledge the text does not contain
  (Shamakhi, the hazaj metre, the Darb Zubayda route, "the mid-1150s", "earliest Persian verse travelogue"). C made 0
  claims, but with specificity 2. Without Tuḥfat it would be C 19 against A 14, and the rule would fail.
- The noise is as big as the margin. On the 3 whole-text books, C's prompt is A's prompt, and the two runs differed
  by 5 claims (A 2, C 7; Ancient Music alone 1 against 5). The same lane on the same 10 books scored 12 claims in
  #8512 and 21 here. Read every count as ±several per book.
- On the 7 sampled books, A 19 and C 12. That is the comparison the question asks about, and C is not worse on it.

**What the sample costs.**
- *The index.* Between two runs of the same input (the 3 whole books), C named 84% of A's people and 53% of its
  concepts. On the 7 sampled books it named 47% and 43%. Diophantus is the extreme: 51 of 377 pages, 34 of A's 119
  people. The extractions for a section are drawn from its shown pages only, so `book_indexes` on a long book would
  carry about half the people the full text gives, and `pagesCovered` would have to say so.
- *Whole-book claims.* The sample note did not stop all of them. C on Purest Love: "the book concludes with a series
  of Psalms and Litanies", when hymns for the Mass follow. On Steiner: "his first full-length practical guide …
  published in English". C's other errors are mostly the kind A makes: titles and attributions slightly wrong, and
  centuries supplied from outside the book.
- *Specificity.* Even overall (42 against 40), but C's lowest scores are on long books where the sample is thin
  (Purest Love 2, Tuḥfat 2), and its highest where A's prose was generic (Hermetic Rosary, Diophantus 5 against 2-3).

**Unsupported claims (judge's wording, shortened).**
- Ancient Music *(whole)* — A: "Grand Secretary under the Kangxi Emperor" (no emperor named). C: Li Guangdi as
  "Grand Secretariat Academician" (that is Zou Yixiao's title); "an imperial preface" (it is the compilers' *tiyao*);
  "six poetic forms" (six kinds of musical discourse); the tuning defects "of bells" (Li rejects that reading);
  "Neo-Confucian" (not stated).
- Mountain Hall *(whole)* — A: "from the Qin to the Song" (Zhou to Yuan).
- Shijing Baishu — A: contributed to the rise of *kaozheng* scholarship (reception, not in the text); Tang's conquest by
  "encirclement"; Shang hymns "preserved in Song"; Xunzi cited (it is not); "bamboo scripts" (none). C: Du Yu criticised
  on the Nine Xia (he is cited approvingly); "stone inscriptions" (none); the southern-plant argument placed in the Zhou
  hymns (it is in the Lu eulogies).
- Coclico *(whole)* — C: "without head movements" (the text says the tongue); "forbids parallel motion" (only
  consecutive octaves and fifths).
- Hermetic Rosary — A: "a principal source" for later alchemists (reception). C: Pontanus cited for Artephius's
  thousand years (only Bacon and Paracelsus are); centuries given for Hortulanus and Bernard (not in the text).
- Diophantus — A: the roots of Greek algebra traced in Ch. V (it is Ch. VI); "clarifies the distinction" between
  *logistikē* and arithmetic (Heath says it is lost in Diophantus). C: "Babylonian" mathematics (never mentioned).
- Herder — A: "initiating a major reassessment of Spinoza" (the text answers an existing controversy); influence on
  Goethe and Weimar classicism (Goethe is never named). C: Theophron establishes Spinoza's integrity (Philolaus reads
  the life alone); the controversy "shaping Goethe, Schelling and Hegel" (none named).
- Purest Love — A: prayers "for magistrates" (none). C: "concludes with Psalms and Litanies" (Te Deum and Mass hymns
  follow).
- Steiner — A: "one of the earliest systematic formulations" (no priority claim in the text). C: "editorial work on …
  Nietzsche" (he edited Goethe; for Nietzsche the text has the offer of the post, a treatise and a visit); "first full-length guide published in English"; the moral
  conditions placed in the Initiation chapter (they are in Ch. VIII).
- Tuḥfat — A: earliest Persian verse travelogue; "the mid-1150s"; Shamakhi; hazaj metre; Darb Zubayda; the uncle "a
  physician"; the mother "a Christian slave" (Nestorian and Mobad lineage).

**Budget.** 34 agy requests (A 24 on the lane's `enrich-agy` ledger on gex45, C 10 on `enrich-sample-8521`), all on
`.agy-james`. 13 Opus judge calls (10 clean, 2 planted, 1 rerun after I gave a judge a mistyped id). Nothing was
written to books.

**Out of scope / not tried.** Changing the live lane (a follow-up PR, if the index question is settled). A sampled
summary + chapters combined with a full-text index, which keeps most of A's index cost. A larger budget than 120K or a
second sampled message for books over ~400 pages (Diophantus: 51 of 377 pages). Re-judging to measure the judge's
variance, which here is as large as the margin.
