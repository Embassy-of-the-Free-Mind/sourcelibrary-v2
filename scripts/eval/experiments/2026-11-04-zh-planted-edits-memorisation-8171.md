---
stage: translation
measure: [judged, accuracy]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 100
n_pages: 100
verdict: "Planted sense-changing edits find memorisation in famous texts but no extra recall on the CBETA/Kanripo pages our Chinese instruments use. Flash 3.8 low keeps a planted edit in a punctuated copy 55% of the time in famous texts (A, 20 works), 95% on reference-covered pages (B, 40), 97% on obscure pages (C, 40): A−C −42 [−61, −25], B−C −2.4 [−7.5, +2.6]. In English: A 20%, B 72%, C 69%: A−C −49 [−63, −33], B−C +3.1 [−9.6, +15.6]. Under the preregistered rule: keep the references. The punctuation test would have seen a 10-point B deficit; the translation test could have missed a gap up to ~18 points."
status: informational
decision: "none — decision rule branch 3 (keep the references in use, stating the gap); #6101, #8146 rule 2 and #8134 test 2 stand as written (#8171)"
feeds: [reference]
superseded_by: null
issue: [8171]
router_evidence: "none — a memorisation probe on text input; no route compared"
defect_rates: "none — scored per planted site (follow / revert / neither), not page defects"
---
## 2026-11-04 · Do our Chinese reference texts measure recall? Planted edits in famous, reference-covered and obscure passages (#8171)

PRIOR ART: `.claude/docs/ocr-memorization-paper.md`; `2026-10-01-fingerprint-test-…-5549.md` (no power, leaked
packets: this run plants edits instead of fingerprinting misreads, and no packet carries a title or a second passage);
`zh-punct-8140` on PR #8146 (the punctuation prompt, verbatim, and the LCS idea); `scripts/eval/lib/paired-stats.mjs`
(the PRNG). New code: `scripts/eval/zh-planted-8171/` (`lib.mjs` planter and P scorer, `judge.mjs`, `score.mjs`).

Preregistered: `scripts/eval/zh-planted-8171/PREREGISTRATION.md`, commit dd295d5d7, before any arm ran. The decision rule
and its operational definitions are unchanged. Results: `scripts/eval/results/zh-planted-8171/` (`scores.json`: one row
per arm, task and site, ids and outcomes only; `summary.md`: every cell). No CBETA or Kanripo text is committed here or in
the results.

### Design (short; the prereg has it all)

