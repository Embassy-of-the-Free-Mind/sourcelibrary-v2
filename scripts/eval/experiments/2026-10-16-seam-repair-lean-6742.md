---
stage: translation
measure: [judged, judged_vs_reference]
languages: []
scripts: []
canons: []
n_books: 843
n_pages: 5600
verdict: "Gemini 3.8 Flash via agy repairs page joins as well as Opus (verified yield 36.7% vs 36.3% on the 300-junction set, 1/118 judged worse), so the lean runner sends the tranche to Gemini and spends Claude only on a 7% blind sample: ≈ $0.12 list (≈ 0.01 weekly points) of Claude per 100 joins vs the pilot's ≈ 0.6 points. Rule-only fixes for catchword echo and dup8 match Opus on 78% and 60%, below the 95% bar; neither is trusted."
status: undecided
decision: null
superseded_by: null
issue: 6742
---
## 2026-10-16 · Seam repair, lean: rule fixes, Gemini via agy, and a runner that spends Claude only on a sample (#6742)

PRIOR ART: `2026-10-15-seam-repair-pilot-6742.md` (the $0 Opus pilot; 227 joins written). Its prompt, placement check,
blind judge, write path, manifest and undo (`seam-repair.mjs`) are reused unchanged. `2026-10-15-seams-scale-opus-flashlite-6742.md`
holds the 300-junction set with Opus labels. The pilot cost ≈ 0.6 weekly Opus points per 100 joins (24 calls),
about 20 account-weeks for the ~330K tranche. This entry tests two cheaper repairers, then builds and dry-runs a runner.

**Test A: deterministic rules, no model.** Sample: the pilot's 500 tranche joins. Their excerpts were rebuilt from
Mongo: the current text where the hash matched, else the `seam-repair-6742` revision pre-image. All 500 were
recovered; Opus's `repairCheck` agrees on 386/386.
- Catchword echo rule: the same 1–6 words end N and open N+1. The source decides which side keeps them:
  - a hyphen split or split remnant stays on N, so N+1 loses it;
  - a printed catchword belongs to N+1, so N loses it;
  - with no source cause, the rule declines.
- dup8 rule: an 8+-word run that ends N and opens N+1 is removed on the side whose English/source ratio it inflates.
- Agreement measure: "equivalent" means the same join text after whitespace and punctuation are normalised.

| signal | joins | rule edits | equivalent to Opus's repair | edits on Opus-ok joins | declined |
|---|---:|---:|---:|---:|---:|
| catchwordEcho | 185 | 122 | 84/108 = **78%** (69–85) | 10/122 = **8.2%** | 62 |
| dup8 | 117 | 15 | 9/15 = **60%** (36–80) | 0 | 101 |

- The bar was ≥ 95% equivalent and ≤ 2% edits on Opus-ok joins. **Neither signal is trusted.**
- On 13 of the 24 echo misses, Opus also rewords or reorders the words.
- The 10 edits on Opus-ok joins are real false positives: liturgical repeats, speaker turns, and a split noun next to a different verb.
- Most dup8 joins are not facing-edge duplicates (75 of 117). Opus's repairs there move or retranslate text, which a deletion cannot reproduce.
- These rules were designed and scored on the same 500 joins, so the rates are optimistic.

**Test B: Gemini 3.8 Flash (low) via agy as the repairer.** Gemini used the pilot's single-join prompt over the
#6742 300-junction set, one join per call. Its repairs went through the pilot's placement check and the pilot's blind
Opus judge (both orders, 10 pairs per call, 10 A/A pairs per arm). The Opus reference repairs were re-judged in the
same session.

| | Gemini (agy) | Opus |
|---|---:|---:|
| labelled defective | 136 | 131 |
| placed | 118 | 114 |
| judge prefers the repair in both orders | **110** | **109** |
| verified yield (/300) | **36.7%** | **36.3%** |
| judged worse in both orders | 1 (0.8% of placed) | 0 |
| plants caught and verified | 28/30 | 28/30 |
| A/A pairs called tie | 20/20 | 20/20 |

- Both arms verified the same 93 joins; 17 were Gemini-only and 16 Opus-only.
- The one worse repair: Gemini closed a Greek sentence at a chapter break with an invented `[life]`.
- Gate: yield within 10 points of Opus and ≤ 2% worse. **Passed (gap +0.4 points).**
- Gemini cost: ~10K input and ~2.8K output tokens per join, 27 s per call. agy is a subscription, so this is $0.

