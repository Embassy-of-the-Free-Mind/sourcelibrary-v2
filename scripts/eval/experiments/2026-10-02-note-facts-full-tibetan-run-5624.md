## 2026-10-02 · Every candidate note in the Tibetan run, fact-checked (#5624)
<!-- PRIOR ART: 2026-10-02-are-the-facts-translation-notes-add-right-5624.md (PR #5632) — same question and method on a 40-note sample; this file extends it to all 359 candidates and reuses its 40 verdicts. -->

**Question.** PR #5632 checked 40 of the Tibetan run's candidate notes and found 6 wrong or partly wrong (15%). Derek asked (2026-10-02) for the full count and a correction list. The rule is unchanged: a note that adds a fact is fine unless the fact is **wrong**.

**Design.** Read-only, $0 API. The method is #5632's, unchanged.
- **Frame.** Envelope `tibetan-retranslation-4523`, pages translated since 2026-10-01, frozen at #5632's snapshot (`translation.updated_at` ≤ 2026-10-02T11:15:30.821Z). That is 30,665 pages and 45,437 `<note>`s, all `gemini-3-flash-preview` prompt v13.
- **Candidates.** Same filter, recovered verbatim from the #5632 session (`raw/candidate-filter.py`). A candidate is a non-`original:` note, at least 40 characters long, that matches the factual-cue regex and contains a capitalised word.
- **Positive control (passed).** I re-pulled production. With the cutoff applied it gives **359 candidates from 197 books**, the same as #5632, including all 40 already-judged notes. None of those pages has been retranslated since. One note occurs twice on a page (N123/N124), so there are 358 unique notes; the duplicate takes the same verdict.
- **Out of scope.** The run has kept going: 47,083 pages and 576 candidates as of this pull. The 217 newer candidates are not checked here.
- **Verification.**
  - The 40 notes already judged keep their #5632 verdicts.
  - The other 318 went to 16 Sonnet subagents in two sequential waves of 8, about 20 notes each.
  - The prompt is #5632's, with one added line in wave 2: "correct" requires a page fetched in this session. A wave-1 verifier had said it marked one equivalence correct from general knowledge.
  - Classes are correct / wrong / partly-wrong / unverifiable / no-claim. Every correct, wrong or partly-wrong claim carries a source URL (0 exceptions). 33 unverifiable rows have none, and an unverifiable row never counts as correct.
- **Seeds.** One fresh known-wrong claim was planted per batch, none reused from #5632. Examples: Milarepa as "disciple of Gampopa", 'od dpag med = "Akṣobhya", Samye "founded in the 14th c.", Kālacakra "introduced in the 8th c. by Śāntarakṣita", Yeshe Tsogyal as "consort of Atiśa". **All 16 were caught.** S03 (Tsongkhapa as "14th-c. founder of the Sakya school") was caught as partly-wrong, since the date is right. Seeds are excluded from every figure.
- **Author adjudication.** I read every wrong, partly-wrong and suspicious verdict against its context. Where the call turned on the Tibetan, I also read the page OCR. Five verdicts changed (recorded in `summary.json` and in each row's `author_note`):
  - **N042 → correct.** The OCR reads ཐམས་ཅད་ཤེས་པ་ཉིད, as the note says, and sarvajñatā is right.
  - **N043 → correct.** 84000 Toh 8 pairs lam gyi rnam pa shes pa nyid with mārgajñatā.
  - **N221 → wrong.** The OCR reads མེ་སྐྱེས. Per the 84000 glossary, me skyes = Jyotiṣka, not Jīvaka.
  - **N222 → wrong, OCR-driven.** The OCR has མི་སྐྱེས where the story says "born from fire", and the note follows the slip.
  - **N356 → unverifiable.** The verifier had no external source.

**Result.**

| unit | n | correct | wrong | partly-wrong | unverifiable | no checkable claim |
|---|---:|---:|---:|---:|---:|---:|
| candidate notes (worst verdict per note) | 359 | 190 | **11** | **7** | 66 | 85 |
| claims | 382 | 207 | 11 | 7 | 69 | 88 |

- **Headline.** **18 of 359 candidate notes (5.0%) are wrong or partly wrong; 11 (3.1%) are strictly wrong.** They are spread over 17 books.
  - Among the 274 notes that make a checkable claim, the rate is 6.6%.
  - Among the 208 notes whose claim could be decided, it is 8.7%.
- **Out of all 45,437 notes, 18 are confirmed wrong or partly wrong (0.040%), and 11 strictly wrong (0.024%).** This is a **floor, not a rate.** The 45,078 non-candidate notes were not checked. Among them are all `Sanskrit: X` notes under 40 characters, the shape of most of the Sanskrit-equivalent errors found here.
- **By error kind** (wrong + partly-wrong; strictly wrong in brackets):

  | kind | notes |
  |---|---:|
  | Sanskrit equivalent | 5 (4) — N050 prakṛti- for svabhāva-śūnyatā; N186 Sthiramati for Dṛḍhamati; N193 Lokeśvara/Jagaddhara for Lokadhara; N232 Harisena for Nandasena; N030 "phonetic rendering" of nam gru (a translation of Raivata) |
  | person identification | 5 (3) — N216 "Vishnu" for Ajita's son (Maitreya); N221 Jīvaka for Jyotiṣka; N332 Gyurme Pelsang → "Minling Terchen Gyurme Dorje"; N018 Musulundha → Mucilinda; N075 Śāradvatīputra as "personal name" |
  | relation guess | 2 (1) — N057 "likely Garab Dorje's father"; N093 Pema Lingpa "incarnation of Guru Rinpoche" (tradition: Pema Sel / Longchenpa) |
  | OCR-driven | 2 (1) — N222 mi skyes → "Ajāta, unborn"; N255 "Nyungpo" for Khyungpo |
  | other | 4 (2) — N287 rgya gar "literally China"; N295 Taurus–**Aquarius**–Capricorn (should be Virgo); N063 Sanskrit as "mleccha"; N298 Kadampa "founded by Atiśa" (Dromtön founded it on Atiśa's teaching) |

- **Why 15% became 5%.**
  - #5632's 40 were drawn to *carry a checkable claim*, so the 85 notes with no claim were excluded by design.
  - On comparable notes the 15% was also high by chance: the other 319 candidates gave 12 wrong or partly wrong out of 234 with a checkable claim (5.1%).
  - The full count supersedes the sample's point estimate. Its qualitative finding stands: errors are equivalents and identifications, never dates.
- **Weakest links.**
  - Verifiers made 12–23 tool calls per batch of about 21 notes. Some "correct" verdicts on stock equivalences rest on a single glossary hit.
  - 66 notes are unverifiable. Among them are a few that are plausibly wrong but unconfirmed: for N015 and N265, the verifier calls the Sanskrit doubtful. Wrong notes could hide here. Correct ones cannot, because unverifiable never counts as correct.
  - N093 and N298 are the softest partly-wrongs: common shorthand, imprecise rather than false.

**Consequences.**
1. `corrections.json` has 18 rows. Each row carries the book, page, reader URL, note, claim, verdict, error kind, correction and source. **No correction was written to production**; applying them is a separate, human-approved step.
2. The Sanskrit-equivalent and identification classes are the systematic ones. A prompt line telling the model to omit an equivalent or identification it is not sure of, rather than offer "X or Y", targets both. That remains the DECISIONS-PENDING row from #5632; the prompt was not changed.
3. Two of 18 trace to OCR. Fixing a note does not fix them, because the running text carries the same misreading. N221/N222 render me skyes as "Jivaka" in the translation itself.
4. The short-note remainder (<40 chars) is the obvious next stratum if a rate over all 45,437 notes is wanted.

**Replicated?** Partly. The instrument caught 16 of 16 fresh seeds, and 7 of 7 in #5632. Each verdict comes from one verifier. Every wrong and partly-wrong verdict was read by the author against its context, and four were checked against the OCR.

**Artifact.** `scripts/eval/results/note-facts-full-2026-10-02-5624/`:
- `candidates.json`: all 359 candidates, with `prior_cid` linking the #5632 verdicts.
- `verdicts.json`: 382 claim rows.
- `corrections.json`: 18 rows.
- `seed-verdicts.json`
- `summary.json`
- `raw/`: batch inputs and outputs, plus `candidate-filter.py`.

Cost: $0 (subscription subagents).