- **A**, 20 famous works (論語, 孟子, 老子, 心經, 金剛經 …, Kanripo text); **B**, 40 reference-covered pages (B-strict 20:
  the 19 CBETA works of #6101/#8140 and the 佩文韻府 page of #8134 test 2; B-ext 20: Kanripo-screened Siku works);
  **C**, 40 obscure non-Siku Chinese pages (no Kanripo title, not CBETA, one quoted web search of a 12-character string
  with no hit, edits only in windows Opus confirmed against the page image). One passage per work, 100–260 Han characters.
- 296 seeded edits (A 60, B 120, C 116): negation removed or added, 有↔無, a number, a name. All 296 hand-labelled before
  any arm ran (o clean / c cued / b ungrammatical). The seeded one-in-five subset that the brief asks for has 55 edits:
  A o 2 / c 11 / b 1, B 13 / 8 / 1, C 12 / 4 / 3. Over all 296: A o 13 / c 41 / b 6, B 53 / 56 / 11, C 65 / 38 / 13.
  **A is heavily cued**: famous texts are parallel and formulaic, so a planted 不 often breaks a visible parallel.
- Arms: **G** gemini-3.8-flash-low on agy (100 edited + 20 unedited baselines, both tasks); **G2**, G again on a 30-passage
  subset (noise floor); **O** Opus on `claude -p`, text only, the same 30. No title or attribution in any prompt.
- Tasks: **T** translate (production's Standard Translation prompt via `buildTranslationPrompt`); **P** repeat with
  punctuation (#8140's prompt). P is scored exactly (LCS alignment at each site); T by a blind Opus judge that sees each
  site as two readings in seeded order.

### Judge controls (gate passed)

20 unedited-baseline translations: the judge picked the true (original) reading on 57/59 sites (96.6%), the planted one on
0 (gate ≥ 85% and ≤ 5%). 6 wrong-passage controls: "neither" on 17/17 sites (gate ≥ 80%). T is read for the decision.

### Results (G; follow rate %, 95% passage-bootstrap CI; judged edits / passages)

| task | A | B | B-strict | B-ext | C | A − C | B − C |
|---|---|---|---|---|---|---|---|
| P punctuate | 55.0 [38, 72] 60/20 | 95.0 [91, 98] 120/40 | 95.0 [87, 100] | 95.0 [90, 100] | 97.4 [94, 100] 116/40 | −42.4 [−60.8, −24.9] | −2.4 [−7.5, +2.6] |
| T translate | 20.0 [8, 32] 60/20 | 71.8 [63, 80] 117/40 | 75.9 [65, 85] | 67.8 [53, 81] | 68.7 [59, 78] 115/40 | −48.7 [−63.3, −33.2] | +3.1 [−9.6, +15.6] |

Revert rates (the rest is "neither"): P A 45.0, B 3.3, C 1.7; T A 80.0, B 26.5, C 27.0.

- **Clean-only edits (o)**, the check on A's cueing: P A 69.2 (13 edits) vs C 98.5 (65), A − C −29.2 [−62.5, +2.9];
  B 100 (53). T A 53.8 vs C 87.7, A − C −33.8 [−64.1, −0.5]; B − C −1.2 [−12.0, +9.8]. A still reverts more on clean
  edits in English; in the copy the interval just reaches 0 on 13 edits.
- **By category (T, G)**: negation A 7 / B 64 / C 62; number A 67 / B 70 / C 82; name A 17 / B 96 / C 50 (C has 8 name
  edits). Negation is where English drifts back everywhere: an obscure passage with a planted 不 is "corrected" by sense
  in a third of cases. That is reasoning, not recall, and it is why only the gap to C is read.
- **Noise floor (subset, 30 passages, 90 sites)**: G and G2 give the same outcome on 82/90 sites for P and 80/90 for T;
  G2's group gaps match G's (P A − C −33 vs −30; T −47 vs −43). Unedited P copies changed 0 of 59 sites.
- **Opus (subset)**: P follows every edit in every group (30/30 each): it does not rewrite a copy from memory at all.
  T: A 53.3, B 69.0, C 75.0; A − C −21.7 [−53.3, +9.0] on 10 passages a group, so Opus's A does not clearly fire. Opus
  flags the place far more than Flash: 26/30 A sites, 13/29 B, 14/28 C (Flash: 6/60, 8/117, 5/115), and it flags
  edits it follows as well as ones it reverts, i.e. it notes "the text says X; one expects Y" rather than silently
  restoring.
- **Flags vs silent reverts (G)**: of 48 A reverts in English, 5 were flagged; 43 silent.
- Example from C (our own OCR of a public-domain page, C-fedab5-p5): planted 最可厭處 → 最不可厭處 ("most [not]
  detestable"); Flash's English rendered the unplanted sense, without a note: an obscure-text revert by sense.

### Decision under the preregistered rule

Both tasks: **A fires** (A − C intervals entirely below 0) and **B − C is inside the interval** → branch 3: **keep the
CBETA and Kanripo references in use.** Gap this test could have detected (80% power, from the observed SE): about
**7 points** for P and **about 18 points** for T. So: a 10-point recall bonus on the reference pages is ruled out for the
punctuation task (the one #8146 rule 2 scores against CBETA); for English (#8134 test 2's kind of comparison), a
bonus below ~18 points is not excluded. B-strict (the pages actually used) and B-ext give the same answer.

### Not established

- This tests **text input**: translating and copying a given text. It does not test reading an image, so it does not
  settle OCR memorisation (#6101 is an OCR score from images).
- Obscurity of C is a title check and one weak web search, not absence from training data.
- C's OCR may be wrong outside the confirmed windows, which makes C less recoverable by sense (biases C's follow rate up,
  i.e. toward finding a B − C deficit; none was found).
- Opus is 30 passages: its arm describes, it does not decide.

Calls: agy 300 (cap 400), pool `.agy-milo`, never under its floor; Claude 239 (cap 300; 60 earlier calls that failed on an
inherited API key, zero subscription use, are kept apart in the job's ledger). $0 API.
