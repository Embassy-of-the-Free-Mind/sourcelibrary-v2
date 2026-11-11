---
stage: ocr
measure: judged_vs_reference
languages: [mn]
scripts: [Mong]
canons: [mongolian-kanjur]
n_books: 32
n_pages: 530
verdict: "No open Unicode e-text of the Beijing Mongolian Kanjur exists, but four open-access publications transliterate five Kanjur texts with folio markers (34 sides). Aligned to our scans, they give 628 Opus-confirmed real columns: 516 for training (3,713 words, 891 distinct) and 112 from a frozen volume, kept for evaluation only. The rKTs title route gives only 30 confirmed columns. 516 is below the 1,000-column bar, so no 10-mongol-real-train was queued. The synthetic reader's CER on real prose is 55 %."
status: informational
decision: "No training queued (516 < 1,000). The aligned columns, the aligner and the trainer flag are ready for when a Mongolist's body columns arrive (#5664)"
superseded_by: null
issue: [5664, 6871]
---
PRIOR ART: `2026-10-18-mongol-synth-prereg-5664.md` and the score entry in PR #6924 (the synthetic-trained adapter used here as a locator, its frozen sets and the hold-out rule); `scripts/eval/mongol-synth-5664/` (segmenter, fetcher, crop, trainer: all reused); `2026-10-04-mongol-kanjur-ocr-probe-5664.md` and the #5664 desk-research comments (three earlier passes found no e-text). Nothing in `scripts/eval/INDEX.md` aligns known Mongolian text to Kanjur columns or converts a Latin transliteration to Unicode Mongolian.

## 2026-10-18 · Real Kanjur ground truth at $0: published transliterations and rKTs titles, aligned to the scans (#5664, #6871 row 6)

**Question.** Can real Kanjur columns with known text be had for free, enough (≥ 1,000) to fine-tune the synthetic-trained reader out of its domain gap?

### 1. Is there an open e-text? (web, $0)
- **No dataset.** BDRC/OpenPecha releases, the BDRC record (MW4CZ5370) and the Hugging Face sets are all Tibetan. rKTs has catalogue data only for the Mongolian Kanjurs (its e-texts are Tibetan). TITUS has nothing Mongolian. GitHub, Zenodo and HF searches for kanjur/ganjuur/mongolian found nothing usable.
- Inner Mongolia's Academy of Social Sciences reported keying the whole Kanjur into a corpus in 2018. No public endpoint was found, so it may exist but it is not open. Altanorgil's modern Chinese edition reportedly follows the Kangxi text; it is not confirmed and not online.
- **But four open-access publications transliterate whole Mng1 texts with folio or Chandra-page markers.** Chandra's page p is side 2·folio−1 (a) or 2·folio (b), checked against rKTs (392b = 784). Every leaf used was read by eye at its Chinese margin, 11 of 11 agree (e.g. v108 律師戒行經第十六卷上二百五十 = 250a).

| file | publication | Kanjur location | line ends marked | use |
|---|---|---|---|---|
| A | Muzraeva & Batsuuri 2020, *Mongolovedenie* 12(2) | v23 ff. 84b–87a, Aparimitāyur-jñāna-hṛdaya dhāraṇī (Mng1.491) | yes | **evaluation only**: v23 is a frozen meaning volume |
| B | Muzraeva 2004, *Mongolovedenie* 3 | v91 ff. 364a–368a (Ligeti 1108) | no; re-keyed from page images, the text layer had lost every diacritic | training |
| C | Muzraeva 2020, *Oriental Studies* 13(6) | v14 ff. 356b–358a and v24 ff. 226b–227b, six short dhāraṇīs | yes | training |
| D | Mirzaeva 2019, PhD thesis, appendix 2 | v108 ff. 250a–254a, Bhadracarī | no | training |

