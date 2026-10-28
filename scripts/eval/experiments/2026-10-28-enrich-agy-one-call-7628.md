---
stage: metadata
measure: [judged]
languages: [zho, lat, deu, fra, yua, nah]
scripts: [Hani, Latn]
canons: []
n_books: 20
n_pages: 6990
verdict: "agy Gemini 3.8 Flash low enriches a book (index extractions + summary + chapters) in one conversation: 115 model requests for 20 books against the API lane's 439 (2.7 a book against 10.9 below 650K characters), ~66 s a book. Read side by side, the summaries are more specific than flash-lite's and every specific claim checked was on the page (the API lane called a signed catalogue anonymous; agy named the signer). Chapters as complete or more (Stanley 72 vs 35, Kangxi vol 31 14 vs 4). Quotes found verbatim on the pages: 82% (1,150/1,398), the API lane's own rate is 81% (195 books, its log). Two conditions: at most 600K characters a conversation (over that, 4-55% of quotes were on the page), and a style check at the end of the prompt (without it 18 style-list slips in 20 books, with it 3 in 14; the API lane 3 in 20)."
status: adopted
decision: "Lane enrich-worker.mjs --agy on main every 2 h, 600 requests a day (~a quarter of one pool's week at the measured ~10 ordinary calls a request), 600K characters and 8 turns a conversation; over that, or failed, a book goes back to the API batch lane."
superseded_by: null
issue: [7628, 2141, 7614]
---
PRIOR ART: `scripts/workers/lib/enrich-batch-lane.mjs` (the API batch lane this is compared against: three rounds over
50K-character page batches on flash-lite) and `2026-10-27-agy-ocr-pace-read-file-correct-lane-7558.md` (the quota floor
and pool reading reused here). The per-book rows and both outputs are in the job's scratch (`pilot*/`), not committed.

## 2026-10-28 · Can enrichment run on agy, one conversation a book? (#7628)

**Why.** Enrichment ran on the paid Batch API (flash-lite) and stopped 10-25 to 10-28 when its envelopes expired;
~5,300 live books lack a summary and index. Derek, 2026-10-28: "build it", with about a quarter of one agy pool's week.

**Transport, found on the way (agy 1.4.9).**
- One argv string is capped at 128 KB, so the prompt goes on stdin: `--input-format stream-json` (needs
  `--output-format stream-json`), `-p ''`, message `{"event":"user","message":{"role":"user","content":[{"type":"text","text":…}]}}`.
- **agy cuts one message at ~190K characters, silently.** Asked about a 265K-character message, the model said the text
  stopped at line 2540 "at the truncation limit". Several messages in one conversation all arrive (3 messages, 380K
  characters: the last turn quoted all three). So a book goes as messages of ≤150K characters, each answered "OK",
  tasks in the last; one model request a message. Every turn re-reads the conversation, so input grows with the
  square of the turns: an 18-turn chapter prompt read 11.7M tokens. Cap: 8 turns, over that the API lane.
