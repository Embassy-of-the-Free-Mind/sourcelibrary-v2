# Fludd follow-ups: bylines, OCR, gallery tooling — 2026-08-27

Continuation of the Vol. 2 image-recovery session (same day, PR #4248). All work
merged/applied; nothing in flight except one production build (below).

## Applied to production data (run `fludd-byline-workgraph-2026-08-27`)

Two hand-adjudicated corrections, pattern copied from
`apply-aldine-byline-correction-3894.mjs` (no-clobber select, Supabase
`books_catalog` mirror + `updated_at`, `field_provenance` row with quoted
title-page evidence, `sweep_log` row, ISR revalidate). Backup with before-values:
`/tmp/fludd-byline-fixes-backup.json` (tmp — evidence also in field_provenance).

1. **`69b51dfe768235dc6598b0a8` Einleitung zur mathematischen Bücherkentnis** —
   was catalogued "Robert Fludd"; its own p7 prints "Johann Ephraim Scheibels
   Astronomische Bibliographie... 1616 biß 1630" (Breslau 1795). It's Scheibel's
   bibliography series *covering* Fludd's era. Byline → "Scheibel, Johann
   Ephraim", `author_id` unset (no thesaurus doc yet — T2 unlinked, additive
   minting will pick it up), work_id reminted (`hand-mint`). URL slug still ends
   `-fludd` (slugs frozen; cosmetic).
2. **`6a1db3501b32cb867ec5a18f` Das höchste Gut (Summum Bonum)** — NOT a dup: a
   typewritten GERMAN TRANSLATION typescript of Summum Bonum (BPH
   `bph:RIT004000006`). Fixed malformed "Fludd,, R." → "Robert Fludd" +
   `author_id`, merged into `local:a:robert-fludd:good-highest`
   (`work-merge:hand-adjudicated`), `text_role: translation`,
   `original_language: Latin`. Its `edition_key` still carries a wrong
   Gemini-guessed year 1621 — left for a broader edition_key pass.

## OCR + extraction (~$0.15, Derek-approved)

- Clavis Philosophiae `6a26c2e4aad44c98627c69ce`: 25 → **88/88** OCR.
- Das höchste Gut: 0 → **127/127** OCR. First submission failed "Invalid string
  length" (V8 cap on full-res BPH scans) — `--batch-size=40` fixed it; gotcha
  added to auto-memory `lesson_batch_ocr_bypasses_paused_pipeline`.
- Extraction passes (`--page-type-candidates`, conc 3) on both: **honest
  zeros** — 3+2 candidate pages, no gallery-worthy images. Neither book has
  plates. ISR revalidated (200 both).
- Remaining optional spend: translation (Clavis 63 Latin pages; DHG 127 German —
  itself a translation, so low priority). Pipeline paused; batch path when
  approved.

## PRs merged

- **#4260** `--reconcile --book=ID` on `reextract-missed-pages.mjs`: targeted
  gallery repair for books whose FIRST materialization failed (corpus scan
  selects on `detected_images_count`, written by materialization itself — the
  failure hides from its own repair; scanned 9,112 / fixed 0 on the Vol 2 case).
  Tested live against Vol 2 (correct "no gap"). Scripts-only, Hetzner auto-pull.
- **#4262** scholarly/bilingual EPUB figures now embed `extracted_url` crops
  instead of duplicating the full page scan (cover keeps full-page on purpose).
  `tsc` clean; NOT e2e-generated (route is session-gated + premium) — worth
  generating one for Vol 2 (`6952dac977f38f6761bc6cb0`, 119 gallery rows) to
  eyeball. **Production build was `● Building` at wrap-up** — post-deploy-warm
  purges automatically; if EPUB behavior seems absent, verify with
  `npx vercel ls sourcelibrary-v2 --meta githubCommitSha=f56d4d8e99d568ba7ffac57fc280cfb6afeb69a5`.

## Open threads (all logged on #4241 / #4246)

