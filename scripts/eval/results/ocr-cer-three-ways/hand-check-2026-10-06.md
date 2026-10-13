# Hand-check of the error kinds, 2026-10-06 (#5939)

PRIOR ART: results/ocr-error-classes/appendix-2026-10-01.md (94 examples by eye, 16 the reference's fault).

**Draw.** `ocr-cer-three-ways.mjs` `hand_check_draw`, frozen in `hand-check-2026-10-06.json` (the draw is recomputed on every run, so the judged set is kept apart): up to 5 examples per reader-facing kind, one example per book, 45 books. Each was checked against the page scan (cropped from `images.sourcelibrary.org/archived/<book>/<page>.jpg` or the benchmark image). A second batch of 10 "misread" examples from the benchmark flash-lite pages behind the /quality table (seed 5939, one per page) was added because the first batch had no real misread.

**Verdicts.** engine = the engine is wrong; reference = the reference is wrong and the engine right; layout = the engine placed printed notes, margins or turn-overs where they are printed (the prompt asks for margins before their paragraph), so text that IS on the page is counted as added or missing; artefact = scoring or window artefact; convention = a difference the prompt asks for; undecidable = the print cannot be read.

## Batch 1: 45 examples, one per book

engine 20, layout 10, reference 8, artefact 4, convention 2, undecidable 1

| # | kind (classifier) | page | reference | engine | verdict | note |
|---|---|---|---|---|---|---|
| 0 | ſ read as f (long-s read as f) | `6955d3d828a09ca65927ed03-p273` | necessary | necefsary | **engine** | page prints neceſ-ſary |
| 1 | ſ read as f (long-s read as f) | `69905cfcaaa7f10ed4cfd289-p84` | sriendship, | friendship, | **reference** | page prints friendſhip with f; TCP keyed "sriendship" |
| 2 | ſ read as f (long-s read as f) | `6990618a322e01b1349a5136-p13` | sinne | finne | **engine** | ſinne |
| 3 | ſ read as f (long-s read as f) | `69906537726f64800c10a08c-p3` | Physick. | Phyfick. | **engine** | Phyſick |
| 4 | ſ read as f (long-s read as f) | `6991d67a8c1030b12444b537-p27` | Paradisical | Paradifical | **engine** | Paradiſical |
| 5 | misread letters and words (word split / joined) | `0425b5da-2769-41ae-93dd-76624ba8236a-p148` | Saturn | Sa- turn | **artefact** | italic Sa-/turn: markdown emphasis blocked the hyphen rejoin (fixed in the driver) |
| 6 | misread letters and words (other misread) | `69526046ab34727b1f04660c-p247` | spirits | text | **artefact** | reference window runs past the last line; engine word is the catchword |
| 7 | misread letters and words (word split / joined) | `6958e07cd34d35c8156624c8-p72` | Inoculate. | In- oculate | **artefact** | italic In-/oculate, as 5 (fixed) |
| 8 | misread letters and words (other misread) | `69905e152fd6a039938a0ebe-p11` | Cont | Contrary | **reference** | TCP gap "Cont…"; engine read Contrary |
| 9 | misread letters and words (garbled phrase) | `69906056ef12272ffdc8cdee-p4` | From Gresham Colledge | ROBERT HOOKE. | **layout** | signature block in a different order |
| 10 | refusals (refusal (empty output)) | `ed-69cfa93f80eb0ccd3e739280-p101` | will, by degrees, be all turn'd into a litharge; for that co |  | **engine** | refusal of a legible page (same-scan reference exists) |
| 11 | refusals (refusal (empty output)) | `ed-69de1c99d10d4b0d3f6f3175-p26` | and gouernement of the Ladies Chambers, and preparing all pl |  | **engine** | refusal |
| 12 | refusals (refusal (empty output)) | `ed-6ab5a4019e89e2a1f4139282-p94` | labour and charge is the cause why so many men fall and undo |  | **engine** | refusal |
| 13 | refusals (refusal (empty output)) | `ws-de-anette-von-droste-h-lshoff-des-arztes-verm-chtni-p3` | Des Arztes Vermächtniß. So mild die Landschaft und so kühn,  |  | **engine** | refusal |
| 14 | refusals (refusal (empty output)) | `ws-el-apollonii-rhodii-argonautica-1900-djvu-p17` | ΓΕΝΟΣ ΑΠΟΛΛΩΝΙΟΥ τοῦ ποιητοῦ τῶν Ἀργοναυτικῶν Ἀπολλώνιος ὁ τ |  | **engine** | refusal |
| 15 | invented or recited text (inserted run (≥6 words)) | `6991d6508c1030b12444acd8-p61` |  | Tho it seem a Paradox that giving is a richer Trade than len | **layout** | printed footnote at the foot of the page, not invention |
| 16 | invented or recited text (inserted run (≥6 words)) | `6991e194339ebc850994a230-p54` |  | I might here add many more particulars, | **layout** | margin note placed before its paragraph |
| 17 | invented or recited text (inserted run (≥6 words)) | `69ee46ef6dd925d126f40e22-p150` |  | The Spear called Hastata. Ausonius. Pausanias | **layout** | margin notes |
| 18 | invented or recited text (inserted run (≥6 words)) | `6a425634dfbbb4d07aa5382e-p24` |  | uox, tonitruque tremenInsonuere aurae, paulatim ascendere mo | **layout** | printed turn-over "(do" |
| 19 | invented or recited text (inserted run (≥6 words)) | `6a42d56d1894955eb725e97f-p13` |  | Praedicanti- In Contro. fol. 106. bus | **layout** | margin note |
| 20 | omissions (omitted word(s)) | `6991d66e8c1030b12444b4a3-p34` | Or Christ the Lord. |  | **layout** | margin note present, placed as the prompt asks |
| 21 | omissions (omitted word(s)) | `69aebe60c0472fef6455a8f2-p14` | ⅛ |  | **engine** | page prints ⅛; engine wrote LaTeX ½ (a misread, not an omission) |
| 22 | omissions (omitted word(s)) | `69bf60fd065df5d87d778bb3-p222` | of |  | **engine** | page prints "of / of"; engine silently dropped one (and wrote Highness for Highneſſes) |
| 23 | omissions (omitted word(s)) | `69de0cf180210ba13d79fa39-p118` | reign. |  | **layout** | printed turn-over "(Reign:" |
| 24 | omissions (omitted word(s)) | `69e748a685f786e884a4c8c5-p312` | wrought |  | **layout** | printed turn-over "(wrought" |
| 25 | silent modernisation (u/v i/j modernised by the engine) | `699061933d9181cce82fb5aa-p50` | vnexpected) | unexpected) | **engine** | vnexpected → unexpected |
| 26 | silent modernisation (spelling normalised) | `6990619a3d9181cce82fb669-p4` | Witches, | VVitches, | **reference** | page prints VVitches; TCP regularised to W (filed as engine modernisation) |
| 27 | silent modernisation (spelling normalised) | `6990619d3d9181cce82fb688-p11` | fyrst | first | **engine** | blackletter fyrſt → first |
| 28 | silent modernisation (spelling normalised) | `699fcd429ff0f1d2c4517fff-p17` | beste. | best | **engine** | beſte → beſt |
| 29 | silent modernisation (u/v i/j modernised by the engine) | `6a08fd6325e3a402b23b3e15-p52` | Ciuill, | Civill | **engine** | italic Ciuill → Civill, Floence → Florence |
| 30 | reference defects (u/v i/j regularised in the reference) | `6991d6648c1030b12444b0ec-p63` | Ianuary | January | **reference** | italic January printed; TCP Ianuary |
| 31 | reference defects (reference illegible-letter gap (engine right)) | `6a08fd2e25e3a402b23b3bca-p107` | by' a sword. | by'a fword. | **engine** | by'a fword: ſ read as f (filed as a reference gap) |
| 32 | reference defects (reference illegible-letter gap (engine right)) | `6a425310343d756d34e34ea7-p12` | laven ur, | laventur, | **reference** | TCP gap "laven ur" |
| 33 | reference defects (reference illegible-letter gap (engine right)) | `6a4376a3e296c55144956689-p8` | 8. SUccessorem | 9. S uccessorem | **reference** | page prints §.9; TCP 8 |
| 34 | reference defects (u/v i/j regularised in the reference) | `6a48d985df05f7ea342b77fb-p15` | iusto | justo | **reference** | page prints juſto; TCP iusto |
| 35 | u/v, i/j or capitals differ (case only) | `6a42aecb5207af7c42f5333c-p21` | SCripturae | Scripturae | **convention** | drop capital + small caps "SCripturae" |
| 36 | u/v, i/j or capitals differ (case only) | `6a42ec4006e6ead3ac544b8f-p12` | Usurpes | usurpes | **engine** | capital U printed; engine lower-cased |
| 37 | u/v, i/j or capitals differ (case only) | `6a4308144e06bc233ed03513-p22` | Newter? | newter? | **engine** | capital Newter printed; engine lower-cased |
| 38 | u/v, i/j or capitals differ (case only) | `6a4a4551c0f3ec200c7de18c-p25` | the | The | **artefact** | pairs a note with body text |
| 39 | u/v, i/j or capitals differ (u/v i/j convention) | `6a4f71ca1cba01ec54e763c3-p5` | alii | alij | **engine** | page prints alii; engine wrote alij |
| 40 | margins and page furniture (marginal note / note marker / furniture order) | `69e7833a0fc6fc955e36317c-p114` | points.Reape | points. 8 Reape | **layout** | margin note placed as the prompt asks |
| 41 | margins and page furniture (marginal note / note marker / furniture order) | `6a42eff906e6ead3ac54bab4-p18` | (qd.she) | (quoth she) | **convention** | "qd." expanded to "quoth" as the prompt asks; classifier missed the abbreviation |
| 42 | margins and page furniture (marginal note / note marker / furniture order) | `ed-697a6e5cb981745f5fac1d7e-p31` | Augustanar. 8. a princ. Sic | August. Vind. l. 2 | **undecidable** | citation too faint to read |
| 43 | margins and page furniture (marginal note / note marker / furniture order) | `ed-697a8014e680cef7cedae395-p31` | II II. | 1111. | **reference** | page prints 1111. (old-style figures); reference II II. |
| 44 | margins and page furniture (marginal note / note marker / furniture order) | `ed-69906319ef12272ffdc8f380-p107` | be recovered out of the | A World Discovered. 71 | **engine** | running head written into the body |