**The lean runner** (`scripts/maintenance/seam-repair-6742/lean.mjs`).
- Candidates: every tranche join in the most-read books first. Readership is distinct (ip, day) per book in
  `analytics_pageviews` over 60 days, the instrument of `ocr-convergence/driver.mjs frame`.
- Tier 1: rules, for the signals Test A trusts. That set is empty.
- Tier 2: Gemini with tight windows: ~2 English sentences either side and the matching share of the source,
  ~700 characters against the pilot's ~3,000. Opus at 30 joins per call is the fallback.
- Placement: the pilot's checks, plus a new content-conservation guard. A repair is refused if more than 3 content
  words vanish from the join.
- Verification: a 7% blind Opus sample, minimum 20, both orders, with an A/A pair. Below 90% preferred, nothing is
  written and a DECISION line goes to the digest.
- Writes: `writePageTranslation`, labelled `seam-repair-6742`, with the pilot's manifest and undo.
- Guard: stops when the box's account is ≥ 60% weekly (read the way `spare-lane.py` does).

**Dry run: 2,000 candidates, 43 books (views 567 → 170), no writes.**
- Tier split: tier 1 = 0, tier 2 = 2,000 (Gemini). 7 of 2,000 agy calls failed.
- Placed: 1,267 (63%). Refusals:
  - 278 labelled ok, 175 with no repair;
  - 158 that drop content words, 75 touching more than 3 sentences, 30 edits too large;
  - 17 other.
- 7% sample: preferred in both orders **85/89 = 95.5%**, judged worse 0, A/A a tie. That clears the 90% floor.
- Would write **967 joins (1,477 pages)**. 300 placed repairs were refused against the stored text. 239 joins mapped
  only through the new tag-aware path (`mapProjected`), counted before the structure guard below; before it, the pilot lost 61/304 joins this way.
- Calls per 100 joins: 100 agy and 0.9 Opus (judge only). The pilot used 24 Opus calls per 100 joins.
- **Claude per 100 joins: $0.12 list-equivalent. At the pilot's ratio (0.6 points ≈ $7.6 list), that is ≈ 0.01
  weekly points, against the pilot's 0.6.**
  - The account meter read weekly 28% → 35% over the 4.4 h run. That account was shared with other jobs, so 0.35
    points per 100 joins is only an upper bound.
- Opus fallback, measured on 60 of the same candidates: 2 repair calls, $1.43 list per 100 joins for repair. With the
  sample, that is ≈ 0.12 points per 100 joins, 35 placed, sample 20/20.
- Throughput at 4 agy calls in flight, box load 25–35: 460 joins/h, ≈ 220 written joins/h.

**Guards added because the dry run needed them.**
- `lostWords`: Gemini proposed deleting a title-page head, and replacing a dedication with "[This page is blank.]".
  Both passed the pilot's placement checks.
- `mapProjected`: maps edits that cross `<term>`, `<gloss>`, `->…<-` or headings. Only the changed words are
  rewritten, and an edit inside or against markup is refused.
- `structureRefusal` (both mapping paths): refuses an insertion that would land inside a `**bold**` heading, and edits
  on `| table |` rows. The dry run produced both.
- Gemini also labelled 59 joins in 18 books with "not a translation of its source".
  - The leads concentrate in *Utriusque Cosmi Historia*, the Chun Ts'ew, and the Summae de casibus.
  - They are listed in `dry-run/not-a-translation-flags.json`. They are model claims from text windows, not
    image-checked, so they are leads for a containment check, not findings.
  - The content guard keeps the runner from "fixing" them by deletion.

**Scale.** The ~330K-join tranche costs ≈ 30 weekly Opus points in total on the sample, against ≈ 2,000 for the
pilot. Writes would cover ~48% of joins. The binding constraints are now agy calls (one per join; the account makes
~10K per day) and wall time: ~2,700 joins per 6 h night at 4 calls in flight, ≈ 120 nights.

Proposed cron entry, not installed:
`30 1 * * * cd /root/sourcelibrary && flock -n /tmp/sl-seam-lean.lock bash -c 'set -a; source .env.production.local; set +a; node scripts/maintenance/seam-repair-6742/lean.mjs night --out=/mnt/HC_Volume_105839809/seam-lean-6742 --max-joins=2500 --apply' >> /var/log/sourcelibrary/seam-lean.log 2>&1`

Data: `scripts/eval/results/seam-lean-6742/` (README there). Scripts: `rules.mjs`, `score-rules.mjs`,
`gemini-repair.mjs`, `lean.mjs`, with the pilot's `seam-repair.mjs` extended (`writeRepairs`, `mapProjected`,
`structureRefusal`). Tests: `tests/unit/seam-repair-lean.test.ts`.
