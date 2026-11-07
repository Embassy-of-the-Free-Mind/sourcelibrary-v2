# Wave 2 by-eye notes (2026-10-30)

PRIOR ART: `../translation-corpus-audit-2026-09-30/eye-notes.md` (wave 1's hand read of 20 pages); this file is the
same step for wave 2, done by the job session with the served image open. Narrative: `scripts/eval/experiments/2026-10-30-tca-wave2-dual-judge-5274.md`.

## 1. The 20 books the two judges disagree on most

Read against the page image, the transcription and the English. "Right" means the score the rubric
(`JUDGE-PROMPT.md` + `IMAGE-ADDENDUM.md`) asks for, not which judge's prose was nicer.

| # | item | lang | Opus | Gemini | read | right |
|---:|---|---|---:|---:|---|---|
| 1 | 53eba5b610 | Greek | 4 | 1 | Gemini says the English follows the transcription "with high accuracy" and still gives 1: it scored the image, which the addendum forbids. Whether the transcription is this leaf could not be settled at scan resolution (cursive MS). | Opus |
| 2 | a1be80bcb2 | Tibetan | 5 | 2 | The garbled first line ("the wise who are the wise…") is rendered literally, not smoothed into a claim; lines 2–7 are faithful. | Opus |
| 3 | cf92626d76 | Chinese | 5 | 2 | A Shijing score: lyric syllables romanised with the tablature glyphs, the stanza's English only in a note. Gemini's "transliterated, not translated" has a point; 5 is generous, 2 harsh. | split |
| 4 | 5357b9fcbd | Greek | 5 | 2 | The uniform values (κδ γ' μδ γ' Α δ) are in the transcription; the English is faithful to it. Gemini's "invents values" is a claim about the image or a misreading. | Opus |
| 5 | fb4d166c33 | Japanese | 2 | 4 | はりぬき (papier-mâché) becomes "lid", 首 (head) "cylinder", and the doll that flips from belly-up to belly-down becomes one that "settles toward the back". | Opus |
| 6 | e86406e2a9 | Hebrew | 4 | 2 | A litany of attributes rendered as "is the …" sentences: a minor slip, not "substantial parts wrong". | Opus |
| 7 | 0d9b5a6e26 | Tibetan | 4 | 2 | All three leaves translated, in reverse order. Order of leaves is layout; meaning is kept. | Opus |
| 8 | 4ab28b7b9c | Tibetan | 3 | 5 | Corrupt divination lines; I cannot settle whether they are rendered "as fluent instructions". | unsettled |
| 9 | 7b0cd73b41 | Japanese | 3 | 5 | Early-modern prose; not settled by me. (The transcription is of another leaf — contained, §2.) | unsettled |
| 10 | 6ccbdcc374 | Hebrew | 3 | 5 | Gid ha-Nasheh context: חלב מפעפע is forbidden fat permeating; the English says "milk" throughout. | Opus |
| 11 | bfef3a4a94 | Sanskrit | 3 | 5 | Corrupt commentary; not settled. | unsettled |
| 12 | 75a963a5f2 | Greek | 3 | 5 | The garbled opening Greek ("ὁ δὲ μανὶ τὸν δ' ἐμέ…") comes out as confident nonsense prose ("he, the madman…"): garble pass-through. | Opus |
| 13 | de3204af00 | Chinese | 3 | 5 | Radical index over an unreliable OCR; regrouping real, scale not settled. | unsettled |
| 14 | cfdd57497d | Latin | 3 | 5 | "Cum spongia aduritur cum oleo" (burnt with oil) becomes "applied with a sponge and oil"; not a 5. | Opus (closer) |
| 15 | 785ecdc0f1 | Hebrew | 2 | 1 | Gemini scored the leaf mismatch (true — contained, §2), not the English; Opus's ויתר → "permitted" inversion is the rubric's finding. | Opus |
| 16 | 974ae0ae78 | Italian | 1 | 2 | Four paragraphs of anatomy over an 893-character label: "mostly not this page's text" = 1. | Opus |
| 17 | 64e631dc91 | Sanskrit | 2 | 3 | Same finding (commentary dropped), one point apart. | tie |
| 18 | 369d2b577c | Japanese | 2 | 3 | Same finding (OCR loop), one point apart. | tie |
| 19 | b883cdf746 | Hebrew | 2 | 3 | Targum column dropped AND verses imported from the next page: substantial = 2. | Opus |
| 20 | 7209ac2836 | Italian | 2 | 3 | Same finding (opening ~7 lines dropped), one point apart. | tie |

**Tally: Opus 12, Gemini 0, split or tie 4, unsettled 4.** Two of Gemini's lowest scores (1, 15) broke the
addendum's one rule (score the text, record the image separately), and its high scores on garbled pages (10, 12,
14) missed what Opus named. This is one reader's read of 20 hand-picked disagreements, not a rate.

