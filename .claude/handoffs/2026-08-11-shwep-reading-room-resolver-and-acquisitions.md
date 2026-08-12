# SHWEP reading room — refresh, resolver audit, acquisitions (2026-08-10/11)

Branch: `worktree-feat+shwep-private-preview` (worktree `shwep-refresh`). Preview:
https://sourcelibrary-episode-sources.vercel.app/shwep — aliased to the build at
commit `2f7bb30e`, content-marker verified (ep 81 shows Justin Martyr; ep 121 shows
no Mythographi; ep 326 lands on McCown).

## Done this session

- **Episodes 324–327 added** (incremental scrape→extract→match→enrich via
  `_tmp-shwep-add-eps.mjs`; ep 327 has no public bibliography, renders bare).
- **"Acquire" audit:** 3 of 4 apparently-missing works were held (Hygromanteia =
  Anecdota Atheniensia ch.; Testament of Adam + Apollonios = Syriac Patrology I.2
  chs.). Sepher ha-Razim: no PD edition exists — honest gap.
- **Resolver work** (#3887/#3888, most merged by a parallel session): cited-edition-first
  bestEdition (28/30 vs 19/30 eval); cluster-expansion with volume-granularity
  post-filter; work-id-audit adjudications; Nonnos/Poimandres false positives killed.
- **Spot-check vs Earl's live pages** (7, 81, 104, 121, 219): found the hand-rejected
  Nonnos match had been RE-ADDED by the standing apply-recall pass → new
  `HAND_REJECTED_HOLDINGS` denylist in `shwep-cited-works.mjs` (verdicts must outlive
  regeneration — same pattern as HAND_PAGE_LINKS). Found ep-81 extraction miss
  (Eusebius HE + Justin Apology nested in one sentence) → rows/cards/verbatim quotes
  added.
- **Six PD books queued** (Derek approved, ~$2 OCR + translation): Corpus iuris civilis
  II, Livre du préfet, PL 40, ps-Plutarch Homer lives, Platonos dialogoi, Rosetta
  Stone. Rosetta needed: repoint to unrestricted IA twin `rosettastoneinbr0000sire`,
  then IIIF v3 zip-path URLs (only `full/max` accepted), then an uncapped archiver.
  4 books' translations submitted via Lambda FIFO; Corpus iuris + Livre auto-submit via
  detached watcher (`watcher2.sh`, this session's scratchpad, survives window close).
- **PR #3912 open:** `archive-ia-bulk.mjs` full/max by default (3000px cap now opt-in).
  Issue #3897 filed: audit all acquisition routes for resolution caps + metadata
  completeness.

## Next

1. **Reply to Earl** (his warm 2026-08-10 message awaits; letter artifact needs
   recasting; new preview URL — old link in sent mail is dead).
2. When translations land: **unhide protocol** for the six books (Mongo flip +
   Supabase sync + ISR revalidate + CF purge) + link on episodes (map in
   `/tmp/shwep-cited/gap-audit.md`).
3. #3887 refinement: multilingual title forms → re-offer the 84 dropped volume links.
4. Hippolytus-vs-Pseudo-Hippolytus attribution (left for Derek in work-id-audit).
5. PR #3912 review/merge.

Full state: auto-memory `project_shwep_reading_room_state.md`.
