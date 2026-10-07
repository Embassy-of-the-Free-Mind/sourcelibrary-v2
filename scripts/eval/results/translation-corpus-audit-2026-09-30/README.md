# How faithful are Source Library's translations? A random-sample audit (2026-09-30)

PRIOR ART: `report.md` (the generated tables) and `eye-notes.md` (the hand read) — this file is the narrative that reads them together; `scripts/eval/EXPERIMENTS.md` carries the one-entry log line. Issue #5274.

## The question

For a page a reader opens at random on sourcelibrary.org, how faithful is the English translation to the page's source text, and does that differ by language, by the model that translated it, and by the period of the book?

Nobody had measured this. Earlier work measured slices: the notes only (#3308), one Greek lexicon (#3884), 78 books read by eye without rates (the page-error taxonomy), a lite-vs-flash preference study on non-Latin scripts (#4759), and mechanical detectors for truncation and page-boundary drift. Human feedback is too thin to use as a rate: about 28 quality complaints and 6 agent-reported defects in six and a half months, no book with more than two reports.

## The answer

**About seven pages in eight read faithfully; one in seven carries a major defect.** Post-stratified over the 4.3 million live translated pages in the 15 sampled languages. The first column corrects for the draw's model-arm quota (see "Is this a proper random sample?"); the second is the plain language-weighted figure the tables below use, with its bootstrap interval.

| Statistic | Arm-corrected | Language-weighted (95% CI) |
|---|---:|---:|
| Fidelity 5 (a reader of the source would find the same meaning throughout) | 40.8% | 41.4% (35.1–47.6) |
| Fidelity ≥ 4 (at most minor slips) | 87.2% | 89.1% (85.3–92.5) |
| Fidelity ≤ 2 (substantial parts wrong or missing) | 3.8% | 3.4% (1.5–5.7) |
| At least one major defect | 14.4% | 11.4% (7.7–15.5) |
| Omission (a sentence, clause, name or number dropped) | 19.3% | 14.8% (10.1–19.5) |
| Invention (content with no counterpart in the source) | 9.2% | 11.2% (7.5–15.3) |
| Garbled source rendered as confident prose | 6.8% | 6.6% (3.9–9.5) |
| Sense inverted | — | 3.9% (1.4–6.9) |
| Untranslated / wrong language / truncated / repetition loop | 0% | 0% |

The arm correction moves omission and major defects up because lite, which omits more, is the majority arm in most languages, and the draw had sampled the arms 50/50. Weighting by pages instead of books (a random page rather than a random book) changes almost nothing: 89.3% at ≥ 4, 35.3% at 5.

The last row needs a footnote: the draw samples interior pages, and the 66,525 truncated translations found by the page-integrity scan (#5055) sit at page ends. That count stands; this audit did not sample the defect it measures.

## By language

| Language | Books | Mean | % ≥ 4 | % ≤ 2 | % omission | % invention | % any major |
|---|---:|---:|---:|---:|---:|---:|---:|
| German | 36 | 4.56 | 97 | 0 | 11 | 8 | 6 |
| French | 24 | 4.54 | 96 | 0 | 0 | 8 | 4 |
| Latin | 60 | 4.25 | 93 | 2 | 17 | 7 | 10 |
| English (modernisation) | 36 | 4.33 | 92 | 6 | 14 | 19 | 8 |
| Spanish | 6 | 4.33 | 100 | 0 | 0 | 0 | 0 |
| Italian | 18 | 4.44 | 89 | 0 | 6 | 11 | 11 |
| Dutch | 18 | 4.44 | 83 | 0 | 6 | 11 | 17 |
| Hebrew | 12 | 4.25 | 83 | 17 | 25 | 8 | 17 |
| Chinese | 18 | 3.94 | 78 | 11 | 6 | 22 | 17 |
| Greek | 36 | 3.89 | 75 | 11 | 22 | 19 | 22 |
| Arabic | 12 | 4.25 | 75 | 0 | 17 | 0 | 0 |
| Japanese | 6 | 3.83 | 67 | 17 | 0 | 17 | 33 |
| Tibetan | 11 | 3.91 | 64 | 0 | 27 | 0 | 27 |
| Sanskrit | 12 | 3.50 | 50 | 8 | 58 | 17 | 42 |
| Korean | 6 | 3.50 | 50 | 0 | 0 | 17 | 33 |

Grades follow the dashboard thresholds: under 30 books is exploratory, 30 or more directional, 50 or more decision-grade. Latin is decision-grade; English, German and Greek are directional; everything else is exploratory and the small cells (Korean, Spanish, Japanese at 6 books) should be read as a first look only.

Latin-script languages together: 198 books, 92.9% at ≥ 4, 8.6% with a major defect. Non-Latin scripts together: 113 books, 70.8% at ≥ 4, 22.1% with a major defect. Greek is the largest gap by pages at stake (432K live translated pages).

Sanskrit's omission rate has one cause: the editions we hold are Sanskrit text with English philological commentary beneath it, and the translation condenses that commentary into a note, dropping variant readings, cross-references and metre lines. That is a prompt behaviour, not a language problem.

## By translation model

| Arm | Books | Mean | % ≥ 4 | % omission | % invention | % any major |
|---|---:|---:|---:|---:|---:|---:|
| gemini-3.1-flash-lite (lite) | 154 | 4.15 | 82.5 | 20.1 | 8.4 | 18.2 |
| gemini-3-flash-preview (flash) | 157 | 4.29 | 87.3 | 8.9 | 14.6 | 8.9 |

Lite omits more; flash invents more. **This is not a model comparison.** The two arms translated different pages, the model follows the book, and the arms are also different prompt eras (lite carries prompt labels "11" and "v10", flash mostly "v2"). The second judge saw the same split (lite 77% at ≥ 4, flash 89%). Separating model from prompt from book needs a paired re-translation of the same 311 pages, which would cost about a dollar in realtime and less in batch.

## By period

Fidelity is highest for 1500s–1700s print (92% and 91% at ≥ 4) and lowest for pre-1500 material (75%, omission 29%) and 1800s books (79%, where invention peaks at 21%). Period is the catalogue's date, not the leaf's, and 36 books had no parseable date.

## What kind of defects

Of 336 defects the primary judge listed on the 311 pages: 153 minor mistranslations, 44 minor omissions, 36 terminology slips, 33 minor inventions, 32 garble pass-throughs (15 major), 15 major inventions, 12 name errors, 10 inversions (3 major), 8 number errors (2 major), 6 major omissions.

The two major classes share a shape. When the OCR is broken, the translator does not say so; it writes fluent, confidently annotated prose the page cannot support. And when a page ends mid-thought, the translator sometimes completes it with text from the next page or from nowhere. Both are failures of restraint rather than of language ability, and both are exactly what the 2026-09-28 agent feedback report and the human "hardly any text but a lot of translation, hallucinated?" complaint describe.

## How much to trust the judge

The judge is Claude Opus, reading the OCR source beside the translation, with no human reference. It is a different model family from the translator on purpose: on the Suda benchmark a Gemini judge of Gemini translations scored κ 0.107 against gold. The rating is a judge rating, never accuracy.

Before reading any result, the blinded controls were read:

- 15 pages whose translation was swapped for another page's: all 15 rated ≤ 2 and flagged wrong page.
- 15 pages with the middle third of the translation removed: all 15 flagged omission.
- 15 pages presented twice under different ids: 11 identical scores, 15 within one point, 13 identical flags. The judge's noise is one point on about a quarter of pages and never more.

A second judge (Claude Sonnet) rated 107 of the pages: 67% exact agreement, 100% within one point, no disagreement of two or more, and its controls also 5/5 and 5/5.

Twenty pages across all 15 languages were then read by a person against the page image (`eye-notes.md`). Of 21 judge-flagged defects, 20 were confirmed and 1 could not be settled at scan resolution; none was rejected. On the nine pages rated 5, no major defect had been missed.

## What the judge cannot see

Two of those 20 pages, both Internet Archive scans (Oxyrhynchus Papyri V and the 1605 Don Quixote), carry a transcription of a different leaf from the image shown. The translation is faithful to its transcription, so a text-only judge scores it well, while the reader sees a translation that does not match the page in front of them. **Corrected 2026-09-30 by the follow-up leaf check over all 311 pages (#5311):** 6 of 298 pages (2.0%) are mismatched, all Internet Archive (3.8% of IA pages), and on every one the image is the correct leaf — it is the Gemini OCR text that was read from a neighbouring leaf, not the image that is off. The first version of this paragraph had that the wrong way round. Detector: #5309. Every fidelity number above is conditional on the transcription being of the page shown.

Two more of the 20 pages had a catalogue language that was not the page's language (an "Arabic" book whose page is German; a "Korean" book whose page is Classical Chinese). The language table above is by catalogue language.

## Is this a proper random sample?

Mostly. What is random: every live book in each language was put in a seeded shuffle and visited in that order, so each book had an equal chance; within a book one interior text page was drawn uniformly; nothing used Mongo's unseeded sampler; the controls were blinded into the same packets.

What is not, and what was done about it:

- **The model arm was quota-sampled.** Within each language, books were accepted until each arm (lite, flash) held half the quota, so a language that is 73% flash in reality is 50/50 in the sample. Uncorrected, that over-weights each language's minority arm. The arm-corrected column above re-weights each language's cells to the arm's true share of live translated pages (`arm-shares.json`, from a 140,000-page sample of the `pages` collection joined to `books`). The per-language table is uncorrected; arm-corrected per-language rates are in `report.json` under `sensitivity` (Latin 88.6% at ≥ 4, Dutch 91.1%, Korean 42.4%; the rest within two points of the table).
- **One page per book is book-weighted.** A reader opening a random page lands in long books more often. Weighting each sampled book by its translated page count gives the page-weighted column: 89.3% at ≥ 4, 11.9% major. The unit stays the book because two pages of one book are one observation for any rate.
- **Scope, stated:** text pages only (non-text page types excluded), with at least 200 characters of OCR and 100 of translation, machine-translated, not human-edited, interior (first 15% and last 5% of each book skipped). Short and edge pages are where truncations live, which is why that rate reads zero here. Fifteen languages cover about 86% of live translated pages; the rest are unrepresented. Language and period are the catalogue's, not the page's; two of the 20 hand-read pages were in a different language than catalogued. Books flagged hidden were excluded even where visible was unset.
- **Tibetan filled 11 of 12** (the visit cap was reached); every other language filled its quota.

## What was done, exactly

- Draw: `draw.mjs --seed 20260930`. One interior page (first 15% and last 5% of the book skipped) per book from live books, 15 languages with fixed quotas, a per-language quota on translation model, 311 pages from 311 books. Pages were excluded when the page type was not text, the OCR was under 200 characters, the translation under 100, the translation was not machine output, or a human had edited it.
- Judging: `JUDGE-PROMPT.md`, 24 blinded packets of 15 items, one Opus agent per packet; 8 packets re-judged by Sonnet. Controls were mixed into the packets under random ids.
- Scoring: `score.mjs`, post-stratified by live translated pages per language, bootstrap CI over pages-as-books.
- Cost: no API spend; subscription agents only. No page was re-translated.
- Landing: store rows in `scripts/eval/store/scores/translation-corpus-audit-judge@1/2026-09.jsonl` (476 rows, measure `judged`), `EXPERIMENTS.md` entry, `DECISIONS.md` rows, issue #5274.

## What this suggests doing

Neither is a routing change, and both are Derek's call (DECISIONS.md, "Translation").

1. A garble gate: when the OCR lane has already marked a page unreadable, withhold or visibly flag the translation instead of serving confident prose over it. That is 6.6% of pages and most of the major defects.
2. An apparatus-preserving instruction for editions with philological commentary, so that variant readings and cross-references are translated rather than summarised.

And one measurement: a paired lite-vs-flash re-translation of these 311 pages, judged the same way, to turn the arm split into a model result.
