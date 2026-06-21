# First-Translation Verification — Runbook & State (2026-06-21)

*Single source of truth for the audit/verification work. Companion to
`first-translation-system.md` (the system) and `ft-first-translation-paper.md`
(the paper). Issue: #2564.*

## 1. Purpose
Turn the public claim **"~6,000 first English translations"** from "trust us" into
**"N ± CI, with the evidence for every one."** Correct wrong badges, surface hidden
firsts, build a linked + auditable translation catalog.

## 2. Method — two-stage, verify-before-write
A single AI pass **cannot** be trusted to write a public claim (proven: ~63% of its
demote priors were fabricated). So:

- **Stage 1 — grounded adjudication** (`scripts/eval/ft-gemini-adjudicate.mjs`):
  per book, a Gemini call *with Google Search* identifies the work, searches
  tradition-appropriate sources, returns a verdict + the prior found + the queries.
  Captures evidence. **Over-claims** — candidate generation only.
  - Root cause fixed today: `thinkingConfig:{thinkingBudget:-1}` silently *suppressed*
    grounding; removed → it actually searches. `web.title` (not the vertexaisearch
    redirect `web.uri`) carries the real source domain.
- **Stage 2 — verification gate** (skeptical, independent): tries to *refute* Stage 1.
  Demote → verify the prior is real+complete. Promote → search hard to *find* a prior.
  Only survivors are written. Captures queries; logged to the provenance store.

**Three write surfaces, all verified-only:**
| Surface | Store | What |
|---|---|---|
| Badge | Mongo `books.is_first_translation` (+ `books.first_translation`) | the public claim — only verified flips, backed up |
| Catalog | Supabase `translation_catalogs` (`source='sl_ft_llm_claim'`) | verified priors, with `source_url` link + completeness |
| Provenance | Mongo `first_translation_attempts` | every adjudication + verification, **with its search queries** |

## 3. Runs done (all data → `scripts/output/ft-evidence-2026-06-21/`)
| Run | Population | n | Stage | Result | File |
|---|---|---|---|---|---|
| rand300 | public never-assessed | 300 | 1 | recall 21.3% strict | `ft-rand300.jsonl` |
| redo-589 | vague "Various" catalog rows | 506 works | 1 | 225 first / 206 prior / 61 NA | `ft-redo589.jsonl` |
| 530-book | source books of the vague rows | 530 | 1 | 115 demote / 25 promote / 248 confirm | `ft-530.jsonl`, `ft-530-reconcile.json` |
| demote-gate | the 115 demotes | 115 | 2 | **43 real / 49 fabricated / 22 partial** | `ft-demote-gate.jsonl` |
| promote-gate | the 25 promotes | 25 | 2 | **18 real / 6 prior-found** | `ft-promote-gate.jsonl` |
| precision-200 | random *public badged* | 200 | 1+2 | **87% verified badge-correct (82–91%)** | `ft-prec200.jsonl`, `ft-prec-demote-verified.json` |
| hidden-150 | random hidden-translated | 148 | 1 | 53% strict first (Stage-1) | `ft-hidden150.jsonl` |
| hidden-firsts verify | the 99 hidden Stage-1-firsts | 99 | 2 | *(running — see §6)* | `ft-hidden-firsts-verified.json` |

## 4. DB writes made (durable, reversible)
- **Catalog:** redo-589 applied — 347 rows updated (precise translator + year + link),
  224 deleted (157 false-prior + 67 container). +51 verified priors added (with URLs).
  `sl_ft_llm_claim` now **2,743** rows. Backup: `ft-redo589-backup-2026-06-21.json`.
- **Provenance log:** **995** rows (was 5). 850 adjudications + 140 gate verifications.
  *(Pending: ingest precision-200 verify + hidden verifications — §6.)*
- **Badges:** 43 demoted + 18 promoted = **61** changes, all verified.
  Backups: `ft-demote-applied-backup.json`, `ft-promote-applied-backup.json`.
  Public badged-first: 5,696 → ~5,677.
- New column added: `translation_catalogs.source_url` (Supabase, via SUPABASE_DB_URL in
  secret-lover). Junk-translator guard + source_url mapping on PR #2633.

## 5. Headline numbers
- **Public flag precision (verified): 87%** (82–91%) → of 5,677 badges, ~4,940 right,
  ~680 wrong (~360 real prior → demote, ~210 category errors).
