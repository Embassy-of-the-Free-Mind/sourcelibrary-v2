---
stage: ocr
measure: judged
languages: [sa, ar]
scripts: [Deva, Arab]
canons: []
n_books: 20
n_pages: 500
verdict: "Opus correction of the stored lite text beat a Flash re-read in Sanskrit and Arabic too, the same answer as in Latin, Chinese, German and Greek. Blind Opus readers judged all three texts of each page against the image. Sanskrit, 250 pages in 10 printed books: lite 208 misleading, correction 26, re-read 125, with the correction preferred over the re-read 214–14 and 0 pages made worse than lite. Arabic, 250 pages in 6 printed books and 4 manuscripts: lite 193 misleading, correction 44, re-read 144, preferred 175–41. The agy Flash-low cross-check agreed in both languages (20–8 and 19–11). On 4 pages of a modern, probably in-copyright Arabic book, Opus declined to reproduce the page. It returned only tags and a <warning> listing its corrections, and correct.mjs counted that as a correction. That is a guard gap that would empty those pages if applied."
status: informational
decision: "No production write. Recommended route: C (Opus correction of the lite text) for Sanskrit and Arabic. Before any correction is applied, correct.mjs needs a guard that refuses a 'corrected' text whose body has almost no letters next to its draft. Cost of the correction per 1K pages: about 5% of a Claude account-week in each language. The Flash re-read costs about 1.05 agy calls a page."
superseded_by: null
issue: [7568]
---
## 2026-10-28 · Correct or re-read, wave 2: Sanskrit and Arabic (#7568)
<!-- PRIOR ART: 2026-10-28-correct-vs-reread-wave1-zh-de-grc-7568.md (wave 1, whose clear answer opened this wave) and 2026-10-27-correct-vs-reread-wave1-prereg-7568.md (design, and amendment 2 for this wave, committed before its draws). -->

**Design.** Same as wave 1 (amendment 2 to the preregistration):
- draws `w-draw.mjs` with seeds 75684 (sa) and 75685 (ar), from books in terminal status `complete`, ≥ 70% lite-read;
- a format screen that keeps manuscripts;
- arms L / C (`correct.mjs --model=opus`) / R (`cli-ocr.mjs read`, agy `gemini-3.8-flash-low`);
- one blind Opus reader per book over all three texts (Step T);
- agy Flash-low on 30 seeded C ≠ R pages.

**Sample.**
- **Sanskrit:** the first 10 of 13 that passed, all Devanagari print. The screen failed one book with full Hindi translations.
- **Arabic:** the first 10 of 14, 6 print and 4 manuscripts (a Ḥāwāshī commentary, al-Ḥāwī, a Qurʾān, a Maghribī *Majisṭī*).

**Outcomes of the correction call.**
- **Sanskrit:** 247 corrected, 3 unchanged.
- **Arabic:** 213 corrected, 18 unchanged, 14 contain, 5 no-answer. The no-answers are all in one two-page-spread book; the chatter guard restarted the read.
- **R** read every page. Gemini's filter cut the text short on 3 Sanskrit and 17 Arabic pages.

**Result** (`flash-reread-5924/results-7568/{sa,ar}/score.json`; Wilson 95%)

| | n | misleading L | misleading **C** | misleading R | C vs R preferred (tie) | worse than L: C / R | agy C–R (Opus, same pages) |
|---|---|---|---|---|---|---|---|
| Sanskrit (print) | 250 | 208 (78–87%) | **26 (7–15%)** | 125 (44–56%) | **214–14** (22), p < 10⁻⁴⁶ | **0** / 21 | 20–8 (25–1) |
| Arabic | 250 | 193 (72–82%) | **44 (13–23%)** | 144 (51–64%) | **175–41** (34), p < 10⁻²⁰ | 24 / 32 | 19–11 (21–5) |
| …Arabic print (6 books) | 150 | 111 | **24** | 66 | 98–29 (23) | | |
| …Arabic MSS (4 books) | 100 | 82 | **20** | 78 | 77–12 (11) | | |

