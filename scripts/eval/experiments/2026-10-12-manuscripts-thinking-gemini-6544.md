---
stage: ocr
measure: accuracy
languages: [en, la, fr, ar, zh, syr, he, grc, nl, de, fa, ms]
scripts: [Latn, Arab, Hani, Syrc, Hebr, Grek]
canons: []
n_books: 93
n_pages: 116
verdict: "On 76 expert-transcribed manuscript pages (Set A), every reader that thinks beats production Flash-Lite, by 4.7 to 6.8 points of mean page CER: 3.1 Pro −4.7 [−6.9, −2.6], 3.8 Flash low −4.7, 3.8 Flash high −5.4, and Opus −6.8 [−9.6, −4.0]. Thinking level does not matter (3.8 high − low −1.8 [−4.1, +0.1]). Opus is the best single reader on Set A (−3.3 [−5.9, −0.9] against Pro), but on our own manuscripts (Set B, 40 pages, model-keyed, DIRECTIONAL) its ranking against Pro flips with the key, and it writes `[?]` across Syriac and Turfan fragments. Pro beats Flash-Lite under all three Set B keys (−21.5 to −33.5 points). No two-model strategy beat the best single reader on Set A: Opus correcting Pro lands where Opus alone does (−1.0 [−2.6, +0.2]), and Pro correcting Opus changes nothing (+0.2). Anchoring is low: about 7% of planted draft errors survive either corrector."
status: informational
decision: "Route manuscript and handwritten pages off Flash-Lite to Gemini 3.1 Pro through the CLI (moderate confidence). It fails least (3/76 restarted, against 9/76 refusals and cuts for 3.8 low) and is the only reader that wins under all three Set B keys. Do not route to 3.8 Flash: no gain over Pro on Set A, more refusals, and thinking level adds nothing. Not yet a two-model pipeline: an Opus correction pass helps only on noisy Pro drafts (−11.6 points on the noisiest tertile, −0.1 on the clean one), so route the pass by draft noise if it is built at all."
superseded_by: null
issue: [6544, 6547, 6523, 6388]
---
PRIOR ART: #6547 (`scripts/eval/replicate-6547/`: the sealed `claude -p` runner, the word-level disagreement spans, the anchoring planter and the Bentham prep are imported, not copied), #6523c's CLI runner (`run-cli-arm.py` + `agy-tool-gate.py`, branch `job-cli-ocr-fix-6523c` @ 0c5449729, run from a copy under `$JOB_SCRATCH`, not changed), #6388 Amendment 2 (model-adjudicated keys, the family rule, planted-span controls), `benchmark-run-api.mjs --prompt=production` (the Flash-Lite arm). Literature: Greif et al. 2025 (arXiv 2504.00414, image + noisy OCR → <1% CER), Humphries, "When models disagree" (Generative History), Humphries et al. 2024 (arXiv 2411.03340, Claude correcting Transkribus), Yang 2026 (arXiv 2607.01240, count anchoring), Tan et al. ACL 2026 (arXiv 2605.13368, refinement projects toward the refiner), ICDAR 2026 HIPE-OCRepair (arXiv 2607.08143, harm on clean input), Diagnose-then-Repair (arXiv 2609.22793, one pass only), arXiv 2505.12201 (multilingual judge κ ≈ 0.3).

## 2026-10-12 · Does a thinking Gemini read manuscripts better than Flash-Lite, and does a second model help?

**Decision this changes.** Whether manuscript and handwritten pages route to a thinking model through the CLI instead of Flash-Lite, which model, and whether a two-model strategy beats any single reader.

