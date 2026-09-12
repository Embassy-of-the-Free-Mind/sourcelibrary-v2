# Six-issue agent batch, the residential fleet, and the revalidate chain — 2026-08-31

One session, three arcs. Everything below is merged AND verified in production unless marked open.

## Arc 1: six issues dispatched to parallel agents, all merged

| PR | Issue | What shipped |
|---|---|---|
| #4453 | #4399 | `tagBooksIntoCollection()` owns the `updated_at` bump; structural test; prod drift measured **0** (the recurring writers already bumped via a sibling `$set` — only the low-volume API path was broken). Follow-up #4452: 34 unguarded script sites. |
| #4454 | #4444 | Normalizer twin + CI fork-census (mutation-tested — its first regex was inert, git ERE has no `\s`). 12 identical clones swapped; 28 drifted deferred in 7 risk-ordered batches (checklist on #4444). |
| #4457 | #4389 | `/book/unknown-N`: cause was `english_title: "Unknown"` slugifying legally — NOT diacritics. Also found+fixed: the alias 308 never fired repo-wide (proxy only routed id-like segments; ~276 renamed books had two live URLs), and `metadata-enrichment.ts` renamed slugs with no alias/no `updated_at`. **112 slugs repaired post-merge**, verified 308ing. |
| #4459 | #4443 | One OCR-result parser (`scripts/lib/ocr-result-parse.mjs`), lenient/validate as options. Real bug: batch-collector's frozen vocab had lost `digitizer-insert`. Filed #4455 (canonical vocab screens out musical-score/table/cover) + #4456 (dead XML image parser, 200/200 prod pages are JSON). |
| #4460 | #4450 | **The five "vanished" books were never deleted** — `_id` lookups vs the string `id` key; 16,343 books carry re-minted `_id`s; 3.65M refs audited, 0 losses. Shipped `deleteBookArchived()` + `findBookByEitherKey()` + ledger-gap audit. New invariant doc `book-deletion-and-identity.md`. |
| #4461 | #4439 | Semantic-search language filter (below). |

**Deploy trap (new, 4th "merged ≠ in effect" mode):** six merges in 16s → Vercel built only the head commit; its scripts-only diff made the ignored-build-step cancel; **nothing shipped** until a manual `npm run deploy:prod`. When batch-merging: space merges or plan one deploy at the end. In auto-memory; deserves a line in `deploy-and-caching.md` (not yet PR'd).

## Arc 2: #4439 semantic search — applied to production end-to-end

- Mechanism: HNSW picks candidates before the language WHERE runs; non-dominant languages (Chinese 2.2%) never survive. The May-17 "seq-scan branch" never forced a seq scan (60ms 504-style tell: 0 rows in 60ms is an index, not a scan).
- pgvector on prod is **0.8.0** → `iterative_scan = relaxed_order` path active; older-version fallback is an exact pre-filter behind two redundant fences (`OFFSET 0` + `enable_indexscan=off`).
- Applied via shadow functions first (verified PASS), then live `match_semantic` / `match_page_texts` / `match_books_semantic`. Audit `scripts/audit/semantic-language-filter-recall.mjs`: was 4/4 FAIL, now PASS.
- **End-to-end proof:** `search_concept(magnetism…, languages:["Chinese"])` 0 → 5 hits (Bencao Gangmu loadstone, 0.704).
- Supabase DB creds: Keychain-only via secret-lover; `SUPABASE_DB_PASSWORD` reads EMPTY but `SUPABASE_DB_URL` reads fine and embeds the password — parse it in-process (see session; never print it).

## Arc 3: fleet + revalidate chain

**New scraper fleet (issue #4476, mitigated):** from Aug 29, one exact forged Linux Chrome/150 UA across ~42K US residential IPs (Comcast→rural co-op long tail = rented residential-proxy network), /book/* enumeration, ~700K/day pace at peak; DAU instrument read 30K vs a real ~1,300. **CF managed challenge on the exact UA** (rule `97a7e3e6…`, LAST in ruleset), verified eating 370–550 req/min, 0 solved. Decay: Chrome 150 ages out ~Oct; a new DAU spike on a different exact UA = the pool rotated — re-scope, don't re-diagnose. Aug 29–31 fingerprint metrics are contaminated. Fleet chronology now lives in `sourcelibrary-ops/security/scraper-fleet-ledger.md` (8 fleets).

**Revalidate fail-open (PRs #4470/#4474/#4479, all merged+deployed):** `/api/admin/revalidate` + `revalidate-book` accepted unauthenticated POSTs (`if (secret && …)` with REVALIDATE_SECRET unset). Now fail-closed accepting REVALIDATE_SECRET or CRON_SECRET; script callers migrated (split-book-v2's call had NEVER worked — GET + query param at a POST route); in-app `revalidateBook()` (pipeline post-OCR refresh) fixed after #4470 briefly broke it. Live controls verified: no secret → 401, CRON_SECRET → 200. **Meta-lesson: the hole was written up in ops/security on Aug 9 and sat unread for 22 days — a security finding needs a ticket or a test, not only a note.**

## Also this session

- **Error sweep:** the 1.49M/day edge "504s" are Cloudflare Early Hints bookkeeping rows (4ms TTFB, synthetic UA) — excluded from any error metric; now a section in `measurement-instruments.md` (#4466 merged). Real finding: 446K/day image 404s = gallery `-card.jpg` variants never backfilled (#4465, with PostHog corroboration).
- **#4451 translation requests:** all 8 requested pages verified translated page-by-page; 6/8 books had stale `pages_translated` counters (recounted, synced, revalidated); 8 feedback rows marked addressed with links (a parallel session had already emailed readers at ~08:46 — the once-guard prevented duplicates).
- **laubaumau PRs #4346/#4347 merged** (covers reconcile record; split-page reader fix), #4347 build verified Ready. #4378 closed.
- **Mirandola:** `/book/oration-on-the-dignity-of-man-mirandola` (110 visits/day, was 404) now 308s to the 1506 Latin Opera (`omnia-opera-mirandola`; Oratio = chapter at pp.221–292). Hidden Russian record re-slugged.
- **User numbers** (bot-excluded): 5,135 accounts (+1,138/30d), ~1,300 real daily visitors, median session 4m42s.

## Open threads

1. **4-page micro-tail** stuck in SQS ~30min: Enuma Elish pp.20/21 (OCR, job `ZI92ZEhxmrAa`), p.127 + Geomancy p.136 (translation pending; p136 job `YQJxjD9Smbph`). Check: pages `699249d0a2d53df4853c0438/39/a3`, `69b52bdad6bd9f58edb25068`. Re-queue if still empty tomorrow.
2. **CLAUDE.md is 5,554 words** (budget ~5,500) — next add must demote first; also the batch-merge deploy trap wants a line in `deploy-and-caching.md`.
3. #4476 residuals: retro-exclude Aug 29–31 from `metrics_history`?; did `distributed_proxy_pool` detector fire?
4. #4452 (script-side collection-tag writers), #4455/#4456 (parser follow-ups), drifted-normalizer batches on #4444, ~46 `untitled-N`-family placeholder slugs (`repair-book-slugs.ts`).
5. #4448 (Dunhuang recitation verification) — never dispatched, still the right next research task.
