---
stage: ocr
measure: [judged]
languages: [la, de, fr, zh, bo, he, ar]
scripts: [Latn, Hani, Tibt, Hebr, Arab]
canons: []
n_books: 64
n_pages: 66
verdict: "Most transcription errors that matter do NOT reach the English: of 109 errors confirmed against the image, the English repairs 71 (65%, 56–73%), carries 29 (27%, 19–36%) and drops 4. Only 18 (17%, 11–25%) leave the reader with a wrong meaning, name or number. It depends on the stratum. Tibetan GPU errors are mostly non-words inside stock canonical phrases and are repaired 88% (77–94%). Gemini-read Latin, German and French errors are fluent real-word swaps and carry 54% (35–72%). The judge passed 23 of 24 planted controls."
status: informational
decision: "For the all-books pass (#7896): judge the English against the image on every stratum, because it is what readers read and it catches what carries. Keep a transcription judge only where errors carry or the original is quoted: Latin, German and French Gemini reads, Chinese, Hebrew and Arabic. On Tibetan, judge the English and loosen the transcription rule so that a non-word in a stock phrase does not fail the page. No cron, router or book_checks change in this PR."
superseded_by: null
issue: [7611, 7896]
router_evidence: "none — measures what translation does with transcription errors already adjudicated in #7807/#7918; adds no route k/n"
defect_rates: "none — measures error propagation into English, not a route's defect rate"
---
## 2026-11-02 · Do the transcription errors Opus passed reach the English? (#7611)