## Batch 2: 10 "misread" examples, benchmark flash-lite pages

engine 5, artefact 3, layout 1, reference 1

| # | kind (classifier) | page | reference | engine | verdict | note |
|---|---|---|---|---|---|---|
| 0 | other misread | `ws-la-galilei-discorsi-e-dimostrazioni-matematiche-int-p204` | ra | R | **artefact** | spaced small capitals R A |
| 1 | inserted word(s) | `ed-6a3d29e1af872ba37a51ab17-p22` |  | Cap.11. | **layout** | marginal Cap.11. |
| 2 | word split / joined | `ed-69906537726f64800c10a08c-p8` | reduction) but | reduction)but | **artefact** | space after a bracket only |
| 3 | other misread | `ws-de-agrumi-august-kopisch-1838-pdf-p3` | Töne | eine | **engine** | damaged print T·ne; engine guessed eine |
| 4 | other misread | `ws-la-cl-ver-germania-antiqua-1616-pdf-p23` | fabulatorum | fabulatorem | **engine** | fabulatorum → fabulatorem |
| 5 | other misread | `ws-de-95-thesen-pdf-p3` | verzweiuelung | verzweifelung | **engine** | verzweiuelung → verzweifelung (a modernisation) |
| 6 | garbled phrase | `ed-6a4f71ca1cba01ec54e763c3-p15` | nata ortum | natorum | **engine** | na-/ta ortum → natorum |
| 7 | other misread | `ed-6970e37d9b09d309d780a2c2-p61` | Graecians. | Grecians. | **reference** | page prints Grecians; TCP Graecians |
| 8 | other misread | `ed-6a42ec4006e6ead3ac544b8f-p14` | gestat | gettat | **engine** | ſt ligature: geſtat → gettat |
| 9 | word split / joined | `ws-la-easy-latin-stories-djvu-p16` | 12. Crocodili | 12.—Crocodili | **artefact** | dash joins two tokens |

