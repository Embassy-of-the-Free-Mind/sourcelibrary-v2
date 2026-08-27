# DRAFT — Reading the Text to Test the Catalog

> **Status: DRAFT, not published.** This is the write-up frame for FINISHING the
> dedup workstream, not a report on a finished one. The Results section has
> `[SLOT]` markers for numbers that do not exist yet; each slot maps to an open
> issue. The note publishes when the slots are filled — that is the point of
> writing it now. Working title alternatives: "The Territory Disagrees",
> "Does Deduplication Work? Ask the Book."
>
> Publication target: `/blog/<slug>` research note (per the notes framing,
> #3156 — AI-assisted, colophon-linked, revision-dated). Convert to `page.tsx`
> at publish time. Derek reviews voice and claims before anything ships.

---

## Lead (draft)

A digital library's catalog constantly makes a quiet claim: *these two scans
are the same book*. Act on that claim when it's false and a real, distinct text
disappears from view; fail to make it when it's true and readers wade through
five copies of the same printing to find anything else. We had built the
machinery librarians recommend — layered identity keys, review queues, an LLM
screen — and it all tested green. Then we asked a question none of that
machinery could ask: **does the text agree?**

We sampled aligned pages from every pair of visible books our catalog claims
are the same edition and compared the actual words. The metadata's claims
failed the content check **27% of the time**. This note is the story of that
number: where it comes from, what was hiding inside it (fragments filed as
copies, Tibetan volumes collapsed into one, and two clandestine 1670 printings
of Spinoza that *no* metadata could ever tell apart), and what we rebuilt so
the catalog's claims are now audited by the books themselves.

## 1. Background: four layers of "same"

- The identity stack: person / work (`work_id`) / edition (`edition_key`) /
  copy (`duplicate_of`) — our approximation of FRBR's work–expression–
  manifestation–item. Claims attach to exactly one layer (first translation is
  work×language; "other scans" is copy-level).
- Why testing was circular before: every dedup test judged metadata against
  metadata, so tests shared the blind spots of the system under test. We hold
  OCR for 6.3M pages — the content can be the ground truth instead.
- The incident hook (candid, in the notes tradition): the shadow monitor
  flagged three "missed duplicates" on 26–27 Aug 2026; on inspection all three
  were the *old* tier over-matching — but chasing them exposed that the *new*
  tier is blind to bilingual titles re-imported under bare romanization
  ("Muqaddimah" vs "مقدمة ابن خلدون (Muqaddimah)"), measured at 0% cross-source
  non-Latin recall. Fixing detection with more metadata was circular; hence
  this study.

## 2. Related work (drafted; links verified 2026-08-27)

- **Entity resolution**: the blocking + matching architecture and cost
  cascades (deterministic → cheap model → LLM → human). Our `edition_key` is a
  blocking key; the comparator/LLM/human queue is the match cascade. Cites:
  Peeters, Steiner & Bizer, *Entity Matching using Large Language Models*
  (https://arxiv.org/pdf/2310.11244); AnyMatch
  (https://arxiv.org/pdf/2409.04073); BEACON budget-aware EM
  (https://arxiv.org/pdf/2603.11391); BlockingPy / embedding blocking
  (https://arxiv.org/pdf/2504.04266).
- **Text-reuse detection in the humanities**: passim (Smith et al., Viral
  Texts) — word n-grams + local alignment over noisy OCR newspapers; BLAST-
  style fuzzy alignment (impresso; Helsinki group) shown robust to OCR noise;
  applied to 347K early modern books. Our comparator is page-anchored passim:
  same n-gram core, exploiting page structure newspapers lack. Cites:
  https://programminghistorian.org/en/lessons/detecting-text-reuse-with-passim ;
  https://link.springer.com/article/10.1007/s41060-025-00742-x ;
  https://www.frontiersin.org/journals/big-data/articles/10.3389/fdata.2023.1249469/full
- **Corpus dedup for ML training data**: MinHash-LSH pipelines; SemDeDup
  (embedding near-dup removal) — same tools, different objective (they delete
  redundancy; a library must *keep and link* it: every copy is provenance).
- **Library science**: Cutter's 1876 objects (find / collocate / choose an
  edition); FRBR/LRM; OCLC GLIMIR manifestation clustering. The study is these
  objectives, instrumented.
- **The one-sentence positioning**: EM research matches flat records; corpus
  dedup matches bags of text; bibliographic clustering matches metadata. We sit
  at the intersection nobody occupies: records that CARRY 500 pages of
  verifiable content and a grain hierarchy — so the matcher can consult ground
  truth, per grain.

## 3. Methods (pilot implemented 2026-08-27, session scripts; promotion tracked in #4285)

- Comparator: 5 interior sample points (25/40/55/70/85% of each book's own
  length); Unicode-aware normalization (`\p{L}\p{N}`, NFC — `\w` is a
  Latin-only assertion and blanked 15% of this corpus once before); character
  4-gram Jaccard; per-sample best match over an alignment window of
  ±(|ΔpagesCount|+8) pages on the counterpart book.
- **Evidence rule**: a sample counts only when BOTH sides yield ≥200 chars.
  Absence is a recorded skip, never a verdict. (First version scored a
  no-OCR copy of *Monas hieroglyphica* as "different book" — the empty-set
  trap. Kept in the write-up deliberately; method corrections are results.)
- **Alignment lesson**: same-edition scans drift 20–40 pages (front matter,
  plates); a fixed ±3 window mis-scored 7 of 12 known copies before the
  adaptive window fixed all but one of them. Also a result, not a footnote.
- Controls run IN the harness, every run: positives = `duplicate_of`-linked
  pairs (known copies); negatives = same `work_id`, different year + key
  (known different editions). Thresholds from controls: ≥0.5 same printing,
  <0.3 different content, between = gray.
- Cost: zero AI. String math over OCR we hold. ~2s/pair.

## 4. Results

### 4.1 Calibration (done — pilot)

| Control set | n | Scores | Notes |
|---|---|---|---|
| Known copies (`duplicate_of`) | 12 | 0.55–0.92, one outlier 0.11 | the outlier's sides are dated **1532 vs 1585-86** — a mislabeled link, caught by the metric in its own control set |
| Known different editions | 12 | 0.04–0.38, one outlier 0.73 | the outlier (De arte gymnastica, divergent year strings) is a candidate MISSED duplicate |

### 4.2 Precision audit: all both-visible same-edition clusters (done — pilot)

225 clusters / 259 keeper↔copy pairs, 2026-08-27:

| Verdict | Pairs | Share |
|---|---|---|
| Confirmed copy (text matches) | 128 | 49% |
| Suspect — text does not match, ≥2 both-sides samples | 71 | 27% |
| Gray (0.3–0.5) | 31 | 12% |
| Insufficient text (recorded skips) | 29 | 11% |

Suspect taxonomy (each verified on a named example): fragments/excerpts under
a full edition's key (*Summa de Arithmetica* 626pp vs 26pp); generic-title
collections (five distinct "Hasidic discourses" under one key); Tibetan pecha
volume grain (Latin-only volume tokens); **genuinely distinct same-year
printings** (Spinoza, *Tractatus theologico-politicus* 1670 clandestine
variants — title|author|year identical *by construction*; only text can split
them); garbage OCR on one side.

### 4.3 Finishing the job — the slots this note publishes on

- `[SLOT — full sweep]` Verification over ALL same-key clusters (hidden +
  warehouse included, not just both-visible): N pairs, X% confirmed.
  (Free; extends the pilot script. #4285.)
- `[SLOT — recall probe]` Embedding-shortlisted candidate pairs
  (`book_embeddings` NN + MinHash over first-20-page OCR) verdicted by the
  comparator: **N missed duplicates found** that no key caught. (Free. #4285
  phase 2.) Grain rule stated in Discussion.
- `[SLOT — tier-2 fix]` `edition_key_latin` shipped (#4270): cross-source
  non-Latin replay recall 0% → X%; shadow tier retired after N clean days.
- `[SLOT — queues drained]` work_merge_queue 1,940 → 0 (#4271 batch lane;
  980 pre-screened "same"); keeper queue 311 → 0 with text scores attached.
- `[SLOT — links written]` duplicate_of sweep, content-gated (#4246 P3):
  M copies linked, K pairs reclassified as distinct editions instead of
  hidden. Reader-visible: "other scans" rail coverage before/after.
- `[SLOT — gold set]` Adjudicated pairs frozen as a benchmark (n pairs,
  hard negatives included); every future matcher scores against it.
- `[SLOT — search]` Result collapsing live (#4300): example query
  before/after screenshot.

## 5. Discussion (drafted)

- **The grain argument** (the note's main idea): embedding similarity operates
  at the WORK grain (a translation embeds near its original — feature for
  finding works, catastrophic for merging copies); surface n-grams operate at
  the copy/edition grain. Use each where it lives: embeddings for recall,
  n-grams for verdicts. Most literature never states this because most corpora
  have no grain hierarchy.
- **A shared key is a claim, not a fact** — now with a measured failure rate
  (27% among visible clusters). Keys keep their job (candidate generation);
  they lose self-certification. Hiding a book stops being something a key
  match can cause and becomes something only evidence can cause.
- **Dedup sometimes runs backwards**: the Spinoza suspects aren't noise —
  distinguishing 1670 *Tractatus* variants is a known problem in
  bibliography, and the comparator does variant *census*, a scholarly
  feature, with the same machinery. (Possible spin-out note of its own.)
- Honest limits: needs OCR both sides (11% insufficient); garbage OCR fakes
  mismatch; ~seconds per pair ⇒ verification layer, not an import-time tier;
  work_id fragmentation still over-counts witnesses until queues drain.

## 6. Production notes (not part of the post)

- Hero image candidate: side-by-side aligned page pair from the two Monas
  scans (confirmed copy, 0.745) or the Spinoza title pages. Must use
  `/api/image` provenance-marked URLs.
- Every book named gets its shortlink via `/api/books/BOOK_ID/quote?page=N`.
- Numbers rule: every stat in the post must be regenerable by a named script;
  re-measure at publish time (counts drift; the 2026-08 numbers are pilot
  vintage).
- Related issues: #4270 #4271 #4285 #4300 #4246 #3102 #3895. Session:
  2026-08-27 dedupe triage.
