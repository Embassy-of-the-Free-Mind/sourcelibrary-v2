---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 1
n_pages: 435
verdict: "NO-GO for the Flash 3.8 LOW correction pass. On the gate volume (Thadrak Kanjur rGyud 'bum Kha, 435 pages), a blind Opus audit of 40 changed pages, judging each changed span against the leaf, finds 10 of 40 pages worse with full-resolution tiles (the leaf shows the correction at 178 of 239 decided spans, 74% [69, 80]). Pooled over both judges, 6 of 40 pages are worse. The bar was at most 2. The judge without tiles finds 2 of 40, but it abstained on 46% of spans and on 37 of 80 controls. Judge agreement on the decided spans: α 0.44, not settled. The ya-btags guard fired once in 432 pages."
status: rejected
decision: "Flash low correction pass not applied; nothing written to pages (#6560 gate)"
superseded_by: null
issue: [6560]
---
## 2026-10-15 · Flash low correction pass, gate volume (#6560)

PRIOR ART: `2026-10-13-tibetan-flash38-correct-6560.md` is the 30-folio test that recommended this pass (Flash low:
30 of 30 folios better against Derge). This entry is the volume-scale gate Derek set on 2026-10-14: one volume, a
blind Opus audit of 40 changed pages, and GO only if at most 2 of 40 are worse.

**Run.** Tooling: `scripts/eval/tibetan-correct-6560/pass/` (README section "The volume pass").
- **Frame:** Yigdzin SERVE pages in visible or held books. That is 1,979 books and 675,986 pages, 211 of the books
  Kangyur volumes (92,801 pages).
- **Gate volume:** the oldest Kangyur volume of at most 500 pages, `69e7aaba80b52390feb199b8` (Thadrak Kanjur
  rGyud 'bum Kha, tantra).
- **Read:** 435 pages through `cli-ocr.mjs read --correct-prompt` (the eval's CORR request exactly), 2 in flight.
  13 transient agy 503s were re-read. $0. Nothing written to Mongo.
- **Dry apply:** 432 pages would be written. 2 were refused for changing 32% and 36% of the draft's syllables. 1 was
  held by the ya-btags guard. The median change is 0.9% of syllables.

**ya-btags guard (hit rate asked for in #6560).** It fired on 1 change (མོས→མྱོས) on 1 page of 432 (0.2%). The
30 Kangyur folios had 10 hits. This volume's 520 draft syllables of the form མི/མེ… drew no ya-btags change. Opus
answered "unclear" on the one hit, so it would have been put back.

**Audit.** `leafcheck.mjs audit-req`: 40 pages drawn by seed from the 393 changed pages apply would write, 280
changed spans, and 2 known-answer controls per page. The instrument is `score.py`'s READOFF: A/B blind, context from
the draft, and fresh `claude -p` Opus with only the Read tool.

| judge | worse / same / better (of 40) | leaf shows the correction (decided spans) | spans unclear | controls right / wrong / unclear |
|---|---|---|---|---|
| A: full frame (Read shows it at 2000 px) | 2 / 16 / 22 | 133 of 149 (89%) | 130 of 280 | 43 / 0 / 37 |
| B: full frame + 4 full-resolution tiles | **10** / 6 / 24 | 178 of 239 (74% [69, 80]) | 35 of 280 | 67 / 3 / 10 |
| pooled (spans where the judges disagree cancel) | **6** / 5 / 29 | 200 of 240 (83% [78, 88]) | 17 | — |

- Judge agreement, eval-design.md §2:
  - span answer: α −0.01, 280 spans, **not settled** (A abstains where B decides);
  - leaf side where both judges decided: α 0.44, 125 spans, **not settled**.
  
  All 40 pages come from one book, so the by-book bootstrap interval is degenerate.
- **Judge B is the one to trust.** Judge A said on 27 of 40 pages that it saw the frame shrunk to 2000×1333. It
  could not see a subscribed letter or a vowel sign, so it abstained. Every rate quoted from judge A is not settled.
- **Checked by eye:** page 192, line 3. The leaf reads མཉེན་པར་བགྱི, as the draft has it. Flash wrote མཉེས. Judge B
  was right.
- **What the leaf contradicts:** the 61 spans where judge B saw the draft fall into four kinds.
  - Particle and spelling normalisation: ཀྱི→ཀྱིས, གྱི→གྱིས, བསྒོམས→བསྒོམ, ཕྱགས→ཕྱག, བརྟེན→བརྟན.
  - Mantra diacritics: ཀྵི→ཀྵཱི, ཨེ→ཨཻ, སྟ→སྟྭ, ལྃ→ལཾ.
  - Substituted words: ཐོན→གནོད, ལྷ→ལགས twice, གསུངས→བསམ, ལྗང་མ→ལྕགས.
  - Dropped or added words: འདི་དག་ནི and ཕན dropped; བོ and འཇིགས་པར་བྱེད་པ added.
  
  These are the changes a Derge identity score rewards (it normalises) and the leaf does not.

**Why the 30-folio test and this gate disagree.** The test scored against the Derge e-text. Agreement with Derge
partly rewards normalising to the print, as the test's own write-up warned. This gate scores against the leaf. The
gate volume is also a tantra, dense with mantra and its own spellings, where normalising costs most.

**Decision.** Gate failed: 10 of 40 pages are worse (pooled 6), and the bar was at most 2. Nothing was applied, and
the pass does not continue to further volumes. What would change this: a corrector the leaf agrees with at ≥ 95% of
decided spans on a held-out volume, judged with tiles. Options are Flash with a prompt that forbids normalising
particles, spellings and mantra, or a correction limited to syllables the Yigdzin read flags as low-confidence.

Artifacts: `scripts/eval/results/tibetan-correct-6560/pass-gate-69e7aaba80b52390feb199b8/` (the reads, the guard and
audit requests and replies, and `audit-judges.json.gz`).
