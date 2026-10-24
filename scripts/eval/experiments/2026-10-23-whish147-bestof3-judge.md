---
stage: ocr
measure: [accuracy, judged]
languages: [sa, ml]
scripts: [Mlym]
canons: [sanskrit]
n_books: 1
n_pages: 9
verdict: "On 9 verse leaves of Whish 147, a blind Opus judge that sees only the candidate texts (no image, no edition) picks a read as good as the oracle best: CER 0.20 from 3 Opus reads (oracle 0.22) and 0.17 from 3 Opus + 1 Fable (oracle 0.18), against 0.34 for one read. A judge that also sees the leaf does worse (0.25). On the 206 edition-anchored leaves of the rollout the pick helps the kārikā leaves (0.42 → 0.31) but barely moves the commentaries (about 0.54 → 0.52)."
status: adopted
decision: "Every written leaf page of Whish 147 now carries the J-text pick of 3 Opus reads (4 with a Fable read on 9 leaves); on fresh-read pages it is the OCR, on edition-anchored pages it is the <note> (PR for #7119)."
superseded_by: null
issue: [7119]
---
PRIOR ART: 2026-10-23-whish147-stability-recall.md — measured that repeat reads of a leaf are bimodal (one read 0.34, best of 3 0.18) and that majority vote picks the poor read; a blind judge there RATED reads, it did not pick among them. This file tests picking, then applies it to the book.

Part of #7119.

## 2026-10-23 · Can a judge pick the good read among several? (#7119)

**Question.** The stability test showed that three Opus reads of a leaf usually include one close to the published text, and that agreement does not find it. Can an Opus judge find it without the edition?

**Design (gate, no writes).**
- *Leaves and reads:* the 9 verse leaves of the stability test (Sāṅkhyakārikā), with its stored reads: 3 Opus 5.5 and 3 Fable 5.1 per leaf. No new reads.
- *J-text:* the candidates in IAST, with `[illegible]` marks kept, in shuffled order. No image and no edition. The question: which is the most plausible text a scribe wrote.
- *J-image:* the leaf's column crops (fresh.mjs's, SHA-256 identical) plus the candidates in Malayalam as written. The judge checks 3 rows letter by letter, then picks.
- *Score:* the stability test's per-row best-window CER (`score_lib.py`, unchanged; it reproduces that test's 108 per-read scores exactly). Gate: roll out the best judge if its pooled CER is ≤ 0.25.
- 45 Opus judge calls.

**Result (gate).**

| candidates | one read (random) | oracle best | J-text | J-image |
|---|---|---|---|---|
| 3 Opus | 0.34 | 0.22 | **0.20** (7/9 best) | 0.25 (5/9) |
| 3 Opus + 1 Fable | 0.36 | 0.18 | **0.17** (7/9) | — |
| 3 Opus + 3 Fable | 0.34 | 0.13 | **0.13** (5/9) | 0.25 (1/9) |

- J-text matches the oracle, and its misses cost 0.01–0.03. Its pooled figure can come out under the oracle's because the oracle minimises per leaf, not pooled.
- J-image chose a 0.52 read over a 0.05 one on 6-b. Seeing the leaf made the judge worse, not better.
- Per-row picking was not needed, because J-text is within 0.05 of the oracle.
- Fable's gain is all on 8-b and 9-t, where no Opus read was good. Picking cannot create a good read where none exists.

**Rollout.** 303 written leaf pages (212 hand A, 91 hand B). Candidates: the stored fresh read, 2 new Opus reads (fresh.mjs prompt and crops unchanged), and a Fable read for the first 9 leaves only. Fable was dropped after those 9: one Fable read cost about 8× an Opus read on the account's meter ($1.86 against $0.23 at list price), enough to stop the run at about 80 leaves. The 3-Opus pool also passes the gate (0.20). Each page's warning quotes the figure for its own pool.

On the 206 edition-anchored leaves the pick goes in the `<note>` and the anchored text stays the OCR. Each candidate there is scored against the leaf's located span (`score_picks.py`):

| work | leaves | stored read | pick | oracle |
|---|---|---|---|---|
| Sāṅkhyakārikā | 14 | 0.42 | 0.31 | 0.29 |
| Jayamaṅgalā | 109 | 0.54 | 0.51 | 0.49 |
| Dīpikā | 63 | 0.54 | 0.53 | 0.52 |
| Tarkasaṃgraha | 23 | 0.54 | 0.52 | 0.50 |

- On the commentaries every read is near 0.5, so there is no good read to pick. Part of the Jayamaṅgalā is Malayalam (20-b), so its CER against the Sanskrit edition is only a rough signal.
- The judge kept the stored read on 99 of 303 leaves, about what chance among three would give.
- On hand B, 36 picks contain no letters. On 30 of them no candidate had any. On 4 (pp. 133, 143, 153, 201) the judge preferred an all-`[illegible]` read to one with a few letters.

**By eye** (this job's Opus session, full-resolution row crops; evidence type: image opened):
- *Hand A.* p. 13: rows 1 and 5–7 match the leaf; the pick fills in "ശെഷാണിതുപ", which the old read had as illegible. p. 310: the one written row matches (…ശ്രീവെദവ്യാസായനമഃ ശ്രീഗുരവെനമഃ). p. 6: rows 1–2, a title leaf (സാംഖ്യസപ്തതിഃ … ജയമംഗലന്നാമവ്യാഖ്യാനം), match.
- *Hand B.* p. 131: rows 1–2 and 6–7 match (the Tattvakaumudī close, SK 70 and the sixty topics). p. 220: rows 1 and 6–7 match (TK on SK 21). p. 216: rows 1 and 6 match; the middle segment of row 6 goes wrong at its end.
- So hand B is readable where Opus reads it. That contradicts the earlier "could read little" finding, which came from the fix job's 12 full-resolution reads.

**What it means.**
- Best-of-3 with a text-only judge is a cheap gain on text the model knows. On this manuscript's verse it brings a single read's 0.34 down to the oracle's ~0.2.
- It does little on commentaries. There, all reads are poor, so a better reader is needed, not a better picker.
- The text judge rewards fluency. On a famous text that coincides with accuracy, but it could also reward remembered text. The stability test's mask probe found no recitation on verse; commentaries were not probed.
- *Replicated?* The gate is one manuscript, 9 leaves, one judge model. The rollout scores are against located edition spans, and those are partly Malayalam.
- **Artifact.** `scripts/eval/results/whish147-bestof3-2026-10-23/`