PRIOR ART:
- `2026-11-01-flash-tier-judge-7611.md` (#7918, plus the qualitative section in #7928) found that at least 52 of 158 transcription pages Opus passed carry an error the adjudicator says matters. This entry takes those adjudications as its input.
- `scripts/eval/judge-compare-7611/results/2026-10-30` and `2026-11-01`: items, and the blind Opus adjudications with `real_defects[]` (`class`, `quote`, `matters`).
- `scripts/batch/cli-translate.mjs read`: the live translate prompt and the agy call, reused in `xlate.mjs` without its R2 and `lane_job_books` writes.

**Question (Derek, 2026-11-02).** "Then I guess we need to evaluate the translations resulting from these. If the translations are fine, it's not an issue." Readers mostly read the English. If the translator silently repairs a misread, then the transcription error costs readers little.

### Method

1. **Error list (`build.py`).** Every adjudicated `real_defects` entry with `matters: true` on a real transcription item (task ≠ translation), from any judge arm, whatever Opus decided. Duplicates across arms were merged by (item, quote).
   - **264 errors on 78 pages. 203 of them are on the 58 pages Opus passed.**
   - Each was joined to the page's live `translation.data` and to the OCR the English was made from. Translations carry no source hash, so the source is the OCR in force at `translation.updated_at`, rebuilt from `page_revisions`. This is inferred from dates.

   | where the error stands | errors |
   |---|---:|
   | no live English (28 pages; 1 of them `health_blocked`) | 115 |
   | live English made from the same transcription that was judged | 52 |
   | live English made from an earlier transcription that has the same misread | 57 |
   | live English made from a transcription without this misread (the judged text was a router-test candidate, or a later re-read) | 40 |

   Many judged texts were router-test candidates that were never stored, which explains the last row and most of the "no live English" pages. To test the lane as it runs now on those pages, **6 no-English pages (23 errors; Latin GPU>GEM, Latin GEM and Chinese GPU) were translated from the judged text** with the live prompt on agy `gemini-3.8-flash-low`. These are labelled `flash-fill` and reported separately.
2. **Judge (`judge.py`, `judge-prompt.md`).** One blind `claude -p --model opus` call per page.
   - Inputs: the page image, opened with Read; the transcription the English was made from; the English; and the error spots as quoted strings. It is not told which reading is right.
   - For each spot it reads the image and returns the image reading, whether the transcription matches the image, the English passage, and one outcome: `carried`, `repaired`, `dropped`, `not_an_error` or `other`. It also gives a severity: `none`, `cosmetic`, `misleads` or `wrong_text`.
   - 66 calls: 42 real pages and 24 controls. List-equivalent cost $23.56 on the subscription, through claude-pace-guard.
3. **Positive control.** 24 real pages that were not in the error list, each with one misread planted in the transcription: a number, a name, a title, or a fluent word swap. The English was made from the edited text by the live prompt on agy Flash, which used 24 of the 30 agy calls; the fills used the other 6. I read each control's English myself to set the truth.
   - The translator itself repaired 6 plants (5 with a `<note>` naming the misread) and dropped 2, a running head and a number. So the controls test both directions: 16 `carried`, 6 `repaired`, 2 `dropped`.
   - **Judge on controls: 23/24.** 16/16 carried, 6/6 repaired, and 1/2 dropped. The miss was "gli altri tre" rendered as "the other frenzies": the number was left out, and the judge called that `other` with that reason. Its image reading was the true text on all 24.

### Results

The judge disagrees with the adjudicator on 23 of 132 spots: it reads the image as matching the transcription. Mostly these are abbreviation marks and case endings (`fortunâ`/`fortunā`), 11 Tibetan spots and 5 Chinese ones. They are excluded below. **109 confirmed errors**:

| stratum | n | carried | repaired | dropped | other | reader loses (misleads + wrong_text) |
|---|---:|---|---|---|---:|---|
| Tibetan GPU | 58 | 6 (10%, 5–21%) | 51 (88%, 77–94%) | 0 | 1 | 3 (5%, 2–14%) |
| Latin/German/French Gemini reads | 24 | 13 (54%, 35–72%) | 8 (33%, 18–53%) | 2 | 1 | 8 (33%, 18–53%) |
| Latin GPU>GEM | 9 | 4 (44%, 19–73%) | 3 (33%, 12–65%) | 2 | 0 | 1 (11%, 2–44%) |
| Hebrew | 9 | 3 (33%, 12–65%) | 4 (44%, 19–73%) | 0 | 2 | 3 (33%, 12–65%) |
| Chinese GPU | 8 | 2 (25%, 7–59%) | 5 (62%, 31–86%) | 0 | 1 | 2 (25%, 7–59%) |
| Arabic | 1 | 1 | 0 | 0 | 0 | 1 |
| **all** | 109 | **29 (27%, 19–36%)** | **71 (65%, 56–73%)** | 4 (4%, 1–9%) | 5 | **18 (17%, 11–25%)** |

| class | n | carried | repaired | reader loses |
|---|---:|---|---|---|
| O6 word change | 87 | 17 (20%, 13–29%) | 66 (76%, 66–84%) | 11 (13%, 7–21%) |
| O5 dropped text | 4 | 2 | 2 | 1 |
| O7/O11 numbers, running titles, signatures | 3 | 2 | 1 | 1 |
| other (O10 Greek in Latin, O14/O16 image descriptions, O8, O1, O4, O12) | 15 | 8 (53%, 30–75%) | 2 | 5 (33%, 15–58%) |

The classes do not tag names, so names are not counted on their own. Of the 13 carried errors that mislead, 2 are names (Mingding, Bourguesi) and 2 are Greek quotations inside Latin.

- **On pages Opus passed** (94 errors): 24% carried (17–34%) and 68% repaired. 12% (7–20%) leave the reader with a wrong meaning. On pages Opus failed (15): 40% carried, and 47% leave the reader with a wrong meaning.
- **By English source:** live English from the same transcription: 17% carried, 83% repaired (n=42). From an earlier transcription with the misread: 30% carried (n=50). Fresh Flash fills: 41% carried (n=17).
- **Carried errors:** 16 cosmetic and 13 misleading. 7 of the 29 carry a translator `<note>`, but the running English still follows the misread.
- **By page:** 11 of the 38 pages with a confirmed error have at least one spot where the English misleads or is wrong.

**Why it splits this way.** A misread that produces a **non-word**, or a broken spelling of a stock phrase, is repaired: the translator reads through it. Most Tibetan GPU "errors that matter" are of this kind: བཤེགས for གཤེགས, སངས་རྒས for སངས་རྒྱས, བདོད for འདོད, all in Kangyur formulae. The same goes for a known canonical text: the Massachusett Job page (labelled Hebrew) comes out as KJV Job whatever the misread. A misread that produces a **real word, a name or a number** is carried, because nothing tells the translator it is wrong: Ehern 'iron' for Eyern 'eggs', ཐོས 'heard' for བསྟན 'taught', 臣明鼎 for 臣明昂. The Gemini reads carry more because their errors are fluent by construction.

### Examples (all live English unless marked)

**Carried** (transcription → image → English):
1. Tibetan: རྣམ་པར་ཐར་པ་བརྒྱད་ཐོས་ནས ('heard') → བསྟན ('taught') → "King Destroyer of All Enemies heard the eight liberations from the Lord Tathagata" (book `69e7ab9e…`, p.269).
2. German: "Ehern" → "Eyern" (eggs) → "hair, semen, iron, and other such merely sodomitic things" (`69b51e63…` p.35).
3. Chinese: 臣明鼎 → 臣明昂 → "Your servant Mingding, Seal-Holding Abbot of Wanshou Temple" (`6a3c770f…` p.33).
4. Arabic: المجمعة ('agreed') → الممكنة ('possible') → "matters commonly agreed upon that should be pursued or avoided" (`69c1b7af…` p.29).
5. Latin: "fluminis assumptionē" → "ꝯsumptionē" (consumptionem) → "the burning of a river or its taking" (`69dbc7d7…` p.20).
6. German: "das 2c" → "das το" (the Greek article) → 'the "etc." seems to stand quite superfluously' (`69b51ed3…` p.225).
7. French: "Bourguefi" → "Bourgueſi" → "Mr. Bourguefi came to see me" (`6a44359d…` p.96).
8. Tibetan: རྭ་ལས་ལ → རྭ་ལས་ཁབ་རལ → "work with bone, ivory, or horn": one craft is lost (`69e7ab2c…` p.330).
9. Hebrew: `<sig>ח 3</sig>` → ח 8 3 → the signature is copied without the 8 (`69b4cd3d…` p.291).
10. French image description: "staff topped with a star and a dove" → a sceptre with a cluster of stars. The English note repeats the description (`69592fb8…` p.49).

**Repaired:**
1. Tibetan: དེ་བཞིན་བཤེགས་པ → གཤེགས → "the Tathagata, the Arhat".
2. Tibetan: སངས་རྒས → སངས་རྒྱས → "the Perfectly Complete Buddha Akshobhya".
3. Tibetan: བདོད་པ → འདོད་པ → "the gods of the Desire Realm".
4. German: "noch zeitlich recht" → "Liecht" → "sees neither the eternal nor temporal light".
5. German: "transmuret" → "transmutiret" → "Art transmutes this same matter into iron in five months".
6. Chinese: 荒服者王曰祭 → 王日祭 → "the daily sacrifice, the monthly…".
7. Chinese (flash-fill): 從滅法開平方 → 減法 → "extracting the square root by subtracting".
8. Latin (flash-fill): "illud fieri afferendum est" → "asserendum" → "it should not be asserted".
9. Latin (flash-fill): "efferni nefas est" → "efferri" → "it is forbidden to publish it to the multitude".
10. Massachusett (labelled Hebrew): "NEwutche Job noow8hhinnum" → a different word on the leaf → "Wherefore, Job, I pray thee, hear my speeches" (KJV).

**Dropped (4):** Latin "per teneri-/rum Dei" (tenerrimum) is left out of the English, twice (`69c81b3f…` p.205). Two Greek spots in a flash-fill Latin page appear only inside a note.

### What this means for #7896

- **Tibetan (GPU):** errors mostly repair. 10% are carried and 5% leave the reader with a wrong meaning. **Judge the English against the image.** A transcription judge with a strict rule would fail these pages over non-words a reader never meets. If transcription is still judged, the rule should fail a page only for a fluent swap (a real word, name or number for another), not for a misspelling of a stock phrase. The few Tibetan errors that do carry are exactly that kind (heard/taught).
- **Latin, German and French Gemini reads:** errors carry (54%), and a third leave the reader with a wrong meaning. **Judge both.** Transcription QA matters here as it stands.
- **Chinese, Latin GPU>GEM, Hebrew and Arabic:** small n (8, 9, 9, 1) and mixed results; names and numbers carry. **Judge both.** On Hebrew, the transcription judge is also what catches wrong-leaf confabulation (below).
- **Everywhere:** the transcription is quoted, searched and cited directly (`/book` quotes, snippets), so a carried-or-not test only answers the English half. The English judge is the reader-facing gate. The transcription judge is what protects quotes.

### Wrong English found (listed only; this job writes nothing)

| book | page | what is wrong |
|---|---:|---|
| 69c1bab38522835be8459bf4 (Commentaries on the Bible and the Mishnah) | 250 | **Wrong leaf / confabulated:** the transcription and English render Avot ch. 4 (Ben Zoma) and a ברכו line, but the image is a different passage (Avot ch. 3). Both Opus reads agree. The book is visible and in `loop_quarantine_hold`, and the page is not withheld. |
| 69e7ab9e5f1a22ab19a9b03b (Kangyur) | 269 | "heard the eight liberations" for "taught" |
| 69e7ab2c5f1a22ab19a9418f (Kangyur) | 330 | one craft missing from the list |
| 6a3c770f01fe4f593c1ff7e4 | 33 | name Mingding for Ming'ang |
| 6a3c647039b4508b04e270ea | 60 | 釋構 for 釋褠: "Dressing in Trousers to Manage Affairs" |
| 69b51e63768235dc659928d8 | 35 | "iron" for eggs |
| 69b51ed3ff09e4fe943b565f | 225 | "etc." for the Greek article |
| 69c81aed6c6f3cc53c849851 | 205 | "tenerrimum Dei" passage left out |
| 69c1b7affe4b8f25b92010a5 | 29 | "agreed upon" for "possible" |
| 69dbc7d71040d1d5e2094b24 | 20 | "its taking" for its consumption |
| 6a44359d0235c9147000dd12 | 96 | name Bourguefi |
| 69592fb8a41e40e9146a4943 | 49 | description note: staff with star and dove |
| 69b4cd3dd5b6c3815e1a504b | 291 | signature ח 3 for ח 8 3 |
| 69e7abf05f1a22ab19aa0a8f | 94 | a closing phrase left out |

### Caveats

- The input is the adjudicated defects, so it inherits #7918's sampling: hard cells are over-weighted, and only pages where two judges disagreed were adjudicated. This is a rate per adjudicated error, not per page in the library.
- The judge is Opus pointed at spots, like the adjudicator. It is checked by 24 controls (23/24), but nobody re-read the Tibetan or Chinese real spots by eye.
- Whether the English was made from the same transcription is inferred from dates, because translations carry no source hash. That is worth adding: `translation.source_ocr_hash`.
- The Massachusett page is labelled Hebrew in the items, and is counted as Hebrew above.

### Files

`scripts/eval/ocr-error-to-translation-7611/`: `build.py` (error list and provenance), `fetch.mjs` and `revs.mjs` (read-only Mongo), `xlate.mjs` (the live prompt on agy, no writes), `judge.py` and `judge-prompt.md`, `score.py`. Outputs are in `results/2026-11-02/`: `pages.jsonl.gz`, `spots.jsonl.gz`, `controls.jsonl.gz`, `fills.jsonl.gz`, `judge-raw.jsonl.gz` and `score.md`.
