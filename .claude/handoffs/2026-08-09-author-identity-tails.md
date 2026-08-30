# Author-identity session — issues #3800/#3770/#3780/#3809 + USTC author coverage (2026-08-09)

## Merged PRs (all applied to production, all with backups + revert)
- **#3808** — 9 invalid Wikidata anchors repaired (`repair-invalid-author-anchors-3800.mjs`). 5 of 6 issue-suggested QIDs were wrong; live P31+P50+VIAF verification is non-negotiable (#3742).
- **#3810** — `[object Object]` guard at import boundary + exact repair of 3,151 books from MDZ manifests (GND ids in provenance).
- **#3812** — #3780 stages 1–3: enumerate unmatched author strings, classify via 8 subagents (1,588 persons), additively mint 1,506 docs + 84 variant appends.
- **#3817** — USTC author-coverage standing metric (exact floor + cluster estimate) wired into nightly `snapshot-stats.mjs`.
- **#3818** — d-nb.info JSON-LD parse fix (bare array, not `@graph`).
- **#3827** — the tails: #3809 anchor repairs (5 re-anchors, 4 unsets, liezi merge, 2 junk docs deleted), 146 no-Creator books resolved (~45 hand-attributed incl. 28 → Collegium Conimbricense), `backfill --include-institutions` (+2,944 links; tombstone exclusion fixed 114 orphaned entity links).

## Headline state
- `[object Object]` authors: **0** (was 3,297). Author-linking gap: **74.8% → 42.0% missing**.
- Work-id coverage incl. backlog: **93.2% → 97.5%** (`mint-local-work-ids --include-hidden`, 3,339 minted).
- Census rebuilt on Hetzner (50 min): 1.56M editions, in-SL **11,844** (was stale 4,220 from April).
- USTC author coverage (saved to `catalog_coverage_meta`, nightly series in `catalog_coverage_snapshots`): **157,880 census authors; we hold 15,068 exact / 19,515 cluster (9.5–12.4%), carrying 41.6–45.6% of authored editions**. Stable across the census rebuild.

## In flight (survives this session)
- `reconcile-authors-grounded.mjs --apply` — detached (nohup, local Mac), anchoring 2,879 unanchored author docs via flash-lite. Progress is in the DB — idempotent, re-runnable with the same command.

## Waiting on Derek
- **Delete the Test book** (`69afd33b7e835c55c61b4b00`, title/author "Test", year 1498, was VISIBLE) — now hidden with `hidden_reason`; deletion needs explicit confirmation. Its junk author doc `wikidata-sandbox` is already deleted.
- #3780 human queue: 11 uncertain bare forenames (Gregorius, Franciscus, Leo…), 6 compound strings — listed in issue comments.

## Known loose ends (issues carry them)
- ~350 anchors unchecked in the last validity sweep (WDQS 429/502 flaky day) — rerun `author-anchor-validity.mjs` to close the floor (noted in #3809's closing comment).
- 1,506 newly minted docs are unanchored until the reconcile pass reaches them; work resolvers gate on anchors.
- Repair backups copied from the (reapable) worktree to main checkout `scripts/output/`: anchor-tail-3809, object-object ×2, uri-author, additive-mint-3780, verdicts jsonl.

## Gotchas learned (recorded in invariants/memory)
- Additive-mint key collisions can land on a COMPOUND/conflated variant of an existing doc (Pictorius≠Marbode) — always print the causal variant; `EXCLUDE_APPEND` in the script. (author-identity.md)
- d-nb.info `lds.jsonld` is a bare array; lobid.org times out from this network. (auto-memory)
- MDZ Contributor ≠ author (mixes translators/referenced authors) — attribute only from the statement of responsibility, by hand.
- Slug-uniqueness across concurrent workers needs the claim-set recheck AFTER the await + E11000 retry (TOCTOU; first apply run crashed at 209/3297).