**Licence: CC BY-NC-ND 4.0** for both journals (quoted from the journal's policy page); the thesis states none. The transliteration text and every label derived from it are therefore **not in this public repo**. They are stored privately (`refs-private.json` records the sha256 of each file and where it lives), and the committed pair files carry ids and scores only.

### 2. Alignment and verification
- **Leaves:** 530 sides (4 failed the segmenter), cut into 15,264 columns by the existing segmenter. That covers the start and end side of each of the 461 catalogued Mng1 texts outside the frozen sets (27 volumes), plus the 34 transliterated sides. The 30 frozen meaning volumes and the 40 evaluated texts are excluded from training by construction.
- **Locator:** gpu-queue task `05-mongol-realgt-read` on gex45 (20:30–22:11 UTC, 0.35–0.43 s per column). The synthetic adapter read every column. **The reads are a locator, never a label.**
- **Body text (`align.py body`):**
  - A dynamic programme assigns each side's transliterated words to its columns. The cost is the absolute edit distance in Unicode. Leading and trailing columns may belong to the neighbouring text, and the editor's `|` line ends are rewarded as breaks.
  - On synthetic tests it recovers every column exactly even with 65 % of letters corrupted, because the word breaks carry it.
  - On the real reads, where the edition marks lines, the DP's column boundaries agree with the editor's on both ends for 141/157 (A) and 130/158 (C) columns.
- **Titles (`align.py title`):** a column is labelled only if its whole read fits inside "mongγol-un keleber: ⟨title⟩::" or "⟨title⟩ tegüsbe::" (Glass databank / rKTs title, CC BY-SA).
- **Keep (`keep.py`):** two checks.
  1. *Deterministic screen.* The word count must be within ±2 (or ±25 %). A body column's read must be closer to its own label than to either neighbour's. A title column's edit distance must be ≤ 0.35.
  2. *Opus, text side only.* Sealed `claude -p --model opus`, 20 items per call. Opus sees the read and four shuffled candidate strings (Latin + Unicode): the proposed label and three distractors, two of them the neighbouring columns' labels. It must name the right one or answer none. One item in ten is a control with the true label removed.

| | proposed | passed screen | Opus confirmed | Opus controls (wrong string accepted) |
|---|---|---|---|---|
| A v23 (eval only) | 157 | 124 | 112 | 2/12 |
| B v91 | 239 | 194 | 172 | 2/19 |
| C v14 + v24 | 158 | 124 | 108 | 1/12 |
| D v108 | 271 | 229 | 205 | 2/23 |
| rKTs titles (461 texts) | 99 | 34 | 31 | 0/4 |
| **all** | 924 | 705 | **628** | **7/70 (10 %)** |

(After de-duplicating a column that appears as both a body and a title pair: 516 training columns + 112 evaluation columns.)

- **Training-eligible: 516 columns** (486 body + 30 title), **3,713 words, 891 distinct words, 17,955 letters.** Every native letter occurs. By share: e 10.5 %, a 10.3 %, i 9.0 %, γ/g 8.1 %, n 7.5 %, u 6.7 %, ü 6.0 %, r 5.3 %, d 4.9 %, b 4.3 %, q/k 3.9 %, t 3.8 %, s 3.6 %, l 3.6 %, y 2.5 %, m 2.3 %, o 2.0 %, č 2.0 %, ǰ 1.4 %, ö 1.1 %. Rare: ng 0.4 %, w 0.3 %, Galik h 0.2 %, š 0.2 %, p 0.1 %, z 4 times. f and ž are absent, the very loanword letters the reader over-produces.
- **What it can and cannot teach.** It is real body prose: sūtra narrative, dhāraṇī formulae and the Bhadracarī verses. That is the register the synthetic run lacked. But it is five texts (three of them dhāraṇīs heavy in Sanskrit-in-Galik), the vocabulary is narrow (891 words), and the D and B sources have no line marks, so their alignment rests on the DP and Opus alone. **The rKTs title route does not deliver**: the reader cannot spell titles well enough to anchor them, and full-column title windows are rare. It gave 30 columns from 461 texts. Reading the brief's estimate of "a few thousand" against this, it was wrong.
- **Leniency:** Opus accepted a wrong string on 7 of 70 controls, when the true label was absent. With the true label present it picked it 628/635 times, so the residual error rate in the kept set is likely well under 10 %, but it is not zero.
- **Selection bias, stated:** the screen and the Opus check keep columns the reader already half-reads. The 154 body columns that failed the screen are mostly structurally sound (line-mark agreement) and are the hard cases. A training run should consider adding back the A/C columns whose boundaries agree with the editor's on both ends.

### 3. Baseline for the next run: the synthetic reader on real prose
CER of `10-mongol-synth-train/adapter-final` against the aligned transliteration. Letters and word breaks only; punctuation and joiners are ignored.

| set | n columns | CER |
|---|---|---|
| A v23, every aligned column (frozen volume, held out) | 157 | **55.5 %** |
| A v23, Opus-confirmed only | 112 | 52.9 % |
| B / C / D confirmed | 172 / 109 / 205 | 52.8 / 46.5 / 48.6 % |
| titles confirmed | 30 | 32.1 % |

This is the real-prose number the synthetic run could not measure (its held-out CER was 3.9 % on synthetic text). The A set, 157 columns of a text in a frozen volume, is the evaluation a next training run should report.

### 4. Step 3: not triggered
The brief's bar is ≥ 1,000 real columns. 516 training-eligible columns do not meet it, so **no `10-mongol-real-train` was queued and no preregistration addendum was written.** Ready for when the bar is met:
- `train.py --init-adapter` continues from adapter-final.
- `build_train.py` mixes real columns into the synthetic pool at a set share and builds a `realeval` set. That set has the frozen meaning and name sets unchanged, plus the A prose and every 10th text's titles.
- The labels sit on gex45 at `/root/jobs/mongol-realgt-5664/kept.jsonl` (private, not in the repo).

**Spend:** $0. Opus ran on the Claude subscription (36 keep calls), with no Gemini (gemini-3.1-flash-lite was not used). The GPU was the owned gex45, about 1 h 41 min in the queue. **Nothing was written to `pages` or any production store.** The Mongo access was reads of `books` and `pages` to locate leaves.

Files: `scripts/eval/results/mongol-realgt-5664/` holds `texts.json`, `reads-realgt.jsonl.gz`, `screened.jsonl.gz`, `kept.jsonl.gz` (body labels stripped), `opus-verdicts.jsonl.gz`, `kept-report.json` and `refs-private.json`. Code: `scripts/eval/mongol-realgt-5664/`.