- **Route (preregistered rule): C in both.** C halves L in both languages; R halves L in neither.
- **Bar (b) for C fails in Arabic on 24 pages.** By kind:
  - **14 contains.** By rule they count as "false contains", because readers mark only another leaf's text as `not_this_leaf`. But the readers called L misleading on 14/14:
    - 3 are blank leaves where L serves an invented "preface";
    - 11 are *Majisṭī* pages where L is a repetition loop.
  - **5 no-answers.** C serves L there.
  - **4 non-transcriptions** (below).
  - **1 real C misreading:** *al-Aʿlāq* p64, where C turns حرب لاقح ابدا into حرب لا تقع ابدا.
- **Self-preference.** The cross-family judge agrees in both languages, by smaller margins than Opus.

**The guard gap.** *Al-Durra al-Fākhira* (`6a08a754871243dce9def039`) is a modern typeset book, probably in copyright. On pp. 6, 12, 16 and 18 the corrector:
- declined to reproduce the page;
- answered with only the metadata tags and a `<warning>` that lists its corrections ("The full corrected page is not reproduced here …");
- and `correct.mjs` scored it `corrected`. The chatter guard and the write guard both passed it.

Applied, those pages would lose their whole body. Across the five languages it happened on these 4 pages only: no other correction has a body under 30% of its draft's letters, except two that cut a looping draft down to the page. A guard of "body letters ≥ some share of the draft's" would catch it. Whether that book should be public at all is a separate question.

**By eye** (image open, crops, unblinded; C is the one to serve on all 4)
- **sa `6a0eb388…` p51.** C fixes ललाटाद्यै, विलया, सशब्दं and सूक्ष्म. It also silently emends the print's own typo नन्तविधानात् to चिन्तनविधानात्. R has वरदात्तार, प्रपञ्च → पपञ्च and -तन्रे.
- **sa `69e13a96…` p37.** C fixes महार्थदृष्ट्या, रज्यति, आपद्यते and the footnote महादृगादि, with no new errors. R splits अलंग्रास and misreads the footnote.
- **ar `69ef3d42…` p60 (two-page spread).**
  - C fixes the page numbers, المساقط and الزمان, and emends الحتم → الختم.
  - C inherits L's omission of السعيد and the ف of فحينئذ, which R has.
  - R reverses the order of the two pages.
- **ar `6a477ce5…` p287 (Khiṭaṭ).** C repairs a heavily garbled L, checked against the print in 8 spots; its one slip is a lost و. R has وألوز برمحه for والوزير معه, توفيرا, ويقيمون and وتندب.
- **Pattern across the five languages:**
  - **C sometimes emends toward the expected text instead of the print.** In wave 1 the cases were the Lotus Sutra lacunae and the Homeric cento. Here they are चिन्तनविधानात् and الختم.
  - **C keeps what L dropped only when it notices the gap.**

**Cost** (Claude subscription, box account dereklomas@gmail.com; $0 billed)

| Language | Pages | Calls | Output tokens | List price | Per 1K pages |
|---|---|---|---|---|---|
| Sanskrit | 250 | 30 | 650K | $24.35 | $97 |
| Arabic | 250 | 37 | 668K | $26.15 | $105 |

- On wave 1's scale (Latin's $20.28 per 250 pages ≈ 1% of an account-week), the correction costs **about 5% of an account-week per 1K pages in both languages**.
- **Wave 2 as a whole** (corrections, 2 screens, 20 readers, by-eye): the weekly meter went **46% → 53%** (02:35Z → 04:40Z). That is an upper bound, because the account is shared.
- **R:** 530 agy calls for 500 pages.

**Human check (#7573):** `scripts/eval/dataset/judge-human-check-7573/{sanskrit,arabic}.jsonl`. It has the same shape as wave 1, with 30 `review: true` rows per language.

**Caveats.**
- Exploratory: 10 books per language, a single-family judge with a 30-page cross-family check, and no human calibration (#7573).
- The reader packets carried only the first line of each language's `lang_note`. The readers had the full note in `T-TASK.md`, and one used it explicitly. `w-packets.mjs` is fixed for later runs.

Files: `scripts/eval/flash-reread-5924/results-7568/{sa,ar}/` and the `w-*.mjs` scripts there.
