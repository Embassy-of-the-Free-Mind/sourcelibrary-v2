---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [kangyur]
n_books: 50
n_pages: 40
verdict: "Reading the leaf removes the OCR-caused failures on the Kangyur two-leaf frames: 0 of 40 audited pages are bad because of the transcription (10-24 text-only: 18 of 28 Tibetan bad pages), and all five 10-24 bad pages drawn are now not bad. Stage 1 passed (1/20 bad, controls 6/6, 0 invented by eye in 10). The metered 300-page batch scored 2/20 bad, above the 5% bar; pooled 3/40 (7.5%, 2.6-19.9%), all translator-side, and 3 of the 40 pages carry a false bracketed claim about what the leaf says."
status: rejected
decision: "No write. Leaf-attached Opus is the right input (the correction pass is not needed for the English), but the lane needs a guard on its leaf notes before it can clear 5%; it costs $14.5-17.3 list per 100 pages, about 2x text-only."
superseded_by: null
issue: [6948]
---
## 2026-10-27 · Does Opus translating from the LEAF rescue the Kangyur two-leaf frames? (#6948)

PRIOR ART: `2026-10-24-opus-translate-tibetan-sanskrit-gate-6948.md` (text-only Opus on the Yigdzin transcription:
Kangyur CANON 19/40 bad, 18 of the 28 Tibetan bad pages caused by the transcription); job tib-concept-opus-6948's
Bardo pilot (#6948, 2026-10-27 11:42Z: the same Opus given the leaf as full-resolution strips, `claude-translate.mjs
--images-dir`, 1/30 bad, but on clean print with 1.6 differing spans a page against 16.6 on Kangyur frames);
`2026-10-27-tibetan-translation-router-agy4-vs-opus10-6948.md` (Opus@10 27/30 on Flash-CORRECTED text);
`split-leaves-5771` (#5771: per-leaf re-reads, 21% bad). Harness: `scripts/eval/tib-leaf-translate-6948/draw.mjs`;
the auditor is `scripts/eval/opus-tib-sa-6948/audit.mjs`, unchanged.

**Question.** On the hard Kangyur manuscripts, does showing Opus the leaf replace the Flash correction pass? If the
translator reads the leaf and brackets where it departs from the transcription, the 10-24 OCR-caused failures
(seam lines invented or duplicated, truncated lines) should not reach the English.

### Pre-registration (written and pushed before any audit reply is read)

**Frame.** The 10-24 Kangyur CANON stratum, rebuilt today with the 10-24 `frame.mjs` unchanged (live Tibetan books,
Yigdzin transcription, no English, not withheld for source_loop / ocr_unreadable / invented_by_eye, not left to
84000) and the 10-24 CANON title regex. Dropped: any book with a page whose OCR is the Flash correction
(`ocr.pipeline: tib-correct-6560`; the uncorrected Yigdzin text is the point), and job tib-concept-opus-6948's six
books.

**Stage 1 draw (`draw.mjs stage1`, seed 6948).** 20 blocks of up to 10 consecutive frame pages, one book each.
- **PAIRED-BAD, 5 blocks:** five of the 10-24 CANON pages the auditor called bad, drawn by seed from the 19 whose
  stored transcription is byte-identical to what the 10-24 auditor saw. That page is the audited page of its block.
- **FRESH, 15 blocks:** from other CANON books, a random block and a random audited page in it.

**Amendment, 12:55Z, before any read (the draw only).** Frame pages are scattered in these volumes: most of their
neighbours already carry older English or are withheld, so 10 consecutive *frame* pages rarely exist, and the first
draw gave 2-page blocks and dropped every paired page. A block is now 10 consecutive pages with an uncorrected
Yigdzin transcription (not unreadable, not withheld for source_loop / ocr_unreadable / invented_by_eye), whether or
not they have English; the AUDITED page is always a frame page (no English). Nothing is written, so existing English
is untouched. The draw: 20 blocks, 200 pages; PAIRED-BAD = 10-24 a034, a008, a015, a011, a031.

**Strips (before any read).** The frames come from the R2 archived master (BL's IIIF serves a whole image at only
1,200 px) and are cut into 2–3 vertical strips (≤ ~1,600 source px wide, 6% overlap), read at 0.5–0.67 of native
scale, about the Bardo pilot's scale. The Bardo rule alone (aspect ≤ 1.8) gave one strip per 1.5:1 frame, at 0.33.

**Pacing (inbox note 15:23Z, acted on 15:31Z).** The account was spending ~2.4%/h of its week against ~0.5%/h, so the
reads went from 2 streams to 1. 38 pages had been read in 2 streams before the 12:57Z 5-hour stop.

**Translator.** Opus via `claude -p` on this box's subscription, `claude-translate.mjs read --images-dir`
(job tib-concept-opus-6948's change, carried in this PR): each page's scan as overlapping full-resolution strips,
Read only, "translate what the leaf says, bracket where it departs from the transcription". 10 pages a call,
`--fresh`, `CANDIDATE_READS=off`, the production block prompt and seed, the UNCORRECTED Yigdzin text. Only the audited
page of each block is judged.

**Audit.** `audit.mjs` unchanged: blind, sealed Opus, page image + full-resolution tiles, the stored transcription and
the English; 6 planted controls (4 reversals, 2 inventions) on other read pages of the blocks, shuffled in with opaque
ids. `audit.mjs attribute` splits bad pages into transcription-caused and translator-caused, as on 10-24.

**Bar (Stage 1 passes only if all hold):**
1. **Bad ≤ 1 of 20** audited pages (≤ 5%), the auditor's verdict taken as given (by eye can only add bad pages).
2. **0 invented and 0 wrong-leaf by eye** on 10 pages I open myself, strips at full resolution: all 5 PAIRED-BAD
   pages, every page the auditor flags for invention or wrong-leaf, then the rest by seed from the FRESH pages.
3. **Controls:** at least 5 of 6 caught, or the auditor's verdicts do not count.

Reported, not gated: FRESH alone (the unbiased rate) and PAIRED-BAD alone (before 5/5 bad → after k/5), with Wilson
95% intervals; OCR spans per page; leaf notes the translator added; attribution.

**Stage 2 (only if Stage 1 passes; still files only).** `draw.mjs stage2`, seed 69482: 30 blocks of 10 consecutive
frame pages from 30 CANON books not in Stage 1; same translator settings. 20 of the 30 blocks (seeded) get one
audited page, same auditor, 6 controls. Metered: the climits meter (`/root/.claude-limits/latest.json`, this box's
account dereklomas@gmail.com) before and after, every other job on the account listed (`claude-job.sh list`), and
list-$ from each call's `cost_usd_equiv`. Reported: weekly-meter points and list-$ per 1,000 pages, with the
concurrency caveat (job tib-concept-opus-6948 reads on the same account at the same time). Stage 2's audit is
reported against the same ≤ 5% bar; it decides the recommendation, not a write.

**Limits.** $0 paid; Opus on the subscription only; reads stop at 80% of the 5-hour window and 89% of the week. No
agy. No page writes.

### Result, Stage 1 (20 pages): PASSES all three bars

The reads finished 17:13Z (200 pages, 62 calls, 0 failed; 34 pages re-read alone by the reader's drift/seam guard,
as production does: 3 of the 5 paired pages among them). The audit ran 19:00–19:40Z.

| | n | bad | 95% CI | usable / with caveat | OCR spans per page (mean, median) |
|---|---|---|---|---|---|
| **all** | 20 | **1 (5%)** | 0.9–24% | 2 / 17 | 15.6, 11 |
| FRESH (unbiased) | 15 | 1 (6.7%) | 1.2–30% | 1 / 13 | 13.0, 9 |
| PAIRED-BAD | 5 | **0** (10-24: 5/5) | 0–43% | 1 / 4 | 23.4, 27 |
| 10-24 text-only CANON, for reference | 40 | 19 (48%) | 33–63% | | 16.6, 15 |

- **Bar 1 (bad ≤ 1/20): met, at exactly 1.** **Bar 3 (controls ≥ 5/6): 6/6** (4/4 reversals, 2/2 inventions).
- **The five paired pages, 10-24 bad → now:**
  - a008 (Thadrak mDo sde Ta p.239): caveat. The OCR's duplicated smith simile and five "bam po" are gone; the English
    gives "fascicle forty-one" as the leaf has it.
  - a011 ('Bum Kha p.113): usable. The leaf's "eye of Dharma" section, which the OCR replaced with a repeated
    "eye of wisdom", is translated from the leaf.
  - a015 (Khri brgyad stong pa Kha p.30), a031 ('Dul ba Ca p.93), a034 ('Bum Cha p.304): caveat. The OCR's
    invented and repeated lines are not in the English.
- **The one bad page, a013 (Neyphug mDo sde Pa p.308), is translator-side and checked by eye.** The leaf reads
  གཞན་ལ་མི་སྨོད་པ་དེ་དག་ལ་ཆོས་ཡང་དག་པར་བརྗོད་པ་**མ་མཆིས** ("for those who do not disparage others there is *no* right
  proclamation"), as the transcription does. The English says "there is", with a note claiming the leaf reads so.
  Opus "corrected" the text toward the sense it expected and attributed that to the leaf. The same kind of false leaf
  note is on a015 (FRESH, caveat): it says the leaf lacks ཟབ་མོ "profound", which the leaf has.
  **2 of 20 audited pages carry a false claim about the leaf.**
- **Why 17 of 20 are "with caveat":** mostly the bracketed notes ("[the transcription repeats this line; the leaf
  has it once]"), which the auditor counts as chatter. 175 such notes sit on 83 of the 200 pages read. Written as
  they are, readers would see them in the English.
- **Attribution (`audit.mjs attribute`) was not run:** one bad page, and it was settled by eye.

**Bar 2, by eye (10 pages, all opened against the native-resolution scan): 0 invented, 0 wrong-leaf. Met.**
- The 5 paired pages (a002, a004, a007, a008, a018), the one page flagged for invention (a005), and seeded FRESH
  a001, a009, a017, a020; plus a013, the bad page.
- On every one, the English's leaf notes held where I could read the leaf: the line counts (7 + 7), the leaf
  ends, the headings (a004 བམ་པོ་བཞི་བཅུ / གཅིག་པ), the replaced items (a018 ཆོས་ཀྱི་མིག, a002 བྱང་ཆུབ་ནི་དེ་བཞིན་ཉིད).
- **The auditor's one "invention" (a005, "…is difficult") is wrong.** It is the lower leaf's first words,
  དཀའ་བའོ། །གཞན་ཡང་དཔེར་ན་ཁྱིམ་གྱི་ཁྱི…, a line the OCR skipped and the translator restored from the leaf.

**Usage, Stage 1:** reads $34.68 list-equivalent ($17.34 per 100 pages, 2× the Bardo's $8.70 and the 10-24
text-only $9.29; 3,883 output tokens and 37.5 s per page), audit 26 calls $8.53. The weekly meter moved 10 → 22%
over 12:40–17:10Z, but 6 jobs shared the account (es-meta-cli-7496, flora-zh-7537, prompt-bench-7499,
siku-kanripo-check-7503, tib-concept-opus-6948, this one), so that is not this job's cost.

### Result, Stage 2 (300 pages, metered): 2/20 bad, above the bar

30 blocks of 10 from 30 further CANON volumes (seed 69482), read 20:32–22:52Z in one stream (300 pages, 73 calls,
0 failed; 34 pages re-read alone). 45 of the 300 are frame pages (no English yet); the rest are their Yigdzin
neighbours. 20 audited frame pages, one per volume; the audit ran 01:40–02:20Z on 10-28.

| | n | bad | 95% CI | usable / with caveat | controls | OCR spans per page (mean, median) |
|---|---|---|---|---|---|---|
| Stage 2 | 20 | **2 (10%)** | 2.8–30% | 7 / 11 | **6/6** | 14.0, 11 |
| Stage 1 | 20 | 1 (5%) | 0.9–24% | 2 / 17 | 6/6 | 15.6, 11 |
| **pooled** | 40 | **3 (7.5%)** | 2.6–20% | 9 / 28 | 12/12 | |

- **Both bad pages are translator-side; neither is OCR-caused.**
  - a001 (Thadrak mDo sde Ma p.279): a gloss note ("that is, by every kind of liberation") that the context does not
    support. The auditor counts it as an invention; mild, but taken as given.
  - a010 (Neyphug mDo sde Nya p.179): the English drops the opening of the lower leaf, and a bracketed note says the
    text "continues directly into the next line". **Checked by eye:** lower-leaf line 1 reads
    རིགས་ཀྱི་བུ་གཞན་ཡང་བྱང་ཆུབ་སེམས་དཔའ་སེམས་དཔའ་ཆེན་པོའི་ཚུལ་ཁྲིམས་རྣམ་པར་དག་པའི་གོ་ཆ་ཆེན་པོའི་འཁོར་ལོ་ཡོད་དེ, untranslated.
- **False claims about the leaf, all 40 audited pages: 3** (a013 and a015 in Stage 1, a010 here). Two of them make
  a page bad. This is the lane's own failure mode: the note looks like evidence, so a reader trusts the error more.
- Leaf notes: 107 on 68 of the 300 pages (Stage 1: 175 on 83 of 200).

### Metering (this box's account, dereklomas@gmail.com)

| | pages | calls | list-$ | list-$ per 1,000 pages | s per page | weekly meter over the window |
|---|---|---|---|---|---|---|
| Stage 1 reads (12:40–17:13Z, 2 then 1 stream) | 200 | 62 | 34.68 | 173 | 37.5 | 10 → 22% |
| Stage 2 reads (20:30–22:55Z, 1 stream) | 300 | 73 | 43.45 | **145** | 27.9 | **24 → 38%** |
| audits (2 × 26 calls) | | 52 | 8.53 + ~8.5 | | | |

**Concurrency caveat, which dominates.** During the Stage-2 window, six other jobs ran on the same login:
es-meta-cli-7496, tib-concept-opus-6948 (Opus reads, until 21:21Z), correct-vs-reread-7568, euro-gpu-correct-7567,
invention-shelf-7575 and read-or-recall-7570 (`claude-job.sh` list at start and end, and each job's
`.claude-home`). The meter cannot be split between them, so:
- **Upper bound** (all 14 points charged to these reads): 46.7 points per 1,000 pages. Stage 1's window gives 60.
- **Calibrated estimate:** the 10-24 job measured ≤ 0.7–1.0 points per 100 pages at $9.29 list per 100 (l7a, fewer
  co-tenants), i.e. ≤ 0.075–0.11 points per list-$. At $145 per 1,000 pages that is **11–16 points per 1,000 pages**.

**What the ~85K Tibetan pages would take**, at $145–173 list per 1,000 pages: about $12.3–14.7K list-equivalent.
- At the calibrated rate: 940–1,360 points, **about 9–14 account-weeks**.
- At the upper bound: about 40.

This settles the 0.8 vs 3–10 question **against 0.8**. The leaf-attached read is at or above the top of the 3–10
range, because attaching the strips doubles the cost per page (text-only: $93 per 1,000).

### What writing would take (not done)
- `node --env-file=.env.production.local scripts/batch/cli-translate.mjs apply --out=<read dir> --reason="..." --apply`,
  restricted to frame pages. 255 of Stage 2's 300 pages (and most of Stage 1's neighbours) already carry English, so
  a plain apply over the read dir would overwrite it.
- Holds that would need releasing:
  - `tibetan-retranslation-awaits-derek`, on 49 of the 50 books;
  - `specialist-ocr-lane-4523`, on Neyphug rGyud Ba.
- Withheld reasons that would need clearing: `stale_after_reocr` and `unverified_script_ocr`, on most audited frame
  pages. Whether `apply` clears a `translation_withheld` was not checked.
- The bracketed leaf notes would be served as written.

### What this means
- **For the English, the leaf replaces the correction pass.**
  - 0 of 40 audited pages are bad because of the transcription (10-24 text-only: 18 of 28).
  - All 5 drawn 10-24 bad pages are now not bad.
  - On every page I opened, the dropped seam lines, restored skipped lines and replaced items checked out against
    the native scan.
  - The served *Tibetan* is still the damaged transcription, so the correction pass is still needed for the
    transcription itself.
- **It does not clear 5% yet.** Pooled 7.5% (2.6–20%), all three bad pages translator-side, two with a false leaf
  note.
- **Next step, before any scale-up:** make the leaf notes checkable, then re-run Stage 1 with a fresh draw.
  - Each note quotes the leaf's syllables.
  - A second, blind leaf read confirms each quoted reading.
  - Any note that fails is dropped, and that page is re-read.
- **Cost:** about 2× text-only per page, so the 85K pages are a multi-account-week job (about 9–14 weeks on one
  account at the calibrated rate), not 0.8.
