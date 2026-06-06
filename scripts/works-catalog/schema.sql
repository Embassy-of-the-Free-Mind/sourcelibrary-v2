-- Universal works catalog (pre-1900) — issue #2453
-- Work-level union catalog across traditions. Sits ABOVE edition/item-level
-- registries (ustc_editions, import_candidates from #2447): L3 in the #2447
-- dedup vocabulary. Never collapse different works; editions/copies hang off
-- a work via work_sources, our books via work_holdings.
--
-- Apply with: node scripts/works-catalog/apply-schema.mjs  (needs SUPABASE_DB_URL)

create extension if not exists pg_trgm;

create table if not exists works (
  id text primary key,                    -- prefixed authority id: 'kr:KR1a0002', 'oiti:0179MalikIbnAnas.Muwatta', 'bdrc:WA0RK0529', 'wd:Q844278'
  tradition text not null,                -- 'chinese' | 'tibetan' | 'arabic' | 'latin' | 'sanskrit' | 'greek' | 'hebrew' | ...
  original_language text,                 -- ISO 639-3 where known: 'lzh', 'bod', 'ara', 'fas', ...
  title text not null,                    -- canonical title in original script
  title_normalized text,                  -- variant-normalized matching form (CJK variant glyphs, etc.)
  title_romanized text,                   -- pinyin / Wylie / transliteration
  title_english text,
  author text,                            -- display form; thesaurus linking is a later pass
  author_id text,                         -- -> Mongo authors._id (canonical author thesaurus), when resolved
  century int,                            -- rough composition century (e.g. 13 = 1200s); null if unknown
  wikidata_qid text,
  authority_ids jsonb not null default '{}',  -- {"kanripo_id":..., "openiti_uri":..., "bdrc_id":..., "siku_qid":...}
  corpus_tags text[] not null default '{}',   -- {'siku-quanshu','daozang','cbeta','kangyur','tengyur',...}
  -- Translation status is an evidenced CLAIM, never a bare boolean
  -- (see CLAUDE.md "is_first_translation is a claim, not deliverable").
  translation_status text not null default 'unknown'
    check (translation_status in ('unknown','none','partial','full')),
  translation_evidence text,              -- citation / URL for the status
  translation_method text                 -- 'census-auto' | 'hand-verified' | 'claimed'
    check (translation_method is null or translation_method in ('census-auto','hand-verified','claimed')),
  source_catalog text not null,           -- ingest provenance: 'kanripo' | 'wikidata-siku' | 'openiti' | 'bdrc' | ...
  extra jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists works_tradition_idx on works (tradition);
create index if not exists works_qid_idx on works (wikidata_qid) where wikidata_qid is not null;
create index if not exists works_translation_idx on works (tradition, translation_status);
-- trgm on the RAW columns we actually query (lesson: index expression must
-- match the query expression — lower() drift caused the ustc_editions seq scans)
create index if not exists works_title_norm_trgm on works using gin (title_normalized gin_trgm_ops);
create index if not exists works_title_english_trgm on works using gin (title_english gin_trgm_ops);

create table if not exists work_sources (
  id bigserial primary key,
  work_id text not null references works(id) on delete cascade,
  source text not null,                   -- 'kanripo' | 'ia-cadal' | 'harvard-yenching' | 'bdrc' | 'openiti' | 'waseda' | ...
  source_id text not null,                -- KR id / IA identifier / FHCL id / BDRC W-id / OpenITI version URI
  kind text not null check (kind in ('scan','transcription','translation')),
  url text,
  iiif boolean not null default false,
  coverage text,                          -- juan/volume range for multi-volume items ('卷4-5', 'vol. 2', null = whole work)
  extra jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (work_id, source, source_id)
);

create index if not exists work_sources_source_idx on work_sources (source);
create index if not exists work_sources_work_idx on work_sources (work_id);

create table if not exists work_holdings (
  id bigserial primary key,
  work_id text not null references works(id) on delete cascade,
  book_id text not null,                  -- Mongo books._id (string form)
  coverage text,                          -- juan/volume range we hold; null = whole work
  pages int,
  translated_pct numeric,
  matched_by text,                        -- 'title-auto' | 'hand-verified'
  created_at timestamptz not null default now(),
  unique (work_id, book_id)
);

create index if not exists work_holdings_book_idx on work_holdings (book_id);