- #4241: honest coverage-audit script; backfill-run defaults (edge rate-limits
  at conc 10); gallery UX (no /book/[id]/gallery route, no extracted-crops
  download format — Derek's original ask #1); corpus reconcile still blind to
  failed-first-materialization (targeted flag is the recovery tool, noted
  out-of-scope on #4260).
- #4246 dedup hardening epic: Phase 0 (free, exclusion reporting) unstarted;
  Phase 1 (author_id backfill + judge re-run) needs spend approval.
- Reaper kept 3 worktrees with stranded uncommitted work from dead sessions:
  `fix+getty-csp-page-images`, `feat+corpus-dataset`, `feat-lexicon-lookup`.

## CLAUDE.md check

Up: nothing new — the reconcile blindness is an instance of the existing
"a bad write can erase its own repair path" corollary (Data Protection), and the
fix is documented in the script's own usage header where it fires. Down: no
demotions found this session.

## Round 2 (same evening, after "keep going")

- **Translations landed**: Clavis 87/88 pages English (was 25), Das höchste Gut
  124/127 (was 0; gaps are blank leaves). Batch API via
  `POST /api/books/<id>/batch-translate-async` with Bearer CRON_SECRET (~$0.25),
  collected with `collect-batch-results.mjs`, ISR revalidated. Fludd shortlist
  fully closed on #4241.
- **#4265 merged** (#4246 Phase 0): the work-merge judge prints an exclusion
  report + judged-coverage metric every run; `--coverage-only` is free. First
  measurement (on #4246): 19% coverage; 28,775 hidden text books WITH author_id
  are judge-blind (larger than the visible selection); 4,112 visible books
  missing author_id; 14 mega-authors (>50 items, 2,747 books) silently skipped —
  chunking strategy proposed on the issue.
- **Search verification** (Derek's ask): "divisions of the mind" → gallery TEXT
  lane (`/api/gallery?q=`) finds Vol 2 **p219** (printed 217, "De triplici
  animae in corpore visione") first among page hits, plus the same plate in a
  sibling scan and two standalone artwork records. Shortlink
  https://sourcelibrary.org/q/BekMFWOLaxCok1zerwB. NOTE: `q=` is the text param;
  `query=` is silently ignored (first probe returned tarot — wrong param, looked
  like broken search).
- **CLIP backfill**: 1,827 gallery rows missing clip_embeddings embedded on
  Hetzner (self-hosted CLIP, ~13 min, 0 failed). Visual lane ranks Fludd
  microcosm material for literal-visual phrasings; it cannot rank conceptual
  phrases ("divisions of the mind") — that's CLIP's nature, text lane is the
  conceptual lane. `gallery_text_embeddings` has its own cron
  (`image-embeddings-cron.mjs`, in `crontab.production`).

## Round 3 (into 2026-08-28: Phase 1 executed, mega pass, Johannes trapdoor)

- **#4246 Phase 1 run end-to-end**: author-link backfill `--include-backlog`
  (+879), judge `--include-backlog` shipped (PR #4277) and run (47,514 books,
  3,145 blocks, ~$1.50) → 2,040 HIGH groups / 6,687 books applied. Coverage
  7% → 19%.
- **`--mega` shipped (PR #4299) and run**: hierarchical chunked judging of the
  51 >50-item author blocks. 717 HIGH raw → screened (reason-text + size +
  Opera-title nets, then hand pass) → 659 groups / 2,870 books applied same
  night; 58 held. Screen rescued size-only single works; one rescue was itself
  wrong (Rhetorica bundle) — nets, not verdicts.
- **Hold set hand-adjudicated next morning**: 34 groups / 151 books applied
  (titled aggregates; same-edition volumes; identical bundles), 24 / 352
  REJECTED as collection-mixing. Artifacts:
  `scripts/output/llm-work-merge-*-2026-08-2{7,8}.json` (gitignored, on disk).
- **Bare-"Johannes" thesaurus trapdoor repaired** (run
  `jan-hus-bare-johannes-2026-08-28`): jan-hus doc carried variant "Johannes" →
  115 books by ~12 different Johannes-es linked to Hus. Variant pulled, 96
  unlinked, 13 title-explicit Sacrobosco editions → `johannes-de-sacro-bosco-2`
  (Q433841); Quaestiones commentaries deliberately not relinked (genitive names
  the commented text). jan-hus now 6 genuine books. KEY CORRECTION to the
  author-identity invariant's "de-matching is safe, every book has author_id":
  those author_ids can BE the poison — the link was minted FROM the unsafe
  variant. Check-issue filed (see below).
- **Day-end: coverage 25%** (11,704/47,418); missing-author_id ROSE to 4,669 —
  the repair returning de-poisoned books to the queue honestly.
- Remaining: additive-minting tail (4,669 visible + backlog) — review-heavy,
  fresh session; Sacrobosco duplicate author-doc pair merge; 24 rejected groups
  are closed-won't-merge.
