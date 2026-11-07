<!-- PRIOR ART: scripts/eval/route-judge-6740/RULE.md shape (a rule fixed before judging); the floor itself is the one the
#7947 write-up named (2026-11-02-latin-strata-why-latin-struggles-7947.md, §5). Committed before any judge call. -->
# #7947 reader test — the rule, fixed before judging (2026-11-03)

**Sets** (`sets.mjs`, the #7947 draw, not re-drawn).
- `ms`: the 26 lite-read manuscript books (form on the image = manuscript, all 3 drawn pages Flash-Lite, the 3
  microfilm-strip books out), 78 pages.
- `inc`: the 1450–1500 print cell, 8 books, 24 pages (7 Flash-Lite books, 1 Gemini 3 Flash).

**Arms.** `ms`: S stored (Flash-Lite), A agy 3.8 Flash low fresh read 4 a call (`cli-ocr.mjs read --per-call=4`, the
drawn page first in a block of 4 consecutive pages), B arm c (PERO GPU draft → agy Flash low correction with the image
on the #7263 template, `--over-stored`, and the E3 put-back against the stored text as `cli-ocr.mjs apply` does it),
C Opus manuscript reader (`claude-ocr.mjs --reread`, one page a call). `inc`: S stored, A as above, L lite>opus
(`ocr-convergence/correct.mjs --model=opus`, as #5924 ran it; an UNCHANGED or CONTAIN answer serves S).
An arm that returns nothing usable for a page (no read, refusal, CONTAIN, UNCHANGED) serves S on that page: that is
what the route would leave a reader.

**Judge.** One fresh Opus reader per book (`claude -p`), `REVIEWER.md` verbatim plus `JUDGE-ADDENDUM.md` (no
translation; several transcriptions of the same pages under neutral labels, order shuffled per book with a seeded RNG).
Arm identity is in a key file outside the packet folder. A second Opus reader with `SECOND-READER.md` on every serious
call of every arm, blind to arm.

**Measures** (confirmed calls; OCR and page lanes only, `tr` is empty).
- sense errors per 1,000 words: confirmed serious calls / the stored page's word count (one denominator for every arm),
  with a book-cluster bootstrap 95% CI.
- `accept` k/n: pages with no confirmed serious call. `wrong_text` k/n: pages with a confirmed serious call of text not
  on the leaf (I1/I2 wrong leaf, O1–O3 invented, or the reviewer's words say invented / not on the page).

**Floor (per set; the write-up's).** An arm clears the floor when, against S judged in the same packets,
1. its confirmed sense-error rate per 1,000 words is at most half of S's, and
2. no page gains invented text: no page where the arm has a confirmed wrong-text call and S has none.
`inc` adds the write-up's "no page stays wrong or mostly wrong": no page with ocr_score ≤ 2 under the arm.
The cheapest arm that clears it is named in the DECISION (cost order: B < A < C / L). If none clears, the DECISION names
the best arm and says it does not clear.
