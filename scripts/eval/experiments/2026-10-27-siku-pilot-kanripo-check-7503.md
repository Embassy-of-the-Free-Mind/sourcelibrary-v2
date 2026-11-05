---
stage: ocr
measure: accuracy
languages: [lzh]
scripts: [Hani]
canons: [chinese-classics]
n_books: 20
n_pages: 2926
verdict: "Against Kanripo's WYG transcription, the pilot's stored Paddle OCR has a median body CER of 2.7% (by-book 95% CI 2.0-3.6%) on 2,611 aligned pages, and 139 pages (5.3%) are above 0.1. By eye, no page image is the wrong leaf, out of order or a duplicate. One page carries a chat model's reply, and so do 137 Paddle pages corpus-wide, 14 of them with that reply in public English. On the 30 QA pages, rejected translations have the same OCR CER as accepted ones."
status: informational
decision: "None taken (read-only). Recommendation: strip the model-reply sentence from the 137 Paddle pages and re-translate the 14 affected English pages; Kanripo text as the translation source is licence-compatible (CC BY-SA 4.0 both sides) but would not fix the pilot's translation errors."
superseded_by: null
issue: [7503, 5600]
---
## 2026-10-27 · Siku pilot pages against Kanripo: OCR accuracy and are the images the right leaves? (#7503)