**Gate (#6553).** This job ran after replicate-6547. Greif *replicated* through the CLI route (CLI − API +0.02 points). Humphries' single reader was *not testable* (no public data), not "not replicated", so nothing had to be fixed first. Anchoring in #6547 was 0–6%, so it is reported in its normal place, not first.

### Sets

**Set A: 78 drawn, 76 scored, expert page-level references, open licences** (`results/mss-thinking-6544/setA-pages.json`, `setA-manifest.json`). Seed 6544, at most 2 pages per manuscript, test or validation splits; well-known texts left out to limit memorisation.

| stratum | dataset | licence | pages / works |
|---|---|---|---|
| 18th–19th c. English | Bentham R0, validation split (zenodo 44519) | CC BY 4.0 | 20 / 20 |
| medieval Latin | CREMMA Medii Aevi (HTR-United, zenodo 7013436) | CC BY 4.0 | 20 / 11 (18 scored) |
| early modern hand | HTRomance, French manuscripts of the 16th–17th c. (BnF) | CC BY 4.0 | 20 / 13 |
| non-Latin script | RASAM 1+2, Maghrebi Arabic (BULAC) | GT Apache-2.0; images public domain | 18 / 9 |

- **No German Kurrent.** No open set gave 20 pages under the two-per-work rule with a clean diplomatic reference. The early-modern stratum is French instead.
- **Two CREMMA pages are excluded** (H318 10r, 13v). Each image is a two-page spread whose reference transcribes one page.
- **References are line-level, reassembled in reading order:** XML order, sorted top to bottom for Bentham, and three HTRomance pages repaired by hand.
- **CREMMA keeps abbreviations as written.** 14.6% of its characters are abbreviation marks. CER therefore folds case, diacritics, combining marks and MUFI letters, and counts letters only. Even so, a reader that expands abbreviations is charged for it (Pro and Flash-Lite do; Opus mostly does not).

**Set B: our manuscripts, 40 pages, one per book, hidden books included** (`setB-draw.json`; `draw-setb.mjs`). Drawn from `book_class.class: handwritten`, stratified: Latin 14 (4 of them BPH), CJK 8, Arabic 6, Syriac 5, Hebrew 4, Greek 3. 26 are visible, 14 hidden.
- Five picks are Berlin Turfan fragments (Sogdian or Manichaean script) whose `script_family` is wrong. Two of them are photographed upside down.
- They were kept as drawn. No reader could read them, so they weigh on the Syriac and Hebrew rows.

**Set B keys (rotated, #6388 Amendment 2 + Derek 2026-10-11).**
- The words the independent Pro and Opus reads agree on stand.
- Each disputed span goes to two referees with the image: **KEY-O** (Opus, `claude -p`) and **KEY-G** (3.1 Pro, `agy -p`). They see candidates A/B in seeded random order, with no model names. Each span is answered A, B, NONE (+ text) or ILLEGIBLE.
- Where KEY-O and KEY-G differ, **Fable** (`claude-fable-5-1`) settles the span, giving the consensus key **KEY-F**.
- There were 611 disputed spans, plus 27 planted controls on 14 pages.
- Every arm is scored against all three keys.

**These keys are built from the Pro and Opus reads.** Where Pro and Opus agree on a wrong reading, the key is wrong, and every other arm is charged for being right. So Set B structurally favours Pro and Opus over the Flash arms and Flash-Lite. Set B is DIRECTIONAL.

### Arms and route
- **Flash-Lite as production runs it:** the production OCR prompt v19.1 (`9d8f959e…`), `gemini-3.1-flash-lite`, temperature 0.1, thinkingBudget 0.
  - Set B uses the stored read where it is a Flash-Lite read (13 pages). The other 105 pages went through the paid API: **$0.44 total** (Set A $0.30, Set B $0.15).
  - Production metadata tags are stripped before scoring. Page-text blocks (header, margin, folio) are kept.
- **Gemini 3.1 Pro high, 3.8 Flash high, 3.8 Flash low:** `agy -p` on the subscription, run with #6523c's runner (sentinels + tool gate, plan mode, no auto-approve).
  - The CLI sets neither temperature nor media resolution. #6547 measured that route difference on print as nothing (+0.02 points).
  - Every Gemini read logged its tool calls, and all opened the image (`view_file` on every read).
- **Opus:** `claude -p --restricted`, Read only, in a sealed one-image folder.
- **All non-production readers get one diplomatic prompt.** It asks them to keep spelling, abbreviations and line breaks, and to write `[?]` for an unreadable word.
- **Correction, both directions, one pass:**
  - Pro is given the image and Opus's read;
  - Opus is given the image and Pro's read.

  Both get the same prompt: "a draft to check against the image: correct it wherever the image differs. The draft may contain errors." No count of errors is given, and the controls are never mentioned.
- **Disagreement:** Pro is the primary and Opus the second reader. The spans where they disagree go, marked, to 3.8 Flash high with the image. Undisputed pages keep Pro's text.
- **Anchoring control:** 10 Set-A pages. Each draft gets 2 planted word or number errors plus 1 dropped short line, none of them on the page. Only 1 page had a number to change, so the number plants mostly fell back to word plants. These pages are scored separately.
- **Failed reads are counted, not scored (#6523).** That covers refusal, filter cut, empty, timeout, restart or duplicate, CLI error string and leaked reasoning. Two kinds were added on the way:
  - a reply containing a second `<<<BEGIN>>>` (the page written twice);
  - a reply whose only text between the markers is a stray word ("and"), because the reasoning quoted the markers.

  A column "failed = 1.0" shows the same arm with every failed read counted as fully wrong. That matters for production, where a refusal is a page with no text.

### Set A results (expert references)

| arm | read / given | did not read | mean page CER [95% CI by work] | failed = 1.0 | pooled CER | s/page | Bentham | CREMMA | HTRomance | RASAM |
|---|---|---|---|---|---|---|---|---|---|---|
| Flash-Lite (production) | 72 / 76 | 4 loops ("et ipsum uero…") | 16.1 [12.1, 20.3] | 20.5 | 21.7 | 7 | 3.8 | 34.5 | 8.4 | 24.0 |
| 3.8 Flash low (CLI) | 67 / 76 | refusal 6, filter cut 2, restarted 1 | 13.9 [9.2, 19.7] | 24.1 | 21.1 | 41 | 4.5 | 31.9 | 6.3 | 15.5 |
| 3.8 Flash high (CLI) | 69 / 76 | filter cut 3, refusal 2, timeout 1, CLI error 1 | 12.6 [9.0, 16.8] | 20.6 | 19.5 | 183 | 4.3 | 26.0 | 6.3 | 16.3 |
| 3.1 Pro (CLI) | 73 / 76 | restarted 3 | 14.0 [9.6, 19.2] | 17.4 | 22.3 | 151 | 3.3 | 29.5 | 6.5 | 17.1 |
| Opus (claude -p) | 75 / 76 | restarted 1 | **9.9 [7.2, 12.9]** | **11.1** | 14.5 | 23 | 4.1 | 18.9 | 4.9 | 13.4 |
| Pro corrects Opus (*partly measured*: 62 of 76 run) | 61 / 62 | restarted 1 | 9.5 [6.6, 13.0] | 11.0 | 15.1 | 124 | 3.8 | 19.3 | 5.6 | 14.3 (5) |
| Opus corrects Pro | 76 / 76 | 0 | 9.6 [6.9, 12.9] | 9.6 | 15.3 | 25 | 3.8 | 19.9 | 5.7 | 10.1 |
| Disagreement (*partly measured*: 29 of 76 run) | 23 / 29 | primary or second unread 4, restarted 2 | 5.5 [2.9, 8.2] | 25.1 | 7.7 | 128 | 3.4 | 11.5 (6) | — | — |

Paired mean page CER differences, in points, on pages both arms read (negative means the first arm is better):

| pair | diff [95% CI by work] | n |
|---|---|---|
| Pro − Flash-Lite | −4.7 [−6.9, −2.6] | 69 |
| 3.8 high − Flash-Lite | −5.4 [−7.5, −3.5] | 65 |
| 3.8 low − Flash-Lite | −4.7 [−6.9, −2.5] | 64 |
| Opus − Flash-Lite | −6.8 [−9.6, −4.0] | 71 |
| 3.8 high − 3.8 low | −1.8 [−4.1, +0.1] | 62 |
| Pro − 3.8 high | +1.4 [−0.1, +3.2] | 66 |
| Opus − Pro | −3.3 [−5.9, −0.9] | 72 |
| Opus corrects Pro − Pro | −4.3 [−6.6, −2.5] | 73 |
| Opus corrects Pro − Opus | −1.0 [−2.6, +0.2] | 75 |
| Pro corrects Opus − Opus | +0.2 [−0.5, +0.9] | 61 |
| Disagreement − Pro | −1.3 [−3.1, +0.0] | 23 |
| Disagreement − Opus | −0.6 [−1.5, +0.0] | 23 |

- **Bentham (English) does not separate the readers:** all land at 3–4.5. The gains come from medieval Latin, early modern French and Maghrebi Arabic.
- **Pro's pooled WER (61%) is inflated by abbreviation expansion on CREMMA.** On one Mazarine page Pro wrote 8,136 letters against the reference's 5,371. Mean page CER is the headline measure for that reason.

**Correction, by draft noise (Set A, pooled CER of the draft → corrected, 95% CI by work).** These numbers measure accuracy (folded letters). The "style part" (strict − folded: case, punctuation, diacritics, abbreviation marks) is reported beside them.

| corrector | tertile | pages | draft CER range | draft → corrected | change |
|---|---|---|---|---|---|
| Opus corrects Pro | clean | 24 | 0.0–4.4 | 1.5 → 1.4 | −0.1 [−0.2, −0.1] |
| | middle | 24 | 5.2–14.2 | 9.1 → 7.3 | −1.8 [−2.5, −1.0] |
| | noisy | 25 | 14.6–77.9 | 36.6 → 24.9 | **−11.6 [−16.4, −7.6]** |
| Pro corrects Opus | clean | 20 | 0.0–2.7 | 1.0 → 1.1 | +0.1 [−0.1, +0.4] |
| | middle | 20 | 2.8–10.4 | 5.9 → 6.2 | +0.3 [−0.4, +1.2] |
| | noisy | 21 | 11.3–56.0 | 22.1 → 23.3 | +1.2 [−1.3, +4.1] |

- **Opus correcting Pro:**
  - 50 pages better, 4 worse.
  - Its style part falls from 13.5 to 9.7: it also restores the diplomatic conventions Pro expands.
- **Pro correcting Opus:**
  - 14 pages better, 31 worse.
  - Its style part rises from 9.3 to 10.1.
  - The edits are mostly small and toward Pro's own conventions: the "projection toward the refiner" Tan et al. describe, not targeted repair.
- **No harm on clean drafts for Opus.** The gain is where the draft is noisy. Route a correction pass to noisy drafts only.

**Anchoring (10 Set-A pages, scored separately).**
- **Rates:**
  - Pro correcting: 2 of 26 planted errors survived (7.7%).
  - Opus correcting: 2 of 28 (7.1%).
- **Dropped lines:**
  - Pro restored 8 of 8.
  - Opus restored 8 of 10. One of the two it did not restore is a library stamp line (`UNIV. COLL. LOND.`).
- **Invalid plants:** 3 plants changed nothing, because the planter's word core misses an apostrophe or a combining mark. They are marked invalid and not counted.
- **Plant sites the verdict could not read:** 6 plants came back "other" (the site holds a third word) and 1 "site not found". 6 of these 7 are on CREMMA pages, where the readers' abbreviation forms move the site's context.
- **Anchoring is low.** It does not explain why Pro gains nothing from correcting.

**Disagreement.**
- **Partly measured:** the resolver ran on only 29 of 76 Set-A pages before the quota ran out.
- **Disputed share** (Pro's characters inside a Pro/Opus disagreement span):
  - Bentham 3.1%, close to Humphries' 4% on English;
  - HTRomance 16.7%, RASAM 37.2%, CREMMA 76.0%.
- **It does not transfer as a cheap detector.** Beyond English, most of the text is disputed, largely over abbreviation and diacritic conventions.
- **Accuracy:** on the pages it reached, the resolver is level with or slightly better than both readers (−1.3 and −0.6 points). The intervals touch 0.

### Set B results (our manuscripts; model-keyed, DIRECTIONAL)

| arm | read / given | did not read | KEY-O (Opus referee) | KEY-G (Pro referee) | KEY-F (Fable settles) | s/page |
|---|---|---|---|---|---|---|
| Flash-Lite (production) | 35 / 40 | duplicated/loop 4, restarted 1 | 42.3 [30.7, 54.3] | 48.3 [36.4, 60.5] | 43.9 [32.5, 55.7] | 9 |
| 3.8 Flash low | 35 / 40 | refusal 5 | 33.8 [22.7, 46.6] | 40.1 [27.8, 53.8] | 34.5 [23.3, 46.9] | 62 |
| 3.8 Flash high | 36 / 40 | refusal 4 | 33.0 [21.8, 45.3] | 38.5 [26.6, 52.0] | 34.3 [23.1, 46.7] | 178 |
| 3.1 Pro | 40 / 40 | 0 | 20.6 [11.6, 30.6] | 13.8 [5.8, 23.2] | 13.9 [7.0, 22.3] | 162 |
| Opus | 39 / 40 | duplicated 1 | 22.2 [11.9, 34.2] | 37.3 [24.9, 50.3] | 27.7 [16.1, 40.2] | 25 |
| Opus corrects Pro | 40 / 40 | 0 | 23.5 [13.5, 34.0] | 25.6 [14.5, 38.1] | 21.4 [12.3, 31.8] | 24 |
| Pro corrects Opus | **not run** (quota) | | | | | |
| Disagreement (*partly measured*: 30 of 40) | 26 / 30 | refusal 1, restarted 2, unread 1 | 11.1 [4.0, 20.8] | 13.2 [4.3, 24.5] | 5.5 [2.3, 10.6] | 141 |

Mean page CER, 95% CI resampled by book. Paired differences, in points:

| pair | KEY-O | KEY-G | KEY-F | holds under all three? |
|---|---|---|---|---|
| Pro − Flash-Lite | −21.5 [−32.1, −12.0] | −33.5 [−45.0, −22.2] | −30.9 [−42.9, −19.4] | **yes** |
| 3.8 high − Flash-Lite | −10.2 [−18.1, −3.6] | −12.0 [−19.2, −5.5] | −11.2 [−18.7, −4.3] | yes |
| 3.8 low − Flash-Lite | −12.1 [−20.1, −5.7] | −13.4 [−21.0, −7.0] | −13.8 [−21.3, −7.5] | yes |
| Opus − Flash-Lite | −22.3 [−32.5, −13.5] | −13.2 [−21.1, −6.5] | −17.2 [−26.7, −9.2] | yes |
| 3.8 high − 3.8 low | +1.5 [−0.3, +3.8] | +0.8 [−1.1, +3.0] | +2.3 [+0.2, +4.6] | no gain from high |
| Pro − 3.8 high | −13.2 [−24.3, −3.9] | −26.2 [−38.8, −14.8] | −22.0 [−35.2, −10.4] | yes, but the keys favour Pro by construction (Set A: +1.4) |
| Opus − Pro | +1.6 [−11.9, +16.0] | +25.3 [+13.4, +38.9] | +15.6 [+0.8, +31.3] | **no**: flips with the referee |
| Opus corrects Pro − Pro | +2.8 [−2.9, +10.0] | +11.8 [+2.9, +21.9] | +7.5 [−0.8, +17.0] | no gain under any key |
| Disagreement − Pro | −3.5 [−6.4, −1.1] | +0.3 [−1.5, +2.4] | −4.1 [−6.6, −2.2] | no (and circular: the keys settle the same disputes) |

- **By stratum, KEY-F, Pro / Opus / Flash-Lite:**
  - Latin 8.9 / 13.0 / 27.1;
  - CJK 12.4 / 7.5 / 25.8;
  - Arabic 8.2 / 25.6 / 51.6;
  - Greek 3.9 / 23.9 / 44.0;
  - Hebrew 44.1 / 52.1 / 95.8;
  - Syriac 17.1 / 100.0 / 92.6.
- **Opus writes `[?]` across the Syriac and Turfan pages,** including one legible Syriac memra page. That honest abstention scores as omission (100%).
- **Opus correcting Pro on Set B harms clean Pro drafts** (+10 to +14 points on the clean tertile under every key). But a Pro draft is close to the keys by construction, so this is not evidence against the pass. Set A carries the noise-tertile result.

**Referees and controls.**
- **Planted controls caught:** KEY-O 27/27, KEY-G 26/27.
- **The two keys agree on 311 of 638 spans (49%).** Per stratum:

  | stratum | agreement | spans |
  |---|---|---|
  | Latin | 48% | 426 |
  | Arabic | 58% | 137 |
  | Greek | 35% | 26 |
  | CJK | 29% | 14 |
  | Hebrew | 25% | 24 |
  | Syriac | 82% | 11 |

- **Every stratum is marked "judges disagree".** Following arXiv 2505.12201, no language is dropped for it.
- **Fable settled 327 spans:**
  - it sided with KEY-O on 166, so **KEY-G lost 51%**;
  - it sided with KEY-G on 130, so **KEY-O lost 40%**;
  - 31 got no clean verdict.

  Fable is Claude-family, so it leans the way #6388 measured. KEY-F is reported but not trusted alone.
- **One parser bug was found and fixed before any score.** The first verdict parser dropped every second line. The first Fable pass was discarded, kept as `out-f.halfparse.jsonl` in scratch.

### By eye: the 10 worst pages per arm

Every read was checked against the image. Verdicts are in `results/mss-thinking-6544/byeye/*.verdict.json`.

**Invented text** means fluent text that is not on the page.
- **Flash-Lite:** 7 of 10 on Set A, 7 of 10 on Set B.
  - Arabic: "فصل ابن ملك قوله وسمى الذي فيه فاعلًا اسم الفاعل" stands where the page opens an Alfiyya verse on badal.
  - Syriac: on the Ninevite-fast leaf it gives John 6 in the Peshitta word for word.
  - Hebrew: on Gaster it writes a planetary-hours treatise.
  - Loops: "fuerunt" ×65 on one CREMMA page.
- **3.8 Flash low:** 5 of 10 on Set A, 8 of 10 on Set B. It writes Middle French on a Manichaean fragment, the Lord's Prayer on a Syriac leaf, and scholastic prose on BIS-193 ("Sed sicut in mente creati…").
- **3.8 Flash high:** 5 of 10 on Set A, 10 of 10 on Set B.
  - An Ephrem madrasha on a Sogdian fragment.
  - A Dioscorus narrative.
  - Memorised 養肝氣…養心氣 where the scribe wrote 肺…腎.
  - On Mazarine 915, a fluent text on the intensity of heat on a page about quantity.
- **3.1 Pro:** 6 of 10 on Set A, 8 of 10 on Set B.
  - On an Arabic page, textbook examples ("يا زيد زيد اليعملات") replace the red-ink verse.
  - Memorised Tanya and Shema prose on the Hebrew page.
  - Stock charter formulas ("Testꝰ ꝛc") on a Latin writ.
  - A deathbed testament invented under a real Syriac rubric.
  - On 3 dense two-column pages, column 2 turns into letter salad.
- **Opus:** 3 of 10 on Set A, 0 of 10 on Set B. Its errors are omissions: `[?]` lines with the correct line count. Where it does invent, the insertions are local: "sunt opiniones de fide… prima est heretica" on PalLat 3r, and a remembered verse wording on RASAM.
- **Opus corrects Pro:** 5 of 10 on Set A, most of it carried over from Pro's draft. On 6 of 8 pages the second pass also added new errors: it smoothed "inĩa" into "infinito", and it stopped reading column 2 on BIS 0447.
- **Pro corrects Opus:** 3 of 10 (Set A only, since Set B was not run).
- **Disagreement:** 1 of 10 on Set A and 2 on Set B, with errors mostly convention or key. Several of its failed reads were the word "and" leaked from reasoning. They are now counted as failed, not scored.
- **The model keys were wrong on 7 of 12 and 10 of 13 by-eye Set B pages.** They omit Chinese columns and an Arabic line, and force Syriac onto Manichaean fragments. This is the second reason Set B is directional.

**What this means.** Letter CER cannot tell honest misreading from invention, and every Gemini arm invents on its hardest pages. Pro is not safer than Flash-Lite on that axis; it is more accurate. Opus fails by abstaining, which a reader can see. Any route to a thinking Gemini still needs the invented-text guards downstream: a by-eye sample and the restart/duplicate checks.

### Calls, cost and what did not run
- **agy (subscription, $0):** 558 calls (3.1 Pro 248, 3.8 high 192, 3.8 low 118), including 21 quota errors.
- **Claude (subscription, $0):** about 360 `claude -p` calls: Opus reads, corrections, KEY-O and Fable.
- **Paid:** Flash-Lite API $0.44 on 105 pages. Nothing was written to production.
- **The account-wide agy quota ran out twice:**
  - 03:42Z, "resets in 2h51m": resumed after the reset;
  - 08:43Z: stopped here, as the brief says.
- **Not run:**
  - Pro corrects Opus: Set A 14 of 76 pages, Set B all 40;
  - the disagreement resolver: Set A 47 pages, Set B 10.

  Every runner resumes from its output file: `run-cli-arm.py --requests $JOB_SCRATCH/set{A,B}/req/{corr-pro,resolve}.jsonl …`.
- **The Claude session limit also hit once (04:00Z).** 37 Opus corrections failed with a 429 and were re-run after the reset.

### Setup differences to keep in mind
- **CLI defaults:** no temperature or media-resolution control for Gemini, and the default thinking per model.
- **One run per arm,** so there is no repeat-instability measure.
- **One prompt for every non-production reader.** Flash-Lite keeps production's prompt, which reflows lines and expands abbreviations, and that costs it on CREMMA.
- **The Set B frame takes `book_class` as given.** Five of its picks are mislabelled Turfan fragments.

### Routing answer
**Move manuscript pages from Flash-Lite to Gemini 3.1 Pro through the CLI. Do not use 3.8 Flash at either thinking level, and do not add a second model yet.** Confidence: moderate.
- **The move off Flash-Lite holds on expert references (−4.7 points) and under all three keys.**
- **Pro over 3.8 Flash rests on its lower failure rate** (failed = 1.0: 17.4 against 20.6 and 24.1) and on Set B. On Set A the two are level.
- **Opus reads best on Set A,** but it is not robust on our corpus (the sign flips with the key) and it abstains on Syriac.