## By kind (batch 1)

| kind | engine | reference | layout | artefact | convention | undecidable |
|---|---|---|---|---|---|---|
| ſ read as f | 4 | 1 | 0 | 0 | 0 | 0 |
| misread letters and words | 0 | 1 | 1 | 3 | 0 | 0 |
| refusals | 5 | 0 | 0 | 0 | 0 | 0 |
| invented or recited text | 0 | 0 | 5 | 0 | 0 | 0 |
| omissions | 2 | 0 | 3 | 0 | 0 | 0 |
| silent modernisation | 4 | 1 | 0 | 0 | 0 | 0 |
| reference defects | 1 | 4 | 0 | 0 | 0 | 0 |
| u/v, i/j or capitals differ | 3 | 0 | 0 | 1 | 1 | 0 |
| margins and page furniture | 1 | 1 | 1 | 0 | 1 | 1 |

## What it means for the breakdown

- **The reference was wrong in 9 of 55** (8 of the 45 one-per-book examples, 1 of the 10 extra misreads): TCP keying slips (sriendship, §8 for §9), TCP gaps the engine read through, and TCP regularising VV→W, I→J and Græ→Grae. The 2026-10-01 check found 16 of 94. A same-edition reference is not word-level ground truth.
- **Kinds that held up:** ſ read as f (4 of 5 engine errors; 1 the reference), refusals (5 of 5), silent modernisation (4 of 5; 1 the reference), reference defects (4 of 5 the reference; 1 an engine ſ→f).
- **Kinds that did not:** "invented or recited text" (0 of 5: all printed footnotes, margin notes or turn-overs the engine placed where they are printed), "omissions" (2 of 5 engine errors, 3 layout), "misread letters and words" (5 of 15 across both batches engine errors, 2 reference, 8 layout or artefacts). These three are reported together on /quality as "other differences", with this caveat.
- **Capitals** count: 2 of 2 checked capital differences were engine errors (the prompt says keep capitalisation), which is why case is not folded.
- Fixed after this check: markdown emphasis is now stripped before classifying, so an italic word broken at a line end is no longer a "split word" (items 5 and 7).