PRIOR ART: `scripts/eval/zh-skqs-5568-kanripo.mjs` (the #5568 leaf rule and its `drift` mode, imported),
`scripts/eval/ground-truth-5935/lib.mjs` (`bodyCer`), `scripts/eval/paddle-table-6388/` (align + CER, 30 pages).
Scripts and results: `scripts/eval/siku-kanripo-7503/` (README there).

**Question (Derek, 2026-10-27):** "OCR against Kanripo ... and yes, if the images are right." The pilot's 20 books
(PR #7543 `draw.json`, 2,926 pages) are CADAL scans of the Wenyuan Ge Siku Quanshu, and Kanripo transcribes that
edition (WYG witness). Every page can be checked with no model. $0, no model calls, read-only on Mongo.

### 1. Books → Kanripo
- **18 of 20 books** have a WYG branch. On 11 of them, the repo's `Readme.org` names the witness as `四庫全書・文淵閣`.
- **皇極經世書解 (KR3g0010):** there is no such repository in the kanripo org (404). Its 102 pilot pages are unchecked.
- **山堂肆考 vol 86 (KR3k0052, juan 193–194):** the repo stops at juan 56 (58 files), so its 142 pages are unchecked.
  The other 山堂肆考 volume (juan 12–14) is covered.
- **Licence.** None of the 18 repos has a licence field, a LICENSE file or a licence line in its Readme. The org
  profile says "Licensed as CC BY SA 4.0". Per-book rows, with the branch commit sha, are in `results/books.json`.

### 2. Per-page alignment and CER (pilot pages)
| | |
|---|---|
| text pages (≥ 20 Han chars) | 2,904 |
| with Kanripo coverage | 2,660 |
| **aligned (Dice ≥ 0.6)** | **2,611** (98.2% of covered; 89.9% of all text pages) |
| **median body CER** | **2.7%**; by-book bootstrap CI [2.0%, 3.6%]; mean 3.6% |
| pages CER > 0.1 | **139 (5.3%**, Wilson [4.5%, 6.3%]); > 0.25: 6; ≥ 0.5: 1 |
| book medians | 1.0% (簡端錄) … 5.7% (通雅) |

The page's stored `ocr.qa_screen` leaf (the #5568 lane screen) agrees with this independent alignment on **2,612 of
2,612** pages.

**What makes up CER over 0.1** (139 pages):
- 678 characters Paddle wrote that the leaf does not have. Most are the 版心 margin read as body text, e.g.
  `金公口左人一書` for 欽定四庫全書.
- 569 single-character misreads.
- 431 leaf characters Paddle left out.
- 433 characters in multi-character runs, which include double-column notes read in a different order.

### 3. Are the images the right leaves?
Kanripo leaves advance monotonically through every covered book.

| flag | pages | by eye |
|---|---|---|
| out of sequence (off the longest increasing run) | **0** | — |
| two pages on one leaf (duplicate image) | **0** | — |
| image key without its book_id (`isBookScopedUrl`, all 3,015 pages) | **0** | — |
| one image holds two whole folios (4 half-leaves): 詩總聞 113–114 | 2 | 1/1 confirmed. In sequence, nothing missing; it explains the "6 leaves skipped" flag |
| no leaf: Siku proofreader slip (詳校官…謄錄監生), which Kanripo omits | 30 | 2/2 |
| no leaf: diagram (廟圖), which Kanripo leaves empty | 6 | 2/2 |
| no leaf: 考證 notes appended to the juan | 2 | 1/1 |
| no leaf: **Kanripo defect.** KR1g0016 repeats leaves 3a/3b as 4a/4b and 14a/b as 15a/b, losing the real text (9 duplicated pairs in the work; KR1c0014 has 2) | 6 | 3/3. The scan is right and the reference is wrong |
| right leaf, Dice under 0.6 (`&KR` entity glyphs; a reply line, below) | 3 | 2/2 |

**10 flagged pages opened by eye:** every one means what its class says, and **none is a wrong image**.
**5 clean pages, drawn at random (seed 7503):** each image matches its Kanripo leaf. So the pilot's images are the
leaves they claim to be. What fails to align is edition matter that Kanripo omits, plus Kanripo's own transcription
defects.

**Found by eye: a chat model's reply inside stored OCR.** 詩總聞 p118 (`6a3ce7ab0a0011cb4bc0a847`) ends with
`作为一个人工智能语言模型，我还没学习如何回答这个问题…`. The image has no such line. It is the only pilot page with it.
- **Corpus-wide** (`model-reply-scan.mjs --all`, 13,991 Chinese books): **137 Paddle pages in 127 books**, all on
  visible books.
- 17 have English. **On 14 of them the English carries the reply**, either rendered as page text ("As an artificial
  intelligence language model, I have not yet learned…") or as a translator's note about it.
- No writes were made: this job is read-only, and a regex result goes through the normal dry run (see
  containment-on-finding.md, "Not for a detector's output").

### 4. QA verdicts × CER
siku-pilot-7503-cl judged 30 pages (blind Opus, image open; 5/5 controls caught). Joined in `results/qa-join.json`.
- **Accepted:** 18 pages with Kanripo CER, median **2.3%**.
- **Rejected:** 9 pages, median **2.5%**. None of them is above 0.1.
- The only judged page above 0.1 (傳信適用方 p5, 16%) was accepted.
- The rejections are sense errors (O6) and invented glosses (T10/T8) on pages whose OCR is near-exact (Dice 0.89–0.99).

**Bad translations in this pilot do not come from bad OCR.** n is small (27 joined), but the two groups do not
separate at all.

### 5. What Kanripo text would change (Dice ≥ 0.9)
- **2,023 pages** with 310,178 Kanripo characters: **7,624 character edits, 2.46 per 100**. Median 3 per page;
  236 pages identical.
- **4,646 single-character substitutions.** The 80 most common pairs cover 53% of them:
  - About three-quarters are glyph forms that Kanripo keeps and Paddle modernises (宮/宫, 內/内, 虛/虚, 絕/絶, 傳/𫝊).
    Swapping these changes no reading.
  - About a quarter are real misreads: 巳/已/己 (330), 曰/日 (146), 剌/刺, 丈/文, 益/葢, 奠/薁.
- So swapping in Kanripo fixes roughly one real misread per 100–200 characters and removes the margin junk, but most
  of the edits are orthography.
- **Licence:** compatible. Kanripo is CC BY-SA 4.0 (org statement), and Source Library serves text and translations
  as CC BY-SA 4.0 (`/api/books/[id]/text`). A translation made from Kanripo text is an adaptation, so it needs
  attribution and the same licence, which the site already gives.
- **Provenance per the writer standard:** the shape already exists in `zh-skqs-5568-kanripo.mjs write-dryrun`:
  `ocr.source: kanripo`, repo + branch + commit sha + file + `pb`, the licence statement with its date checked, and
  the alignment Dice/runner-up. The licence statement must say that the per-repo licence is not stated.
- **Guards it would need:**
  - Skip leaves in the work's duplicate set (KR1g0016 has 9 pairs).
  - Skip incomplete repos (KR3k0052).
  - Map `&KR…;` entities back to characters.
  - Keep Paddle for proofreader slips, diagrams and 考證, which Kanripo does not carry.

**Recommendation (no writes):**
- Kanripo is a sound *reference* and a reasonable OCR substitute for SKQS at Dice ≥ 0.9, but it is not the fix for
  the pilot's gate miss: that is in translation.
- The urgent item is the 137 model-reply pages: strip the sentence from `ocr.data` (snapshot first), withhold or
  re-translate the 14 English pages, and add `MODEL_REPLY` to the Paddle writer's post-process.
