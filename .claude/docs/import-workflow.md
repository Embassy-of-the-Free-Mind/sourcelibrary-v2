# Import Workflow — enumerate → dedupe → source → import → process → QA → visible

Canonical workflow for acquiring books at scale without creating duplicates.
Written 2026-06-01 after the Daoist/Sefaria/Mesopotamian import work (PR #2290).
Applies to all contributors — human and AI.

## The loop

1. **ENUMERATE** — get a candidate list *from the source*, don't hand-list from memory.
   Repositories ARE the list. For Internet Archive use the reusable tool:
   ```
   set -a; source .env.production.local; set +a
   npx tsx scripts/import/enumerate-dedupe-source.ts --ia-collection universallibrary --q '<terms>' --out /tmp/cand.json
   ```
   For IIIF repos that gate discovery behind a JS SPA (Harvard CURIOSity, etc.),
   drive a real browser — see `chinese-iiif-sources.md` for per-source manifest
   patterns and the search URLs.

2. **DEDUPE** — never import a duplicate. Two layers:
   - *Manifestation* (this exact scan): exact match on `source_fingerprint`
     (`ia:…`, `iiif:…`, `gallica:…`). `enumerate-dedupe-source.ts` does this
     automatically against the whole catalog; `/api/import/*` routes also call
     `checkDuplicate()` (`src/lib/dedup.ts`) as a final safety net.
   - *Work* (same text, different edition/scan): NOT yet automatic — `work_id`
     isn't assigned at import. So the tool flags alternate scans of a held work
     as `NEW`; a human must catch these in step 3. (Durable fix tracked in
     issue #2318 — resolve to a Wikidata/VIAF work authority at import.)
   - Dedup matches HIDDEN books too (fixed PR #2290) — the import backlog is
     hidden, and that's where dupes accumulate. Don't reintroduce a
     `visible: true` filter in `dedup.ts`.

3. **SUBJECT-FILTER (human)** — keyword enumeration is NOISY. A CJK/Latin term
   matches stray characters in unrelated works (e.g. a Daoist query surfaced
   四庫全書 Confucian/math/drama volumes; a 真 matched 南華真經/Zhuangzi). The tool
   marks `NEW`/`HELD`/`TITLE_CLASH`/`THIN` but does NOT auto-import — a human
   curates the `NEW` list before import. For subject collections prefer a
   subject/genre FACET over keyword search (e.g. Harvard `f[subjects_ssim][]=Taoism`
   returns clean Daoist hits; the `?q=黃庭經` keyword search returns mostly noise).

4. **SOURCE & IMPORT** — import the approved subset (HIDDEN: `visible:false` +
   `hidden:true` — always set the pair). Routes: `/api/import/{ia,iiif,gallica,
   loc,wellcome,mdz,e-rara,google-books,pdf}` with `Authorization: Bearer $CRON_SECRET`.
   - **Datacenter-429 angle:** some sources (Harvard, likely Gallica) rate-limit
     *datacenter* IPs (Vercel) but serve *residential* IPs fine. Our import
     routes fetch server-side → they 429. Workaround: **fetch the manifest
     locally (residential) and direct-insert into Mongo** — see
     `scripts/import/harvard-wuzhen-direct.mjs` as the template (mirror its
     book/page doc shape, `source_fingerprint`, normalized fields, hidden).
     IIIF imports only need the manifest server-side; page images are referenced
     (served client-side), so the facsimile renders even if the pipeline can't
     fetch images server-side yet.
   - After insert, tag `collections` and (for IA) bump nothing else — the cron
     syncs page counts. For Supabase-backed collection grids see
     `lesson_collection_books_from_supabase_catalog`.

5. **PROCESS** — imageful books auto-enroll in the OCR→translation pipeline
   (Gemini Batch). Watch `batch_jobs`/`cron_runs`. Non-Latin scripts vary wildly
   in quality (see `project_siku_translation_census`, the Javanese recitation-loop
   lesson) — never assume.

6. **QA → VISIBLE** — do NOT flip `visible:true` on un-reviewed OCR/translation,
   especially non-Latin. Run a quality pass (`/qa-eval`, `/qa-audit`) first.
   Flip the `visible`/`hidden` pair together.

## Reusable assets
- `scripts/import/enumerate-dedupe-source.ts` — the enumerate+dedupe tool (IA; pluggable).
- `scripts/import/harvard-wuzhen-direct.mjs` — residential direct-insert template (429 bypass).
- `scripts/import/al-badri-direct.mjs` — original direct-insert pattern (bundled IA item).
- `scripts/import/daoist-alchemy-ia-batch{,-2}.mjs` — batch-via-API examples.
- `src/lib/dedup.ts` — fingerprint + normalize + `checkDuplicate` + `scanForDuplicates`.
- `scripts/lib/book-docs.mjs` — `makeBookDoc`/`makePageDoc`, the whitelisted doc constructors.
- `.claude/docs/chinese-iiif-sources.md` — per-source IIIF manifest patterns + gotchas.
- `.claude/docs/sanskrit-sources.md` — Indic channels; eGangotri/DLI/Wellcome, and why
  Indian museum portals are usually the wrong door (the same MSS are on IA, CC0).
- `.claude/docs/islamic-science-sources.md` — Gallica's 14.5K Arabic/Persian/Ottoman
  manuscripts, which Greek works survive only in Arabic, and the three Gallica traps
  (403 without a browser UA; `cc…` arks have no manifest; free-text ≠ subject).
- `scripts/import/gallica-islamic-science-enumerate.mjs` + `gallica-islamic-wave.mjs`
  — enumerate then import, Greek-transmission first.
- `.claude/docs/daoist-alchemy-acquisition-list.md` — a worked want→dedupe→get example.

## Building the insert docs
Build every `books`/`pages` insert document with `makeBookDoc()` / `makePageDoc()` from
`scripts/lib/book-docs.mjs` — never a bare object literal. Unknown keys throw, so a 478th
field cannot ship silently the way the first 477 did; adding one is then a reviewed edit
to the whitelist. All 50 direct-import scripts already do this — copy the nearest one.
The rule, the incident behind it, and where per-book *actions* go instead (rows via
`scripts/lib/sweep-log.mjs`) are in `.claude/docs/invariants/field-sprawl.md`.

## Invariants (don't violate)
- Imports land HIDDEN; flip visible only after QA. Always set `visible`/`hidden` as a pair.
- Dedup on `source_fingerprint` before insert; don't filter dedup by visibility.
- Subject-filter keyword enumerations by hand — they're noisy.
- **Archive IIIF pages at NATIVE resolution, never a fixed width cap.** Historic
  imports at `/full/1000,/`–`/full/2000,/` left ~2.1M pages at 2–9× below the
  source master (issue #3186; the recovery sweep is expensive — don't add to it).
  Check `info.json` for the true `width`; if the server caps single-response
  output below it (`maxWidth`/`maxHeight`, or a `SILENT_CAP_HOSTS` entry in
  `scripts/lib/iiif-utils.mjs`), tile-stitch with `fetchIiifNativeRes()`.
  Width caps are doubly destructive on wide-format material (palm leaves,
  scrolls), where they crush the readable dimension.
- Respect source terms: ctext.org and NLC China prohibit automated download — do NOT scrape them.