- With the instructions only after the text, the first whole-book call came back as prose with no JSON. Said first and
  last, every call returned the JSON object. One reply wrapped it in a ```json fence (accepted); one book's quotes came
  back keyed `quote` instead of `text` (renamed before grounding, else all are dropped).

**Pilot.** 20 books with API-lane output already written: 5 Siku (paddle-zh-5600 cohort), 5 Latin, 5 German, 5 long
(640-1,300 pages). Compare mode: nothing written. Read both outputs for each book.

| set | book | pages | text | agy requests | s | API requests | quotes on page | chapters agy / API |
|---|---|---|---|---|---|---|---|---|
| Siku | Continuation of Rhyming Binomes | 177 | 397K | 2 | 36 | 11 | 18/27 | 11 / 4 |
| Siku | Brocade Valley of Ten Thousand Flowers | 98 | 195K | 1 | 69 | 6 | 13/15 | 55 / 23 |
| Siku | Sea of Meanings of the Book of Changes | 161 | 329K | 2 | 60 | 9 | 27/28 | 25 / 10 |
| Siku | Kangxi Dictionary vol 1 | 247 | 579K | 2 | 43 | 15 | 32/39 | 13 / 8 |
| Siku | Kangxi Dictionary vol 31 | 250 | 1134K | 7 (2 parts) | 102 | 26 | 84/91 | 14 / 4 |
| Latin | Sapientia veterum Hebraeorum | 178 | 545K | 4 | 75 | 14 | 34/36 | 9 / 8 |
| Latin | Principium et finis politicae doctrinae | 200 | 641K | 6 (2 parts) | 117 | 16 | 44/56 | 14 / 13 |
| Latin | De Ieiunio et abstinentia | 186 | 275K | 2 | 71 | 8 | 21/24 | 23 / 23 |
| Latin | Oracula magica Zoroastris | 184 | 261K | 2 | 35 | 8 | 19/22 | 5 / 5 |
| Latin | Historia philosophiae orientalis | 242 | 516K | 3 | 148 | 13 | 33/44 | 72 / 35 |
| German | Verzeichniss der altdeutschen Bilder | 36 | 38K | 1 | 36 | 3 | 4/4 | 11 / 11 |
| German | Albertus Magnus von Weibern | 112 | 132K | 2 | 39 | 5 | 10/12 | 11 / 11 |
| German | Geschichte der Talismannischen Kunst | 220 | 292K | 2 | 40 | 8 | 19/20 | 6 / 6 |
| German | Das Konjugationssystem der Mayasprachen | 59 | 182K | 1 | 46 | 6 | 13/16 | 9 / 9 |
| German | Material zur Sprache von Comalapa | 245 | 622K | 4 (2 parts) | 73 | 15 | 25/40 | 9 / 9 |
| long | Bibliographie instructive [2] | 854 | 1177K | 8 (2 parts) | 116 | 26 | 49/72 | 13 / 13 |
| long | Bodin, Les six livres de la République | 1300 | 4093K | 22 (7 parts) | 357 | 87 | 263/322 | 23 / 23 |
| long | Evangeliarium … Aztecum | 640 | 2084K | 13 (4 parts) | 206 | 46 | 132/156 | 27 / 27 |
| long | Sermonario en lengua mexicana | 860 | 2985K | 17 (6 parts) | 290 | 65 | 179/224 | 21 / 21 |
| long | Diccionario de Motul vol 1 | 944 | 2416K | 14 (5 parts) | 200 | 52 | 131/150 | 16 / 16 |

"API requests" is what the batch lane sends for the same book: one per 50K-character page batch, one summary, one
chapters. "Quotes on page": the extraction quotes `quote-grounding.mjs` finds on the page, the check every enrich
write applies (a quote not found is dropped, never written). A book over 600K characters is read in parts: extractions
part by part, then the batch lane's own summary prompt over them, plus chapters, in one last call.

**Reading both.** On 19 of 20 books the agy summary is the better one. It is more specific, and the specific claims
checked against the text all held. agy named Georg Schütz, who signs the Frankfurt catalogue (p. 8), where the API
lane called the catalogue anonymous. It found Viringus as canon of Arras (p. 12), the refutation of Cornarius and Fuchs
(pp. 139-143), Colberg at Greifswald (p. 1), and the King's Library copies in de Bure (pp. 50, 209). Its chapter lists
are as complete or more: the Psellus sections of the *Oracula* (pp. 77, 146), every radical of Kangxi vol 31 (the API
list stops at the first), and Stanley's chapters III-IV. The exception was Kangxi vol 31 read whole (1.1M characters
in one conversation): a one-sentence brief, and 3 of 75 quotes on the page. Read in two parts it was fine (84/91 on
the page, a normal brief), which is where the 600K cap comes from. Over all conversations above ~650K characters,
4-55% of quotes were on the page. Read in parts: 83%.

**Style.** Without the end-of-prompt check, the agy summaries broke the summary prompt's style list 18 times in 20 books
("comprehensive" 8, "testament" 3, "intricate" 2, em-dashes 2, "seminal", "you", "readers"); the API lane's 3 in 20.
With the check: 3 in 14 (the 6 books read in parts were not re-run with it).

**Quota.** Two windows of /quota on the shared default pool while other lanes ran: a request here (≤150K characters
plus the conversation so far) weighed about 10 ordinary agy calls (rough). So 600 requests a day ≈ 6,000
call-equivalents ≈ 40K a week ≈ a quarter to a third of a pool's week at ~104-150K. Lowered if the meter says so.

**Writes (pilot):** none in compare mode. The write path was checked on 2 gap books: Reg. lat. 1278 (1,118 pages, 15
requests, summary + index with `engine` blocks) and the Complutensian Polyglot (chapters only, 114 chapters with
`field_provenance.chapters`; 18 requests, which is why the 8-turn cap exists).
