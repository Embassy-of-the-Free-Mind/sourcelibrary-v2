---
stage: translation
measure: judged_vs_reference
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 40
n_pages: 40
verdict: "In the Tibetan v13 flash run 6 of 40 sampled factual notes (15%) are wrong or partly wrong, all identifications or Sanskrit equivalents, none dates; audit 'invention' flags are often correct facts."
status: superseded
decision: "Prompt not changed; a prompt line for unsure equivalents went to DECISIONS-PENDING (#4523)"
superseded_by: "2026-10-02-note-facts-full-tibetan-run-5624.md"
issue: [5624, 4523]
---
## 2026-10-02 · Are the facts translation notes add right? (#5624)
<!-- PRIOR ART: 2026-10-02-what-the-judge-calls-invention-5274.md (PR #5622) typed the audit's invention flags and listed the 21 editorial-addition pages, but did not check whether the added facts are true; the #4523 QA comments read the Tibetan run for fidelity, not note facts. This file checks the facts. -->

**Question.** Prompt v13 asks for explanatory `<note>`s ("warm museum label"). So a note that adds a name, date or identification not printed on the page is there by design. Derek's rule (2026-10-02): such an addition is a defect **only if it is wrong**. How often is it wrong? The $226 Tibetan retranslation (#4523, `gemini-3-flash-preview`, prompt v13) is checked first.

**Design.** Read-only. $0 API.
- **Stratum T: the Tibetan run.** These are pages in envelope `tibetan-retranslation-4523` (1,439 books) translated since 2026-10-01: 30,665 pages, all `gemini-3-flash-preview` v13, carrying 45,437 `<note>`s. Candidates were non-`original:` notes ≥ 40 characters with a factual cue (century, founder, author, disciple, king, Sanskrit, "known as", …); 359 candidates came from 197 books. One random note per book was drawn (seed 5624, 90 books). The first 40 in draw order that carry a checkable claim (person, date, place, attribution, identification of a work, or a Tibetan↔Sanskrit equivalence) were kept. Bare "this is a mantra" descriptions were skipped.
- **Stratum A: audit additions.** These are the 21 editorial-addition pages from the #5274 audit (PR #5622): 17 Flash, 4 Lite. The claims are the ones the Opus judge flagged as invention, plus closely tied notes on the same page.
- **Verification.** 8 Claude subagents (5 for T, 3 for A) worked from 84000 glossaries, Treasury of Lives, Rigpa/RY wikis, Wikipedia and the book's own neighbouring pages. Each verdict is correct / wrong / partly-wrong / unverifiable, with a source URL. "Correct" requires a source; there are 0 rows without a URL.
- **Instrument check (seeded positives).** One planted claim was hidden in each batch: 7 wrong and 1 true. All 7 wrong seeds were flagged: Śāriputra "foremost in powers", Longchenpa "16th c.", sangs rgyas = "Dharma", Tuṣita = "Thirty-Three", Proclus "4th c., Alexandria", Geronimo → "Custer", Shao Yong "Ming". The true seed (Atiśa 1042, Guge) passed as correct. Seeds are excluded from every figure below.
- **Spot checks by the author.** Each Tibetan "wrong" was read against its context. For T28 the OCR was also read: it has གྲུབ་ཆེན་**བྱུང**་པོ, an OCR misreading of ཁྱུང་པོ. The translator then rendered it as a third name, "Nyungpo".

**Result.**

| stratum | model | notes / pages | claims | correct | wrong | partly-wrong | unverifiable | units with ≥1 wrong or partly-wrong |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| T: Tibetan #4523 run | flash | 40 notes | 43 | 35 | 3 | 3 | 2 | **6 / 40 (15%)**; strictly wrong 3 / 40 (7.5%) |
| A: audit additions | flash | 17 pages | 56 | 32 | 13 | 3 | 8 | 6 / 17 |
| A: audit additions | lite | 4 pages | 7 | 2 | 3 | 2 | 0 | 3 / 4 |

- **Tibetan run: the wrong facts.** Wrong or partly-wrong claims are 6 of 43 (14%), above the issue's 5% threshold. All six are identifications: a Tibetan→Sanskrit equivalent or "who is this". None is a date.
  - T03: dGa' ba'i sde ("Joyful Army") → "Sanskrit: Harisena". It is **Nandasena**. https://sourcelibrary.org/book/69e7ac955f1a22ab19aa9713?page=24
  - T32: 'Jig rten 'dzin → "Lokeshvara or Jagaddhara". It is **Lokadhara**, the interlocutor of Toh 174; Lokeśvara is 'jig rten dbang phyug. https://sourcelibrary.org/book/69e7abb55f1a22ab19a9cb7e?page=76
  - T34: Musulundha → "Mucilinda". Musulundha is the king of the Yāma gods (84000 Toh 287 glossary); Mucilinda is the nāga king. https://sourcelibrary.org/book/69e7abc95f1a22ab19a9e04a?page=53
  - T39: the Brahmin between Vajrasattva and Śrī Siṃha is called "likely Garab Dorje's father" (hedged). No source supports this. https://sourcelibrary.org/book/69e786b24a6785cfd60c8e7b?page=123
  - T28: the work (bKra shis bka' rgya ma) is right, but the author "Drubchen Nyungpo" should be **Khyungpo** Naljor. This one is OCR-driven. https://sourcelibrary.org/book/69e7965680b52390feb195ab?page=23
  - T12: Śāradvatīputra is called "the personal name" of Śāriputra. It is a matronymic; his personal name was Upatiṣya.
- **Tibetan run: the right ones.** These held up: Longchenpa = Dri med 'od zer; Chos grub = Facheng (9th c.); Pang Lo = Pang Lotsāwa Lodro Tenpa; Rigdzin Chenpo = Pema Lingpa (fits the Chokhor death omens); Varṣakāra; Jīvaka; Upāli; the five ānantarya; and 84000-attested term pairs (skandha, nāmarūpa, Vinayavibhaṅga, Saṃdhinirmocana, Kauśika).
- **The pattern.** The errors are where the note *chooses* an equivalent the model is unsure of: an "X or Y" pair, a near-homophone, a guessed relation. A note restating a standard identification (Śāradvatīputra = Śāriputra, which appeared 6 times in 40) is reliably right.
- **Audit additions.** These are a different mix. Many flagged "additions" are not facts at all:
  - an invented woodcut description (Yogini Hridaya, A10);
  - a wrong juan and part in a Wubei zhi heading ("Volume 139 / Part II"; the page is juan 149, part I) (A09);
  - Suda `<summary>`/`<keywords>` naming Nicostratus/Nicon/Nicophon, who are not on the page (A14, Lite);
  - a `<meta>` miscounting Cárdenas's causes (A03).
  
  One Flash page (Minakata's slime-mould catalogue, A07) carries 9 of the 16 Flash wrong/partly-wrong claims. It expands one-character locality abbreviations by guess, where the article's own key (pp. 1–2) gives different places.

  Several judge-flagged additions are **correct**:
  - Gemoll as editor;
  - "BOOK THREE";
  - Chastity in the Pèlerinage woodcut (named on p.200);
  - the Old Serpent = Oxford Slouch (p.77);
  - Cornerus's first name, office and illness (previous page);
  - the Jupiter rites ending on the previous page;
  - all 11 Percy Society biographical notes, except "Samuel" G. Fenton, which is unverifiable.
  
  So "invention" in the audit is not a proxy for "wrong".
- **Flash vs Lite.** This sample cannot compare them: there are 4 Lite pages, and Flash in stratum A is dominated by one page. #5606 must count wrong facts per claim on paired pages, not invention flags.
- **Side finding (Tibetan run).** 52 of 30,665 pages (0.17%, 41 books) have unbalanced or malformed `<note>` tags (e.g. `</note` with no `>`). On those pages, translated text sits inside a note and disappears when a reader toggles notes off. This needs a write-time tag-balance check. It is out of scope here.

**Consequences.**
1. The Tibetan run's note facts are wrong at a material rate: 6 of 40 notes, all identifications. This was posted on #4523 together with a proposed prompt line (a DECISIONS-PENDING row for Derek). The prompt was **not** changed.
2. The audit judge's "invention" flag mixes three things: correct enrichments, wrong enrichments, and page-content claims that are false (summaries, headings, image descriptions). A judge that should matter for readers needs a "wrong fact" class checked against a reference, not an "added fact" class.
3. Page-content claims in `<summary>`/`<keywords>`/headings (A09, A14) are checkable mechanically against the OCR, by name overlap. That is cheaper than web verification.

**Replicated?** No. Each verdict comes from one subagent with a source URL. The instrument caught 7 of 7 seeded wrong claims, and the 6 Tibetan wrongs were read by the author. n is small: 40 notes and 21 pages. Read the 15% as "well above 5%", not as a point estimate.

**Artifact.** `scripts/eval/results/note-facts-2026-10-02-5624/` holds `sample.json` (every item, seeds marked `stratum: SEED`) and `verdicts.json` (115 claim rows, including seeds, each with `source_url` and `evidence`). Cost: $0 (subscription subagents).
