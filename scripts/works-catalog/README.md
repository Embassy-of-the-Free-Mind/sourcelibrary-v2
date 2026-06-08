# Universal works catalog (pre-1900) — issue #2453

Work-level union catalog across traditions, in Supabase. Sits ABOVE
edition/item-level registries (`ustc_editions`, `import_candidates` from
#2447 — L3 in that issue's dedup vocabulary). Answers, per work: where do
scans exist, does an open transcription exist, is there an English
translation (evidenced claim), and do we hold it.

## Tables

- `works` — one row per work; prefixed authority ids (`kr:KR1a0002`,
  `oiti:0179MalikIbnAnas.Muwatta`, `bdrc:…`, `wd:Q844278`); evidenced
  `translation_status` (status + evidence + method — never a bare boolean).
- `work_sources` — scans/transcriptions/translations per work, with coverage
  (juan/volume range) for multi-volume items.
- `work_holdings` — our Mongo books mapped to works, with coverage.

## Current state (2026-06-09)

~78.7K works across 8 traditions: tibetan 30.4K, chinese 10.8K, **sanskrit 10.6K**,
khmer 9.5K, islamicate 8.8K, **hebrew 6.6K**, pali 1.9K, newari 27. First evidenced
**coverage** census (Sanskrit pilot): 14.0% of works have a scan, 8.4% have an open
transcription. **Translation census** (Siku discipline): chinese ~2%, tibetan 2.7%,
islamicate 5.3% — recall floors; calibration shows a 2–3.5× undercount
(`calibrate-census.mjs`). See `.claude/docs/works-catalog-translation-census.md`.

## Run order (Hetzner — `SUPABASE_DB_URL` lives there)

```
node scripts/works-catalog/apply-schema.mjs           # idempotent DDL
node scripts/works-catalog/ingest-kanripo.mjs         # ~10.1K Chinese works (Kanseki Repository)
node scripts/works-catalog/ingest-siku-wikidata.mjs   # 3,418 Siku QIDs joined onto kr: works
node scripts/works-catalog/ingest-openiti.mjs         # ~8.9K Islamicate works (Arabic/Persian)
node scripts/works-catalog/ingest-bdrc.mjs            # Tibetan works (BUDA linked data; --harvest then --load)
node scripts/works-catalog/ingest-ia-cadal.mjs        # IA-CADAL scan volumes -> chinese work_sources
# Sanskrit spine (#2453, added 2026-06):
node scripts/works-catalog/ingest-sanskrit-wikidata.mjs  # ~3.9K Sanskrit works (Wikidata P407=Q11059)
node scripts/works-catalog/ingest-gretil.mjs             # ~891 GRETIL works + transcription work_sources
node scripts/works-catalog/ingest-pandit.mjs <csv> [--all]  # richest: authors/dates/disciplines (manual CSV — see Pandit note)
node scripts/works-catalog/ingest-sefaria.mjs         # ~6.6K Hebrew works (Sefaria, CC0)
# Coverage join (Phase 1) + provenance + holdings:
node scripts/works-catalog/match-scans-ia.mjs --tradition=sanskrit --apply  # works <-> IA manifests -> work_sources(scan)
node scripts/works-catalog/seed-provenance.mjs        # catalog_sources licensing/attribution rows
node scripts/works-catalog/build-holdings.mjs         # Mongo books -> work_holdings (title-auto)
# Translation census + calibration (per tradition):
node scripts/works-catalog/translation-census.mjs --tradition islamicate --sample 300 --write
node scripts/works-catalog/calibrate-census.mjs --tradition islamicate --sample 40  # web-grounded recall-floor check
```

All idempotent (upserts). Env: `set -a; source .env.production.local; set +a`.

## Getting Pandit data (panditproject.org — CC-BY-NC-SA, richest Sanskrit authority)

Cloudflare-gated, no API/dump; its CSV export is a broken Drupal batch. Working
self-serve recipe (from an authenticated **browser**, not curl — TLS-fingerprint blocked):
1. On the Works search apply a filter — for clean Sanskrit use `field_language[]=45` (=Sanskrit).
2. Console: `fetch('/search?<filters>&op=do&_format=csv')` (GET only, csv only); parse the batch id from the HTML.
3. Open `https://panditproject.org/batch?id=<ID>&op=do_nojs` in a NEW TAB — the browser drives the
   batch via meta-refresh and downloads `YYYY-MM-DD-pandit-entities-export.csv`.
4. `ingest-pandit.mjs` is column-detecting; `--all` for a language-filtered (pure-Sanskrit) export,
   default (Sanskrit-script-guard) for mixed/year-filtered exports.

## Gotchas

- **CJK variant glyphs** (説/說, 録/錄, …): always match via
  `normalizeCjk()` from `lib.mjs` — raw match had a 28% false-miss rate.
- **raw.githubusercontent truncates multi-MB files with HTTP 200** — use the
  jsDelivr mirror + parse-inside-retry (see `ingest-openiti.mjs`).
- **trgm indexes are on the RAW columns** — query `title_normalized` /
  `title_english` directly, no `lower()` wrapper (ustc_editions lesson).
- Don't collapse different works; editions/copies are `work_sources` rows,
  never separate `works` rows for the same work. (Cross-source work dedup —
  same work as `wd:`/`gretil:`/`pandit:` rows — is a later catalog pass, #2318.)
- **Sanskrit scan matching** (`match-scans-ia.mjs`): the catalog uses IAST
  (Bṛhadāraṇyaka), IA titles use a different romanization (Brihadaranyaka). Bridge
  with a **consonant skeleton** — strip diacritics + vowels + aspirate-h, collapse
  the **anusvāra only** (m/n *before a consonant*, not before a vowel, else Mata→Nata),
  then an 8-consonant block key + full-skeleton prefix filter (kills Gītā↔Mahāpurāṇam
  collisions). ~90-95% precision; always print the calibration sample before `--apply`.
- **supabase-js `.select()` caps at 1000 rows** — for `count(distinct work_id)`
  coverage numbers use a real SQL query (node-pg) on Hetzner, not a JS-side dedup
  of a capped select.
- **`translation_status`**: `'none'` (evidenced absence) ≠ `'unknown'` (not checked);
  a `transcription` work_source is NOT a `translation` — keep the `kind` distinct.