## 2. Contained (containment-on-finding.md): 14 pages, 14 books

Each was named by a judge with the image open, read by me against the image or the neighbouring pages'
transcriptions, then held (`hold-pipeline-books.mjs --reason tca-wave2-contained-5274`; five Japanese books were
already held for another reason) and withheld (`withhold-stale-translations.mjs --by-eye-pages`, snapshot in
`page_revisions`). Undo: `restore-withheld-translation.mjs`. Repair (re-read / re-translate) is owed and unpriced.

**English not of this text (8):**

| book:page | lang / arm | what |
|---|---|---|
| 69f3276f52a77bb28fdb7316:3 | Japanese / flash | a garden title and diagram note invented; the stones / tsukiyama / incense-burner text dropped |
| 69e75ccc3f15c712bdb8f04e:40 | Japanese / lite | "plum blossom … monkeys fly": no counterpart in the Umewaka / Hiei text |
| 69e726a9a409200ea79efa80:17 | Japanese / lite | a woodcut and a murder scene; the source watches girls of 17–18 pass by |
| 69e4207471f02ebac6264a46:7 | Japanese / lite | "Afumiya" gossip; the source is Yonosuke's nightgown and the fulling block |
| 69e014d927a1381d255992b7:32 | Japanese / lite | the Genji Kiritsubo opening; the source is a waka anthology |
| 6991eadd2f801130a473ea3c:31 | French label (cat. Italian) / flash | four paragraphs of invented anatomy under a publisher's label |
| 69c7fdea6c6f3cc53c84359c:143 | German / flash | a different page (Antichrist, Hippolytus …); the source is 2 Thess 2 and false messiahs |
| 695201a9ab34727b1f041826:82 | Latin / flash | a short invented essay on soul and spirit over a page on the intellect and the Opifex |

**Transcription not of this leaf (6):**

| book:page | lang | what |
|---|---|---|
| 69dfede68d34461cbe7f4df4:71 | Japanese | OCR repetition loop (の三の三 ×1300) over a Genji Yūgao spread with apparatus |
| 6a08e2ce50bd891addfb51e6:23 | Japanese | the image's text (の食悦さすべし…) is page 22's transcription: shifted by one leaf, likely throughout the book |
| 69e8b14e2ff2a8dc09e75a36:340 | Italian | transcription duplicates page 339; image is p. 294 "anco della Luna" |
| 6a1aa51fc8638d1ea5c80d0f:142 | English | transcription duplicates page 141; image is p. 130 "will flee as if for her life" |
| 69b3f796a107e55a0ee1e1d6:110 | Hebrew | transcription is Deuteronomy 33–34 in full; image is a cursive commentary spread with אמר lemmata |
| 6a357f1ac6e2d5bb56a64539:204 | Hebrew | transcription header חזקת הבתים פרק שלישי; image header המוכר את הבית פרק רביעי |

Not contained: 53eba5b610 (Opus alone flagged a leaf mismatch; not settled at scan resolution).
