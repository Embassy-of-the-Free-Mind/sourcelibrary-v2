# Proposed `.claude/docs/eval-design.md` §10.3 (#6740, Derek's steer 1)

The job could not write `.claude/docs/` (the harness treats it as a sensitive path). The section below goes in verbatim
after §10.2's last paragraph ("The 10-book floor, the "under 4" line and the 0.65 bound are **judgement calls** …").

---

### 10.3 Decide a route on defects per 1,000 words, against the live route (2026-10-30, #6740)

A page counted accept/reject treats one misleading numeral and ten as the same, and ignores how long the page is. On 2026-10-27 a Tibetan corrector raised page identity while it turned "seventh" into "nine". So:

1. **The rule is severity-weighted defect rates; accept k/n is a summary.**
   - Count every defect the judge tags, per 1,000 words of the text it read: cosmetic, misleads, wrong_text.
   - Compare within a script only: a Han character or a Tibetan syllable counts as one word.
   - Tools: `scripts/eval/route-judge-6740/defect-rate.mjs` → `defect-rate.py`. The router table shows the rates beside k/n (`router-table/defect-rates.json`).
   - A new OCR or translation record names its rates file in `defect_rates:` (enforced by `experiments-lint.mjs`).
2. **Weights:**
   - **Cosmetic = 0.**
   - **Misleads is a cost, not a gate.** One slip on a page is not a failed page.
   - **Wrong text is a gate.**
3. **The bar is the live route.** That is the route the table runs now, or the stored text readers already see. It is not perfection, and it is not Opus. A candidate passes when its wrong text is no worse than the live route's, within a stated margin (0.15 per 1,000 words in #6740). A cell with no text yet (scans only) needs an absolute ceiling instead.
4. **Calibrate the labels before weighting.** Re-read a sample of the tagged defects with a fresh call that sees only the quote and the leaf.
   - In #6740, 80 were re-read: 32 of 40 wrong_text and 25 of 40 misleads held up as real errors.
   - Severity moved both ways at the misleads/wrong_text line: 17 of the 40 misleads were called wrong_text.
   - So deflate the counts by the confirmed share, and never treat one tag as exact.
5. **Every judge run has a positive control.** Planted errors must come back quoted in a defect. In #6740:
   - Latin, German and French: 158 of 160 planted errors were quoted.
   - Tibetan: 16 of 20 were quoted, half of them as only cosmetic. There the judge's severities are a floor, and the Derge reference decides.
6. **QA a correction pass as span diffs, not page scores.** A defect on the corrected text whose quote is not in the draft was introduced by the correction. Report introduced and removed per 1,000 words beside the page-level verdict. In #6740:
   - agy Flash-low introduced 1.2 per 1,000 words on Latin print, most of them O6 word swaps.
   - Opus introduced none on Latin print and 0.7 per 1,000 words on German Flash-Lite drafts.
7. **Report quality the `quality-statements.md` way:** the measured rate and the measured errors, with n in books and the date. Neither harsh nor sugarcoated.
