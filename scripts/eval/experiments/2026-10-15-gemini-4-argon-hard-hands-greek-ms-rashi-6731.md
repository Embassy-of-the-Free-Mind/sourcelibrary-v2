---
stage: ocr
measure: accuracy
languages: [grc, he, arc]
scripts: [Grek, Hebr]
canons: []
n_books: 17
n_pages: 122
verdict: "Gemini 4 Argon low reads Greek manuscripts better than every engine tried: 3.8 Flash, Opus 5.5, stored production OCR (3 Flash) and Kraken greek-cllg (+6 to +15 points a page, winning on 63-64 of 64 pages). On Rashi-type prints it is better than 3.8 Flash (+24) and production (+35), and the same as Opus 5.5 (30 wins, 26 losses). A no-image recall control scores 15-27 %, so the Rashi scores measure reading, not recitation."
status: informational
decision: null
superseded_by: null
issue: 6731
---
## 2026-10-15 · Gemini 4 Argon on the hardest hands: Greek manuscripts and Rashi script (#6731)
PRIOR ART: `2026-10-14-gemini-4-argon-low-hard-panels-6707.md` (the same G4L CLI route on the hard *print* panels; no Greek-manuscript or Rashi panel), `2026-10-06-greek-manuscripts-full-kraken-fit-5619.md` (the Greek pages, edition spans and Kraken reads used here), `PREREGISTRATION-hard-hands-6731.md` (this run's protocol and Amendment 1).

**Question (Derek, 2026-10-14).** Can Gemini 4 Argon read the hardest hands better: Greek manuscripts and Rashi script?

**Design.** Preregistered and pushed before any read (`PREREGISTRATION-hard-hands-6731.md`). $0, no paid API.
- **Arms.** G4L = `gemini-4-argon-low` and C38L = `gemini-3.8-flash-low`, both through agy (`run-cli-arm.py --kind ocr`). OPUS = Opus 5.5 through the **Claude CLI** (Amendment 1): agy's Claude pool hit its weekly cap after 2 calls. Every arm got the live default OCR prompt (v19.1, hash `9d8f959e…`) and one page image per call, long side ≤ 3,000 px. Stored comparators: production OCR (`ocr.data`; Greek 62/64 `gemini-3-flash-preview`; Rashi pages 3 Flash, 3.1 Flash-Lite) and, for Greek, Kraken `greek-cllg` from #5619.
- **Greek: 64 pages from 5 codices.** Up to 15 per book, drawn from #5619's fitted pages whose neighbour-span edges agree with the page's own edges within one line. They are selected by the Kraken fit, except 4 Psellos pages selected by the production read's fit. Grec 1841 spreads were cut at the gutter, with one call per half. Reference = Schneider / Berthelot–Ruelle span ± 1 line, trimmed with `alignTrimWindow`.
- **Rashi: 58 pages from 12 books.**
  - 107 printed Hebrew/Aramaic books were classified by image (28 Rashi, 10 mixed, 30 square, 39 other). Of these, 15 have a Sefaria text for their Rashi-type block; 12 were drawn, 5 pages each, and 2 pages left the set under the alignment threshold.
  - Reference: each read is located in the Sefaria text, then locally aligned to it. The reference span is the median of the aligning reads (≥ 3) or their union.
  - Scorer: the existing `SCRIPT_DEFS.hebrew` fold after Sefaria markup is cleaned, pinned by 12 fixtures (`tests/unit/hard-hands-cer.test.ts`).
- **Measure.** Accuracy = 1 − mean CER. The CER uses fitting alignment: text read before and after the reference passage is free; text inside it is charged. Failed reads are counted, not scored (ONE FAILURE RULE). Paired Δ = median per-page CER difference (G4L − other; negative = G4L better), with a 2,000-resample page bootstrap. *Better* or *worse* needs the CI to exclude 0 and |Δ| > 1 point.

**Result: Greek manuscripts (64 pages, 5 works).**

| arm | accuracy [95% CI] | failed | sec/call median |
|---|---|---|---|
| **G4L** | **0.782** [0.757, 0.806] | 0 | 47 |
| Kraken greek-cllg | 0.719 [0.699, 0.739] | 0 | — |
| Opus 5.5 (Claude CLI) | 0.676 [0.647, 0.705] | 0 | 45 |
| 3.8 Flash low | 0.654 [0.624, 0.686] (45 scored) | 19 (18 copy filter, 1 empty) | 71 |
| production (3 Flash) | 0.583 [0.546, 0.620] | 0 | — |

G4L vs C38L Δ −0.140 [−0.149, −0.114], 45 W / 0 L; vs Opus −0.078 [−0.102, −0.069], 64 W / 0 L; vs production −0.146 [−0.182, −0.128], 64 W / 0 L; vs Kraken −0.061 [−0.071, −0.050], 63 W / 1 L. **All four: better.** Without the 4 production-fit Psellos pages nothing changes (vs production −0.151).

| work | n | G4L | C38L | Opus | production | Kraken |
|---|---|---|---|---|---|---|
| Grec 1841 (spreads) | 15 | 0.78 | 0.61 | 0.71 | 0.36 | 0.74 |
| Grec 1839 | 15 | 0.85 | 0.72 (1 failed) | 0.72 | 0.68 | 0.77 |
| Marcianus gr. 299 | 15 | 0.75 | 0.59 (9 failed) | 0.61 | 0.59 | 0.70 |
| Ars sacra | 15 | 0.74 | 0.62 (9 failed) | 0.67 | 0.66 | 0.66 |
| Psellos | 4 | 0.80 | 0.73 | 0.63 | 0.73 | 0.70 |

**Result: Rashi script (58 pages, 12 books).**

| arm | accuracy [95% CI] | median CER | failed | sec/call median |
|---|---|---|---|---|
| **G4L** | **0.829** [0.796, 0.857] (56 scored) | 0.135 | 2 (copy filter) | 91 |
| Opus 5.5 (Claude CLI) | 0.724 [0.645, 0.796] | 0.127 | 0 | 52 |
| 3.8 Flash low | 0.576 [0.525, 0.625] | 0.426 | 0 | 65 |
| production | 0.482 [0.419, 0.546] (54 scored) | 0.617 | 3 not OCR (Sefaria text written by #5560), 1 empty | — |

G4L vs C38L Δ −0.240 [−0.311, −0.144], 55 W / 1 L → **better**. Vs production −0.345 [−0.462, −0.242], 51 W / 1 L → **better**. Vs Opus −0.012 [−0.024, +0.006], 30 W / 26 L → **same**: the medians agree. Opus's lower mean comes from 4 of 5 Shenei Luchot spreads, where it transcribed headers only and marked the dense body text unreadable at the resolution it sees. That counts as a scored near-total omission, not as invented text.

| work | n | G4L | C38L | Opus | production |
|---|---|---|---|---|---|
| Zohar (1558) | 5 | 0.88 | 0.66 | 0.88 | 0.79 |
| Mikraot Gedolot, Psalms (1517) | 5 | 0.64 (1 failed) | 0.46 | 0.51 | 0.39 |
| Sha'arei Orah (1715) | 5 | 0.80 | 0.80 | 0.88 | 0.58 |
| Shenei Luchot ha-Berit (1698) | 5 | 0.73 | 0.39 | 0.05 | 0.55 |
| Twelve Prophets with Radak (1539) | 5 | 0.87 | 0.74 | 0.85 | 0.80 |
| Zohar Chadash (1702) | 5 | 0.77 (1 failed) | 0.50 | 0.86 | 0.22 (2 not OCR) |
| Pardes Rimmonim (1786) | 5 | 0.84 | 0.44 | 0.57 | 0.22 (1 not OCR) |
| Tikkunei ha-Zohar (1706) | 5 | 0.83 | 0.68 | 0.70 | 0.30 (1 empty) |
| Talmud Bavli, Moed (Vilna 1884), Rashi | 5 | 0.86 | 0.52 | 0.75 | 0.32 |
| Ein Yaakov, Berakhot (1883), Rashi | 5 | 0.87 | 0.50 | 0.89 | 0.29 |
| Shulchan Arukh, Choshen Mishpat (1565) | 5 | 0.92 | 0.57 | 0.90 | 0.69 |
| Mikraot Gedolot, Torah (Vilna 1899), Rashi | 3 | 0.91 | 0.73 | 0.93 | 0.42 |

**Memorisation control (15 Rashi pages, mostly Rashi on Talmud and Torah; no image).** Each arm was asked to write out the reference passage from memory, and the recall was scored against the same reference. Recall accuracy:
- G4L 0.27 (15 scored; image read of the same pages 0.88; best single page 0.36);
- 3.8 Flash 0.25 (14; image 0.58);
- Opus 0.15 (10 scored, 5 empty or declined; image 0.83). Opus recalled one passage well: Rashi on Leviticus 11, 0.83 against 0.93 from the image.

Recall is far below the image reads, so on these pages the scores measure reading, not recitation.

**The five worst G4L pages per script, read against the image (read-from-image).**
- **Greek: misread abbreviations and ligatures, and reference noise.**
  - Every engine scores 0.46–0.54 on the worst pages (Psellos p35, Ars sacra p367, p52, p240; Marcianus p179). There, the edition span carries the editor's apparatus and headings (French notes, "Transcrit sur A, f. 216 r.", Latin footnotes) and Berthelot–Ruelle's readings from other witnesses.
  - G4L's own errors, seen on Marcianus p179: the image's first line reads πρὸς τὰ κάτω μὲν τοῖς ἄνθραξιν ὑποφυσώμ(ενον). G4L writes πρὸς αἰεὶ αὐτὸ μὲν … ὑποφωτόν; it writes ἐπὶ δὲ πώματος for ἐπὶ διπλώματος, and τῷ θυμιάτῳ δέ for τὰ ἐν μέσῳ δέ. These are suspensions and ligatures resolved into plausible wrong words.
  - It keeps the scribe's numeral ϛ̅ where the edition prints ἕξ.
  - No lines are dropped, and no passage is substituted.
- **Rashi: page order on spreads, not misreading.**
  - On the worst pages (Zohar Chadash p43 0.50, Sha'arei Orah p114 0.64, Shenei Luchot p753 0.46), G4L's text is accurate where it aligns: 8–16 % local error.
  - It reads the **left page of a Hebrew spread first**. Mapped line by line, its read runs through 42→98 % of the reference, then 0→41 %. The fitting alignment charges the second page as interior insertion.
  - On Mikraot Gedolot 1517 p46 (0.51), G4L transcribes the pointed Psalms text and marginal glosses, and the Radak commentary block reads poorly at this scan quality (every engine ≤ 0.53).
  - No recited passage was found: on these pages the read follows the image's own text.

**Failures and tool calls.**
- **G4L:** 0 Greek failures; 2 Rashi copy-filter cuts (Mikraot Gedolot p146, where the model wrote "cannot be output because automated content safety filters block…"; Zohar Chadash p140). The tool gate refused tool calls on 49 of 64 Greek units (65 refusals) and 20 of 58 Rashi pages; no turn ended on them.
- **3.8 Flash:** **18 of 64 Greek pages cut by Gemini's copy filter** (9 Marcianus, 9 Ars sacra) and 1 empty. Its no-image recall needed a nudge on 12 of 15 calls.
- **Opus (Claude CLI):** 0 failures. In the recall control it returned 4 empty replies and 1 refusal.

**Caveats.**
- Edition ≠ diplomatic transcription; every reader shares that floor, so read differences, not levels.
- The Greek pages are selected by the Kraken fit, which favours Kraken; G4L still wins 63/64 against it.
- Opus went through a different route (Claude CLI, default effort, the image opened with the Read tool), and it sees a downsampled image. That is the likely cause of its "too small to read" replies on dense spreads.
- 3 Rashi pages carried Sefaria text as production OCR (#5560 writes). They are not scored as OCR.

**Grade:** directional (5 Greek works; 12 Rashi books, 5 pages each). No routing change follows from this run. *Cost:* $0; 139 G4L + 139 C38L + 139 Opus page reads, plus 45 recall calls. *Artifacts:* `scripts/eval/hard-hands-6731/` (prepare, run, score), `scripts/eval/results/hard-hands-6731/` (classification, Sefaria map, page lists, scored cells, analyses, raw reads gzipped).

**Verdicts (2026-10-15, these pages, through the CLI):**
- **Greek manuscripts:** Gemini 4 Argon low reads them **better than** 3.8 Flash, Opus 5.5, production 3 Flash and Kraken greek-cllg.
- **Rashi script:** Gemini 4 Argon low reads it **better than** 3.8 Flash and production, and **the same as** Opus 5.5.