- **Public recall (Stage-1): 21% strict** → ~2,100 missed firsts in the never-assessed pool.
- **Hidden books: ~4,480 translated-hidden; first-rate ~53% strict (Stage-1).** Verified
  count pending (§6). Triage: ~53% are publishable (PD, complete, not dup) → ~2,400
  finished translated books sitting dark.
- **Catalog split (books vs artwork):** books 26,637 (16,234 visible / 10,403 hidden,
  10,278 with content); artwork 26,392 (14,700 visible / 11,692 hidden, of which 11,644
  are *uningested* Wikimedia/museum stubs — a gallery-curation question, not a book one).

## 6. Pending / open
- [ ] **Ingest the latest verifications into the provenance log** (precision-200's 37,
  hidden-firsts' 99) — currently file-only.
- [ ] **Hidden-firsts Stage-2 verify** finishing → gives the *measured* hidden-first count
  (replaces the Stage-1 ~2,400 / haircut estimate).
- [x] ~~Works resolution~~ — **already done**: 99% of FT-badged books carry `work_id`
  (5,784/5,832), incl. 59/61 we touched. The "12%" in early #2564 is stale.
- [ ] **`#2395` original-edition linkage is the real gap** — `original_edition_id` /
  `original_missing` is **0/61** on the books we changed. A verified first-translation
  means the book IS a translation; nothing yet records whether we hold its source-language
  ORIGINAL. Since `work_id` is populated, cluster each first's work and check the cluster
  for an original-language edition → set `original_edition_id` or `original_missing`.
- [ ] **`original_language` is null on ~92%** of touched books — a data-quality gap that
  weakens the source-language rule.
- [ ] **Full enumeration** — Stage-1 over all 7,306 never-assessed (~$75, gated on Derek)
  → Stage-2 on the flips → corrected badges + the honest number ± CI.
- [ ] **Hidden un-hide pass** — verify + surface the ~2,400 publishable hidden books
  (through the badge-verify gate). The biggest reader-facing unlock.
- [ ] **Human/specialist gold standard** — the de-circularising final layer (breaks the
  AI-vs-AI correlated-error ceiling). Tooling: PR #2614.
- [ ] **Land plumbing PRs:** #2634 (Sink A ingest), #2633 (Sink C harvest + source_url).
- [ ] **Reusable tool committed:** `scripts/maintenance/ingest-ft-attempts.mjs`
  (evidence → provenance log). The per-run gates were scratch scripts — fold into the
  build-lane pipeline rather than re-writing.

## 6b. Related work — what this connects to
| System | Status vs this effort |
|---|---|
| **#2318 work identity (`work_id`)** | ✅ populated (99%) — firsts already cluster to works |
| **#2395 translation layer (`text_role` / `original_edition_id` / `original_missing`)** | ⚠️ **the real gap** — "do we hold the source original?" is empty (0/61). Wire via `work_id` cluster. |
| **#2179 canonical authors (`author_id`)** | ✅ mostly linked (44/61) |
| **Translation census / gap-site** (`translation_catalogs`) | feeds it — our verified additions improve it; re-sync after writes |
| **Public provenance widget** (review #9) | ❌ **unbuilt payoff** — we now have the evidence (995-row log w/ queries); the reader-facing "established by searching X, none found [date]" badge is the credibility moat |
| **Scholarly editions / DOI (Zenodo)** | verified firsts are citable-edition candidates — downstream pipeline |
| **Hidden un-hide / launch workflow** | the ~2,400 publishable hidden books; gate the badge at un-hide time |

## 7. Reproduce / continue
```bash
set -a; source .env.production.local; set +a
# Stage 1 (grounded adjudication) — runs in the worktree (has @google/genai):
cd .claude/worktrees/feat+ft-rebuild
node scripts/eval/ft-gemini-adjudicate.mjs <worklist.json> <out.jsonl> --concurrency=10
# Stage 2 (verification gate — the binding step; replaces the scratch gates):
node scripts/eval/ft-verify-gate.mjs <stage1.jsonl> --direction demote|promote
#   → writes survivors + appends verification attempts (with queries) to the log
# Ingest Stage-1 evidence → provenance log:
node scripts/maintenance/ingest-ft-attempts.mjs <out.jsonl> --apply
# Catalog (verified priors only) via the #2633 harvester --from-enum --apply
# DDL needs the pooler: SUPABASE_DB_URL in secret-lover (direct host is IPv6-only)
```
