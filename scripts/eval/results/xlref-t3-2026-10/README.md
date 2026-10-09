<!-- PRIOR ART: scripts/eval/results/xlref-harness-smoke-2026-10/ (the harness's own smoke run, 6 Pali pages) and scripts/eval/results/translation-paired-arm-2026-09-30/README.md (#5274: lite vs flash, reference-free judge). This is the #5695 T3 track: the same harness against published human English for German, French, Italian, Dutch and Spanish. -->
# xlref-t3 — served English vs published human translations: German, French, Italian, Dutch, Spanish (#5695 T3)

**Verdict.** On 59 vernacular printed pages with a public-domain human English translation of the same passage, the
English readers see now scores **4.39 / 5 for fidelity of meaning (95% CI 4.22–4.55); 92% of pages score ≥ 4**. The
errors that remain are mostly **translation errors on a correct transcription** (7 of the 10 lowest pages, by eye
against the scan), not OCR errors. **Flash instead of Lite is the one lever that beats the noise floor** (+0.21,
CI 0.07–0.36); thinking adds cost but no measured gain; removing neighbour-page context makes it worse.

`measure`: judged against a human reference (two blind Opus judges, harness `scripts/eval/translation-vs-reference/`,
PR #5702). Not accuracy: the judge's own error is bounded only by the controls.

## 1. Reference set

| | n | sources | reference licence |
|---|---:|---|---|
| German | 22 | Boehme (Ellistone 1651; Law's edition 1764), Andreae (Foxcroft 1690), *Fama* (Vaughan 1652), Basil Valentine (1671; Waite 1893), Sendivogius in German (Waite 1893, indirect), *Theologia Deutsch* (Winkworth 1854), Tauler (Elliott 1910), Glauber ×2 (Packe 1689), Kant ×2 (Mahaffy 1902, Bernard 1914), Herder (Churchill 1800), Goethe ×2 (Eastlake 1840, Carlyle 1824), Humboldt (Otté 1849), Lessing (Frothingham 1873), Hahnemann (Boericke 1922), Fichte (Smith 1848), Paracelsus (Waite 1894), Vaughan in German (his own English 1650, indirect) | public domain |
| French | 14 | Lévi (Waite 1896, 1913), Saint-Martin (Penny 1864), Guyon (Brooke 1775), Nostradamus (Garencières 1672), Pernety (1771), Volney (Jefferson/Barlow 1802), Lavoisier (Kerr 1790), Huygens (Thompson 1912), Fontenelle (Gunning 1803), Laplace (Truscott 1902), Fourier (Freeman 1878), Palissy (Morley 1852), Franklin–Bailly report on Mesmer (1785) | public domain |
| Italian | 10 | Galileo (Crew & de Salvio 1914; Salusbury 1663), Machiavelli (Thomson 1883; Whitehorne 1560), Castiglione (Opdycke 1901), Bruno (Williams 1887), Cellini (Ashbee 1898), Cennini (Herringham 1899), Palladio (Ware 1738), Leonardo (Rigaud 1802) | public domain |
| Dutch | 7 | Ruusbroec (Wynschenk Dom 1916), Swammerdam (Tyson 1681), Linschoten (Phillip 1598), Nieuhof and Montanus (Ogilby 1669–70), Leeuwenhoek (Hoole 1798), Acosta in Dutch (Grimston 1604, indirect) | public domain |
| Spanish | 6 | Acosta (Grimston 1604), John of the Cross (Lewis 1864), Monardes (Frampton 1596), Garcilaso de la Vega (Markham 1871), Bernal Díaz (Lockhart 1844), Cabeza de Vaca (Smith 1871) | public domain |

- **59 pages, 59 books**, one page per book. Sources: Project Gutenberg, Internet Archive, Wikisource, EEBO-derived
  texts, CCEL, sacred-texts. Every reference is public domain, so every row is `publishable: true`.
- **How pages were chosen.** Five page numbers per book were drawn with a fixed seed before anyone looked. The cutter
  took the first draw that was a text page the English covers (59/59 by draw, none by search). The cutters worked from
  the source OCR only and never saw our English.
- **Weighting.** Our live translated pages in these languages (2026-10-03): German 524,624, French 268,552, Italian
  143,791, Dutch 121,074, Spanish 20,988 (total 1,079,029). The sample is 37 / 24 / 17 / 12 / 10 %; the corpus is
  49 / 25 / 13 / 11 / 2 %.
- **Reference style.** early-modern 23, literal 20, free 16. Indirect (our book is itself a translation; the
  reference translates its original) 6. **Canonical / memorised texts: 0.**
- **Span.** Judges rated the cut `wider` on 92 judge-pages, `exact` 20, `narrower` 4, `offset` 2, `wrong` 0.
- Period: 16th c. or earlier 13, 17th c. 21, 18th c. 15, 19th c. 10. Script: roman 33, Fraktur 17, italic 4, gothic 3.

## 2. Served English vs the reference

Gate passed for both judges (wrong page 3/3 scored ≤ 2; planted change 3/3 caught and located; duplicates 3/3 tied).
Judge agreement: exact fidelity 84.8% of 374 cells, within one point 100%, weighted κ 0.81.

| stratum (n ≥ 10 only) | n | fidelity (95% CI) | pages ≥ 4 | omission | reversal |
|---|---:|---|---:|---:|---:|
| **all** | 59 | **4.39 (4.22–4.55)** | 92% (85–98) | 8.5% (2.5–15) | 0.8% (0–2.5) |
| German | 22 | 4.43 (4.14–4.71) | 95% | 11% | 0 |
| French | 14 | 4.54 (4.25–4.79) | 93% | 4% | 0 |
| Italian | 10 | 4.25 (4.00–4.55) | 90% | 20% | 5% |
| 16th c. or earlier | 13 | 4.39 (4.19–4.62) | 100% | 12% | 0 |
| 17th c. | 21 | 4.26 (3.98–4.55) | 81% | 10% | 2% |
| 18th c. | 15 | 4.53 (4.07–4.87) | 93% | 7% | 0 |
| 19th c. | 10 | 4.45 (4.15–4.75) | 100% | 5% | 0 |
| reference early-modern | 23 | 4.50 (4.26–4.72) | 96% | 9% | 0 |
| reference literal | 20 | 4.43 (4.20–4.63) | 90% | 10% | 2.5% |
| reference free | 16 | 4.19 (3.81–4.56) | 88% | 6% | 0 |
| served by Flash (older prompts) | 25 | 4.66 (4.46–4.84) | 96% | 2% | 0 |
| served by Lite | 34 | 4.19 (3.96–4.41) | 88% | 13% | 1.5% |
| Fraktur | 17 | 4.29 (3.91–4.62) | 94% | 12% | 0 |
| roman | 33 | 4.39 (4.18–4.59) | 88% | 5% | 1.5% |

Dutch (n = 7, 4.43) and Spanish (n = 6, 4.08) are below the reporting size. The served-model rows are observational
(different books), not a paired comparison; the paired one is §4.

What the judges typed as "invention" on the served pages (never one rate): next-page or previous-page text 19%,
filling an unreadable spot 5%, a fact in a note 45% (by design, prompt asks for notes), a bracketed gloss 32%.

## 3. Gallery (served arm; all references public domain, all `publishable: true`)

Full side-by-side quotes: `gallery-auto.md`. Cause column: from the page image for the worst five (`image-check.jsonl`).

| | page | fidelity | defect class | diagnosis |
|---|---|---:|---|---|
| best | Pernety, *Voyage aux Malouines* [p197](https://sourcelibrary.org/book/6909f75fcf28baa1b4cb0f71?page=197) (fr) | 5 | none | Every measurement and insect part carried; stops where the page stops. |
| best | Boehme, *Signatura rerum* [p194](https://sourcelibrary.org/book/6952603cab34727b1f04647b?page=194) (de) | 5 | none | Follows the German clause by clause; "torment of wrath" where Law has "source of anger" (a choice, §6). |
| best | Boehme, *Weg zu Christo* [p153](https://sourcelibrary.org/book/69528702ab34727b1f04cf65?page=153) (de) | 5 | none | Ishmael "cast out from his goods", as the source; two re-runs got it backwards. |
| best | Kant, *Kritik der Urtheilskraft* [p91](https://sourcelibrary.org/book/6954347b1479a63c11089b35?page=91) (de) | 5 | none | Argument and footnote complete. |
| best | Ruusbroec, *Cieraet* [p297](https://sourcelibrary.org/book/69790e9eeb0dcfd399123423?page=297) (nl) | 5 | none | Restores the split word "son-der middel" as "without mediation" with a note; two re-runs asserted the opposite. |
| median | Castiglione, *Cortegiano* [p161](https://sourcelibrary.org/book/69aebfa4c337b1e6a4d582f3?page=161) (it) | 4.5 | terminology | Keeps the pleonastic "non" right (nature has first place); minor term slips. |
| median | Herder, *Ideen* [p130](https://sourcelibrary.org/book/69afe1b02aed98f61157f6f6?page=130) (de) | 4.5 | terminology | Keeps "nicht"; the current Lite re-run drops it and inverts the condition. |
| median | Galileo, *Discorso … acqua* [p44](https://sourcelibrary.org/book/69b1da4879939cb4065ddf2e?page=44) (it) | 4.5 | T8 minor | "Can their resistance… stop" for "ne può… fermare" (nor can); the Lite re-runs also misread the page-initial fragment. |
| median | *Theologia Deutsch* [p54](https://sourcelibrary.org/book/69c814536c6f3cc53c848191?page=54) (de) | 4.5 | T9 | Drops one stray repeated clause. |
| median | Cabeza de Vaca [p30](https://sourcelibrary.org/book/69ea0f5913a685002bb8deaf?page=30) (es) | 4.5 | mistranslation, minor | Numbers and distances intact; "what they had given us" loses who gave. |
| worst | Lessing, *Laokoon* [p105](https://sourcelibrary.org/book/69ef3d8c72c1376fdf2b04e9?page=105) (de) | 2 | T9 quiet omission | **Translation**: the whole first paragraph is missing; the scan and OCR carry it in full. |
| worst | Juan de la Cruz, *Subida* [p223](https://sourcelibrary.org/book/69e7518010ee9075bcdcdaf0?page=223) (es) | 3 | T5 / boundary | **Page seam**: about 100 words of the next page appear on this one. |
| worst | Acosta, *Historia* [p444](https://sourcelibrary.org/book/695910f2ecb01322b3068302?page=444) (es) | 3 | T5, T10 | **Page seam + invention**: printed chapter is faithful; the handwritten margin runs on into the next page and ends with a signature and date this page does not carry. |
| worst | Galileo, *Due nuove scienze* [p173](https://sourcelibrary.org/book/69a6849d7ab725b59be41319?page=173) (it) | 3.5 | T8 sense inverted | **Translation**: "non veggo che si possa dubitare che… possa" calqued so it affirms what Sagredo denies. Every Gemini arm fails here; only Opus gets it. |
| worst | Huygens, *Traité de la lumière* [p123](https://sourcelibrary.org/book/6953e58d77f38f6761bf0cfc?page=123) (fr) | 3.5 | name / number | **Translation** (or an older OCR): point labels "K G, G L" became "X G, L"; the scan and current OCR are right. |

## 4. Arms on the same 59 pages (prompt v13, same input)

| arm | what | fidelity (CI) | ≥ 4 | omissions /100 pp | reversals /100 pp | $/page (list, realtime) |
|---|---|---|---:|---:|---:|---:|
| served | what readers see (25 Flash, 34 Lite; prompts v1–v13) | 4.39 (4.22–4.54) | 92% | 8.5 | 0.8 | — |
| L1 | Lite, production prompt and context | 4.36 (4.21–4.52) | 90% | 3.4 | 7.6 | 0.0015 |
| L2 | the same again (X1 noise floor) | 4.33 (4.18–4.48) | 88% | 2.5 | 8.5 | 0.0015 |
| F0 | Flash, thinking off | 4.58 (4.43–4.71) | 95% | 0 | 5.1 | 0.0032 |
| FT | Flash, thinking budget 8192 (2,504 thinking tokens/page billed) | 4.64 (4.52–4.76) | 98% | 2.5 | 1.7 | 0.0108 |
| NC | Lite, no neighbour-page context | 4.15 (3.98–4.32) | 80% | 8.5 | 8.5 | 0.0014 |
| O | Opus ceiling, 20 pages (X3; not a production candidate) | 4.98 (4.93–5.00) | 100% | 0 | 0 | subscription |

Paired differences (same pages, bootstrap CI):

| comparison | Δ fidelity | Δ omissions /100 | Δ reversals /100 | pages differing ≥ 1 point | reading |
|---|---|---|---|---:|---|
| **X1 floor: Lite again − Lite** | −0.03 (−0.15 to 0.09) | −0.8 (−4.2 to 1.7) | +0.8 (−5.1 to 6.8) | 7 | the floor: ±0.15 fidelity, ±7 reversals/100 |
| Flash − Lite | **+0.21 (0.07 to 0.36)** | −3.4 (−7.6 to 0) | −2.5 (−10.2 to 4.2) | 17 | **real on fidelity**; reversals inside the floor |
| X2: Flash thinking − Flash | +0.07 (−0.07 to 0.20) | +2.5 (0 to 6.8) | −3.4 (−8.5 to 0) | 9 | **inside the floor** |
| Flash thinking − Lite | +0.28 (0.12 to 0.46) | −0.8 | −5.9 (−13.6 to 0) | 17 | no more than Flash alone buys |
| no context − Lite | **−0.21 (−0.36 to −0.07)** | +5.1 (−0.8 to 11.9) | +0.8 | 17 | **real: context helps** |
| Lite v13 − served | −0.03 (−0.21 to 0.17) | −5.1 (−12.7 to 1.7) | +6.8 (1.7 to 13.6) | 18 | re-translating the backlog on Lite buys nothing |
| X3: Opus − Lite (20 pp) | +0.50 (0.23 to 0.83) | 0 | −7.5 (−20 to 0) | 6 | the headroom |
| X3: Opus − Flash (20 pp) | +0.43 (0.18 to 0.73) | 0 | −10 (−25 to 0) | 4 | |

- **Flash − Lite by language**: German +0.39 (0.18 to 0.59, n 22), Italian +0.35 (−0.05 to 0.75, n 10), French −0.18
  (−0.36 to −0.04, n 14). By period: before 1700 +0.25 (0.07 to 0.44, n 34), 1700 and later +0.16 (−0.06 to 0.38, n 25).
- **Reversals.** Lite re-runs have 9–10 judge-flagged reversals on 5–6 pages; Flash 6 on 3 pages; Flash with thinking 2
  on 1 page; served 1. They are dropped or pleonastic negations (Herder "nicht", Castiglione "non… non") and guessed
  page-initial fragments (Ruusbroec "son-/der middel", Galileo "[de]posizione"). The differences between arms are
  inside the A-vs-A floor (±7 per 100), so **no arm is shown to cut reversals**.
- **Thinking budget.** `thinkingBudget: 2048` on `gemini-3-flash-preview` bought **zero** thinking tokens on 59/59
  pages (`raw/FT2048.jsonl`); 8192 bought 2,504 per page. With thinking, text carried from a neighbouring page rose
  from 25% to 44% of pages.
- **Recitation.** One call (`FT2048`, Cabeza de Vaca p30) returned empty with `finishReason: RECITATION`.
- **Cost at corpus scale** (1,079,029 translated pages in these five languages; Batch is half of list): Lite $1,630
  list / $815 Batch; Flash $3,400 / $1,700; Flash with thinking $11,660 / $5,830.

API spend: $1.36 metered on envelope `xlref-t3` (cap $8).

## 5. What causes the low scores? Page images opened (addendum 3)

20 pages read against the scan (`display_photo`), line by line: the 10 where any judge gave served or the Lite re-run
≤ 3, and 10 random others.

| primary cause, served arm | 10 low pages | (Wilson 95%) | 10 random pages |
|---|---:|---|---:|
| translation, on a correct transcription | 7 | 40–89% | 3 |
| page seam (neighbour-page text) | 2 | 6–51% | 0 |
| OCR misread | 1 | 2–40% | 0 |
| reading order | 0 | 0–28% | 0 |
| wrong language label | 0 | 0–28% | 0 |
| no real defect | 0 | | 7 |

- Per defect on the low pages: served 22 translation, 5 OCR, 2 seam, 1 not a defect (n 30); Lite re-run 17
  translation, 9 OCR, 1 seam, 1 not a defect (n 28).
- 6 of the 20 pages have at least one meaning-changing OCR error. The one OCR-driven page is black-letter Dutch
  (Linschoten [p322](https://sourcelibrary.org/book/69a5d8d3a63a00aaae8aab0d?page=322)): the scan reads "seer **wijt**
  ghebout" (built very wide), OCR "wit", English "built so white"; scan "prieelkens van **meyen**" (boughs), OCR
  "riepen", English "hoops"; scan "sal**ē** eñ **s**aletten", OCR "faletten", English "galleries". The other OCR
  slips are long-s for f ("sarà"→"farà", "salso"→"falso") and "aufsetzen"→"aufsehen".
- **Corrected transcription, same arms, 6 pages** (`results-corrected-ocr.json`; judges saw the corrected source):
  Flash 3.92 → 4.83 (**+0.92**, 0.42 to 1.42; 5 of 6 pages better); Lite 3.83 → 4.00 (+0.17, −0.33 to 0.67). n = 6.

For these languages (printed, mostly roman and Fraktur) the transcription is **not** the first lever: the qualitative
reading on #5695 (Latin incunable, classical Chinese) does not carry over, except for black-letter Dutch.

## 6. More than accuracy (addendum B)

One Opus judge, blind A/B (ours vs the reference, order shuffled), after the fidelity scoring. Fidelity is copied.

| language | n | | fidelity | readability | register | terminology | ambiguity | transparency | stance |
|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| German | 22 | ours | 4.43 | 3.73 | 3.68 | 4.09 | 4.59 | 4.27 | literal 14, balanced 8 |
| | | reference | — | 4.32 | 4.82 | 3.95 | 4.18 | 2.59 | free 11, balanced 10, literal 1 |
| French | 14 | ours | 4.54 | 4.14 | 3.93 | 4.64 | 4.86 | 4.36 | literal 9, balanced 5 |
| | | reference | — | 4.57 | 4.86 | 3.79 | 4.07 | 2.71 | balanced 9, free 5 |
| Italian | 10 | ours | 4.25 | 3.50 | 3.50 | 3.90 | 4.50 | 4.40 | literal 7, balanced 3 |
| | | reference | — | 4.30 | 4.60 | 3.70 | 4.40 | 2.70 | free 5, balanced 3, literal 2 |
| Dutch | 7 | ours | 4.43 | 3.86 | 3.71 | 4.14 | 4.43 | 4.43 | literal 4, balanced 3 |
| | | reference | — | 3.57 | 4.57 | 3.43 | 4.00 | 2.29 | free 5, balanced 2 |
| Spanish | 6 | ours | 4.08 | 3.33 | 3.33 | 3.83 | 4.67 | 3.33 | literal 5, balanced 1 |
| | | reference | — | 4.17 | 4.67 | 3.50 | 4.17 | 2.33 | free 3, balanced 3 |
| **all** | 59 | ours | 4.39 | 3.76 | 3.68 | 4.17 | 4.63 | 4.24 | literal 39, balanced 20, free 0 |
| | | reference | — | 4.27 | 4.75 | 3.76 | 4.17 | 2.58 | free 29, balanced 27, literal 3 |

Ours is a crib: it keeps terms, ambiguity and flags its choices, and it loses on readability and voice. The human
translators read better and keep the genre, and they silently add, drop and resolve.

**Two pages for a principles discussion (different legitimate choices, not errors):**
1. Humboldt, *Kosmos* [p187](https://sourcelibrary.org/book/698fb77b6b95eeda7d2d1eaf?page=187): Otté silently converts
   the units for her reader ("37,000 feet (about seven miles)"); ours keeps the source figures ("(1 7/10 miles)",
   "25,400 feet"). Reader's convenience against the page's own numbers.
2. Boehme, *Signatura rerum* [p194](https://sourcelibrary.org/book/6952603cab34727b1f04647b?page=194): for "Zornquall"
   (Qual / Quelle) Law's edition takes the spring sense ("the source of anger was inflamed"), ours the pain sense
   ("the torment of wrath became burning"). Boehme means both; each translator closes one.

More candidates are in `dimension-verdicts.jsonl` (`different_legitimate_choice` on 59/59 pages), e.g. Cennini's
pigment names kept in Italian vs naturalised, Fontenelle's "Pugh! cried the Marchioness".

## 7. Threats

- **The reference is one reading, not the truth.** The dimension judge found at least one place where ours is right
  and the reference wrong on **42 of 59 pages**, and the reverse on 22. The fidelity judges score against the source,
  with the reference as a guide, so a loose reference does not by itself lower our score.
- **Recitation.** No canonical page in the set (0/59), so there is no memorised-text stratum to report. One
  `RECITATION` block occurred (Cabeza de Vaca).
- **Loose early-modern references.** By style: early-modern 4.50, literal 4.43, free 4.19 (CIs overlap).
- **Span misalignment.** No cut was judged `wrong`; most are `wider` by a sentence. Cut by a model, checked by two
  judges; the 20 image-checked pages were also read against the scan. No separate human leaf-check.
- **OCR vs translation.** Classified by eye on 20 pages (§5). On the other 39 the cause is the judges' reading of the
  text, not the image.
- **Generalisation.** References exist for known authors (Boehme, Kant, Galileo, Lavoisier). Sermons, almanacs,
  pamphlets, newspapers and manuscripts have none, and those are much of the corpus. German is under-sampled (37% vs
  49% of pages), Spanish over-sampled. Expect the true corpus mean below this one, by an unknown amount. The served
  arm mixes prompt eras v1–v13 and two models.
- **Judges.** Two Opus judges of one model family; Opus as the ceiling arm was judged by Opus (blind, but same family).

## 8. Decisions (not implemented)

1. **Translate new German pages (and, on weaker evidence, Italian, Dutch and Spanish) on Flash, thinking off,
   instead of Lite.** Measured: +0.21 fidelity (0.07–0.36) against a floor of ±0.15, omissions 3.4 → 0 per 100
   pages, pages ≥ 4 from 90% to 95%. German alone +0.39 (0.18–0.59); Italian, Dutch and Spanish lean the same way
   with intervals that include zero (n 6–10 each). French shows no gain (−0.18), so leave French on Lite. Cost $0.0016 → $0.0032 per page ($0.0008
   more on Batch). Do not re-translate the backlog on Lite: the current prompt on Lite scores the same as what is
   served (−0.03). **Default: yes for new pages; no backlog sweep.**
2. **Do not turn on thinking for translation.** +0.07 fidelity over Flash (inside the floor), reversals 5.1 → 1.7
   per 100 (inside the floor), neighbour-page text 25% → 44%, cost ×3.4 ($0.0108 per page; $5,830 on Batch for
   these languages). **Default: no.** Keep neighbour-page context (removing it costs 0.21).
3. **Re-read black-letter Dutch on Flash OCR before any re-translation; do not make re-OCR the first lever for roman
   and Fraktur print in these languages.** Measured: OCR is the primary cause on 1 of the 10 lowest pages (2–40%),
   and that page is black-letter Dutch; with a corrected transcription Flash gains 0.92 on 6 pages. **Default: pilot
   on the Dutch black-letter books only (n is small); no corpus-wide re-OCR for T3.**

## Files

| file | what |
|---|---|
| `records.jsonl` | 59 pages: source OCR, reference cut and metadata (translator, year, licence, style, URL), served English, OCR note, page-selection log |
| `pages.jsonl` | **one row per page × arm** (374 rows): scores by judge, defect classes, invention kinds, reference metadata, the three licences, `publishable`, six dimensions (served rows), image-check cause |
| `raw/<arm>.jsonl` | every arm's raw output with model, `thinkingConfig`, billed tokens, prompt hash (for `xlref-backtrans`) |
| `results.json`, `verdicts/`, `key.json`, `manifest.json` | harness output, raw judge verdicts, blinding key |
| `results-corrected-ocr.json`, `corrected-ocr.jsonl`, `verdicts-corrected-ocr/` | the corrected-transcription arms |
| `image-check.jsonl`, `image-check-sample.json` | by-eye cause per page, with the image reading quoted |
| `dimension-verdicts.jsonl`, `dimension-key.json` | addendum B verdicts (A/B blind) and the key |
| `summary.json` | every number in this file |
| `gallery-auto.md` | 5 / 5 / 5 with source, reference and ours side by side |

Scripts: `scripts/eval/xlref-t3/` (`show-source.mjs`, `check-records.mjs`, `gemini-arms.mjs`, `assemble.py`, `report.py`).
