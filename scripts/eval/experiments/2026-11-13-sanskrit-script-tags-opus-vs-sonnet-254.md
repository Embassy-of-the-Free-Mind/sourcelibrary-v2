---
stage: metadata
measure: [agreement, accuracy]
languages: [sa]
scripts: [Shrd, Deva]
canons: [sanskrit]
n_books: 726
n_pages: 2117
verdict: "Opus tagged 726 hidden transcribed Sanskrit books by script from three leaves each (617 Śāradā, 78 Devanagari) and matched the by-eye key on 17 of 17. Sonnet agreed with Opus on 83 of 100 and called 4 keyed Śāradā books Devanagari, so it fails the fixed rule."
status: rejected
decision: "Sonnet is not used to tag script on Sanskrit manuscripts; the backlog stays on Opus (#254). 642 books held sarada-unread-254 / sarada-ocr-invented-95."
feeds: [cost, guard]
issue: [254, 95]
---
## 2026-11-13 — Sanskrit manuscripts: script from the leaf, Opus or Sonnet? (#254)

**Question.** #95 found that the stored transcription (gemini-3.1-flash-lite) of a hidden Sanskrit manuscript can be used when the leaf is Devanagari and cannot when it is Śāradā (0 of 36 judged pages usable). The stored tag (`ai_metadata.script`) was wrong on 3 of 11 books. Two questions follow: which script is on each of the 726 books waiting for translation, and can Sonnet make that call instead of Opus?

**Frame.** Hidden books with language Sanskrit at rung `transcribed`, either waiting for translation or held `sarada-ocr-invented-95`: 726 books, 24,654 pages. Frame order is a seeded shuffle (20261113).

**Method.** For each book, three evenly spaced leaves from the middle third (2,117 leaves; 48 short books have one or two). Images come from R2, at most 1,568 px. The tagger sees only the images, under the book id, and the instructions in `scripts/eval/sa-script-tags-254/tag.mjs`. It sees no title, no identifier, no stored tag and no transcription. Calls are `claude -p` on the subscription, 8 books per call, with Read as the only tool. Opus (`claude-opus-5-5`) tagged all 726 books. Sonnet tagged the first 100 in frame order plus the 17 key books with the same images and the same prompt. The pass rule was fixed in the brief before the run: at least 97 of 100 on script, and no keyed Śāradā book called Devanagari.

**Results.**

| | Opus | Sonnet |
|---|---|---|
| key books, script (13 Śāradā, 4 Devanagari, by eye on #95) | **17 / 17** | 12 / 17 |
| key books, kind | 12 / 17 (both keyed prints and 3 MSS called "lithograph") | 13 / 17 |
| keyed Śāradā called Devanagari | 0 | **4** |
| first 100, script agrees with Opus | – | **83 / 100** |
| first 100, kind agrees with Opus | – | 92 / 100 |

Opus → Sonnet on script, first 100: Śāradā→Śāradā 77, Śāradā→Devanagari 13, Śāradā→unclear 4, Devanagari→Devanagari 5, unclear→unclear 1. Every disagreement is Sonnet moving a Śāradā book toward Devanagari or unclear. Sonnet usually marked those calls unsure, and often wrote "Śāradā not excluded" in its note.

Opus over the frame: Śāradā 617 (500 manuscript, 117 "lithograph"; 142 unsure), Devanagari 78 (49 manuscript, 19 print, 10 "lithograph"; 15 unsure), mixed 7, unclear 6, Gurmukhi 4, Perso-Arabic 4, no text 4, Latin 3, Newar 2, Kannada 1.

**What it does not show.** The key holds 17 books and one reader. Opus's 17/17 bounds its Śāradā/Devanagari error at roughly 1 in 6 or better (95%), not at 1%. The 142 unsure Śāradā calls were not looked at again. The kind call is weak: "lithograph" was wrong on 5 of the 17 key books, so `book_class.class` is left unchanged where Opus said lithograph. Agreement between Opus and Sonnet is agreement, not accuracy. Only the 17 key books are accuracy.

**Taken.** The tags are written to `books.book_class` (`script`, `kind`, evidence, version `script-tags-254-v1`; the replaced value is in `sweep_log`). 633 books are newly held `sarada-unread-254`, and 9 keep `sarada-ocr-invented-95`. Per-book rows: `scripts/eval/sa-script-tags-254/tags.tsv`; tables: `compare.json`. Cost: 91 Opus calls (notional $56 API-equivalent, $0 cash) and 15 Sonnet calls (notional $4).
