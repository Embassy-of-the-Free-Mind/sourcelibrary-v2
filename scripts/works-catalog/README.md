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

## Run order (Hetzner — `SUPABASE_DB_URL` lives there)

```
node scripts/works-catalog/apply-schema.mjs        # idempotent DDL
node scripts/works-catalog/ingest-kanripo.mjs      # ~10.1K Chinese works (Kanseki Repository)
node scripts/works-catalog/ingest-siku-wikidata.mjs # 3,418 Siku QIDs joined onto kr: works
node scripts/works-catalog/ingest-openiti.mjs      # ~8.9K Islamicate works (Arabic/Persian)
node scripts/works-catalog/ingest-bdrc.mjs         # Tibetan works (BUDA linked data; --harvest then --load)
node scripts/works-catalog/ingest-ia-cadal.mjs     # IA-CADAL scan volumes -> chinese work_sources
node scripts/works-catalog/build-holdings.mjs      # Mongo books -> work_holdings (title-auto)
```

All idempotent (upserts). Env: `set -a; source .env.production.local; set +a`.

## Gotchas

- **CJK variant glyphs** (説/說, 録/錄, …): always match via
  `normalizeCjk()` from `lib.mjs` — raw match had a 28% false-miss rate.
- **raw.githubusercontent truncates multi-MB files with HTTP 200** — use the
  jsDelivr mirror + parse-inside-retry (see `ingest-openiti.mjs`).
- **trgm indexes are on the RAW columns** — query `title_normalized` /
  `title_english` directly, no `lower()` wrapper (ustc_editions lesson).
- Don't collapse different works; editions/copies are `work_sources` rows,
  never separate `works` rows for the same work.
