#!/usr/bin/env node
/**
 * ensure-indexes.mjs — the single source of truth for every intentional
 * MongoDB index on `bookstore`.
 *
 * Why this exists (#2978): indexes were previously created by ~15 scattered
 * one-off scripts (create-critical-indexes.mjs, create-ttl-indexes.mjs,
 * create-entities-wikidata-indexes.mjs, a 1,281-line archived admin route,
 * assorted backfill/migration scripts, and several app-layer `ensureIndexes()`
 * lazy-creators). Nobody could answer "is this index intentional?" or "did we
 * lose an index?" without re-reading all of them. The /explore/timeline outage
 * (#2973) shipped a render-time query with no supporting index and nobody
 * noticed for weeks — this manifest exists so that class of gap becomes
 * visible in the health cron (see scripts/workers/pipeline-health-alert.mjs)
 * instead of surfacing as a production timeout.
 *
 * This file does NOT replace the scripts above — they're the historical
 * record of *why* each index exists and are cited in the `why` field below.
 * Going forward, new indexes should be added HERE, not as a new one-off
 * script (see the CLAUDE.md "Knowledge Maintenance" habit this issue adds).
 *
 * SEEDING METHODOLOGY (2026-07-05): every entry below was seeded by dumping
 * the actual live indexes off production (`db.<collection>.indexes()` for
 * all 117 collections, read-only) — NOT written from memory or from the
 * creator scripts' intent. Rationale (`why`) was then back-filled by reading
 * every index-creating script found in the repo (`grep -rl createIndex`) and
 * matching it to the live (collection, name, key) triple. Where no creator
 * script, doc comment, or query-shape evidence could be found, the entry is
 * marked `UNKNOWN — found live 2026-07-05, triage in #2978` rather than
 * silently omitted — an omitted index just looks like drift; an UNKNOWN one
 * is a flagged research task. A few entries carry an explicit NOTE where the
 * live index doesn't match what its apparent creator script would produce
 * (see `pages_split_from_spread_idx` and `tenants.id_1` below) — these are
 * genuine discrepancies worth investigating, not seeding mistakes.
 *
 * SAFETY: this script is DRY-RUN BY DEFAULT. It only prints what it would do.
 * Pass --apply to actually call createIndex(). createIndex() is idempotent
 * for an identical spec (same key + same relevant options) — MongoDB no-ops
 * if the index already exists, and errors (without side effects) if an
 * equivalent-but-different index already exists under a different name/spec.
 * This script never calls dropIndex() — removing a live-but-unmatched index
 * is always a human decision (see the drift check in pipeline-health-alert.mjs,
 * which reports unknown-live indexes as informational notes, never auto-drops).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ensure-indexes.mjs              # dry run (default)
 *   node scripts/maintenance/ensure-indexes.mjs --apply       # actually create
 *   node scripts/maintenance/ensure-indexes.mjs --collection=books --apply
 *
 * Read-only note: even in --apply mode this script only ever calls
 * createIndex() — it has no code path that drops or modifies existing data.
 */
import { MongoClient } from 'mongodb';

/**
 * @typedef {Object} IndexSpec
 * @property {string} collection
 * @property {Record<string, 1 | -1 | 'text'>} key
 * @property {Record<string, unknown>} options - must include `name`
 * @property {string} why - one-line rationale, or the UNKNOWN marker
 */

/** @type {IndexSpec[]} */
export const INDEXES = [
  // ── acquisition_queue ─────────────────────────────────────────
  { collection: 'acquisition_queue', key: { 'status': 1 }, options: { 'name': 'status_1' }, why: 'Queue-status filter. scripts/catalog-coverage/acquire-gap-batch.mjs.' },
  { collection: 'acquisition_queue', key: { 'sn': 1 }, options: { 'name': 'sn_1', 'unique': true }, why: 'Unique catalog serial-number key, prevents re-queuing the same USTC/catalog entry. scripts/catalog-coverage/acquire-gap-batch.mjs.' },
  { collection: 'acquisition_queue', key: { 'status': 1, 'priority': -1, '_id': 1 }, options: { 'name': 'claim_priority_idx' }, why: 'Priority-ordered claim (findOneAndUpdate sort) so reader-request rows (priority:1) jump bulk seeds. scripts/catalog-coverage/acquire-gap-batch.mjs.' },
  // ── analytics_bot_access ──────────────────────────────────────
  { collection: 'analytics_bot_access', key: { 'bot': 1, 'path_prefix': 1, 'date': 1 }, options: { 'name': 'bot_daily_idx', 'background': true }, why: 'Daily bot-hit counter upsert key (bot+path_prefix+day). src/app/api/analytics/bots/route.ts creates this lazily on first write.' },
  // ── analytics_events ──────────────────────────────────────────
  { collection: 'analytics_events', key: { 'event': 1, 'book_id': 1, 'ip': 1, 'timestamp': 1 }, options: { 'name': 'analytics_dedupe_idx', 'background': true }, why: 'Analytics event de-dup lookup { event, book_id, ip, timestamp }. From the archived src/app/api/_archived/admin/ensure-indexes/route.ts.' },
  { collection: 'analytics_events', key: { 'event': 1, 'timestamp': -1 }, options: { 'name': 'analytics_events_event_ts_idx', 'background': true }, why: 'Search-query analytics: { event: \'search_query\', timestamp: { $gte } } range scans. From the archived ensure-indexes route.' },
  { collection: 'analytics_events', key: { 'created_at': 1 }, options: { 'name': 'created_at_1' }, why: 'Plain created_at range index (query support only) — retention is manual per #2976 decision 2026-07-05; TTL removed. Replaces the live ttl_90d_created_at TTL index via scripts/maintenance/swap-ttl-to-plain-indexes.mjs post-deploy.' },
  // ── analytics_pageviews ───────────────────────────────────────
  { collection: 'analytics_pageviews', key: { 'timestamp': -1 }, options: { 'name': 'pageviews_timestamp_idx', 'background': true }, why: 'Timestamp range queries used by every traffic aggregation. Archived ensure-indexes route.' },
  { collection: 'analytics_pageviews', key: { 'path': 1, 'timestamp': -1 }, options: { 'name': 'pageviews_path_ts_idx', 'background': true }, why: 'Path + timestamp for top-pages reporting. Archived ensure-indexes route.' },
  { collection: 'analytics_pageviews', key: { 'ip': 1, 'timestamp': -1 }, options: { 'name': 'pageviews_ip_ts_idx', 'background': true }, why: 'IP + timestamp for unique-visitor aggregation grouped by day+ip. Archived ensure-indexes route.' },
  { collection: 'analytics_pageviews', key: { 'timestamp': 1 }, options: { 'name': 'timestamp_1' }, why: 'Plain timestamp range index — retention is manual per #2976 decision 2026-07-05 ("nine minus the heartbeats"); TTL removed (was ttl_90d_timestamp, 90d). Creator (scripts/maintenance/create-ttl-indexes.mjs) RETIRED; swapped from TTL by scripts/maintenance/swap-ttl-to-plain-indexes.mjs post-deploy.' },
  // ── annotations ───────────────────────────────────────────────
  { collection: 'annotations', key: { 'book_id': 1, 'page_id': 1 }, options: { 'name': 'annotations_book_page_idx', 'background': true }, why: 'Lookup by book + page. Archived ensure-indexes route.' },
  // ── api_usage ─────────────────────────────────────────────────
  { collection: 'api_usage', key: { 'ts': 1 }, options: { 'name': 'ts_1' }, why: 'Public-API gate usage log — plain ts range index. Retention is manual per #2976 decision 2026-07-05; TTL removed (was 90d). src/lib/api-usage.ts ensureIndexes(), created lazily on first write; live TTL swapped to plain by scripts/maintenance/swap-ttl-to-plain-indexes.mjs post-deploy.' },
  { collection: 'api_usage', key: { 'route': 1, 'ts': -1 }, options: { 'name': 'route_1_ts_-1' }, why: 'Hot-route analysis for the API usage log. src/lib/api-usage.ts.' },
  { collection: 'api_usage', key: { 'user_id': 1, 'ts': -1 }, options: { 'name': 'user_id_1_ts_-1' }, why: '\'What did this user do\' views. src/lib/api-usage.ts.' },
  { collection: 'api_usage', key: { 'api_key_id': 1, 'ts': -1 }, options: { 'name': 'api_key_id_1_ts_-1' }, why: '\'What is this key being used for\' views. src/lib/api-usage.ts.' },
  { collection: 'api_usage', key: { 'ip_hash': 1, 'ts': -1 }, options: { 'name': 'ip_hash_1_ts_-1' }, why: 'Per-client analysis, hashed IP for PII-light logging. src/lib/api-usage.ts.' },
  // ── audit_log ─────────────────────────────────────────────────
  { collection: 'audit_log', key: { 'book_id': 1 }, options: { 'name': 'audit_log_book_idx', 'background': true }, why: 'Lookup by book_id. Archived ensure-indexes route.' },
  // ── book_events ───────────────────────────────────────────────
  { collection: 'book_events', key: { 'book_id': 1, 'type': 1 }, options: { 'name': 'book_events_book_type_idx', 'background': true }, why: 'Per-book durable history lookups (image_resolution_upgrade etc.). Unlike audit_log this collection is PERMANENT — never add it to prune-telemetry. rearchive-iiif-fullres.mjs, backfill-resolution-upgrade-events.mjs (#3191).' },
  // ── authors ───────────────────────────────────────────────────
  { collection: 'authors', key: { 'slug': 1 }, options: { 'name': 'slug_1', 'unique': true }, why: 'Canonical slug lookup, the primary key for the author thesaurus. scripts/maintenance/build-authors-collection.mjs.' },
  { collection: 'authors', key: { 'variant_slugs': 1 }, options: { 'name': 'variant_slugs_1' }, why: 'Redirect-map lookup: any variant slug resolves to the canonical author. build-authors-collection.mjs.' },
  { collection: 'authors', key: { 'viaf_id': 1 }, options: { 'name': 'viaf_id_1', 'sparse': true }, why: 'VIAF authority cross-reference, sparse (most authors lack one). build-authors-collection.mjs.' },
  { collection: 'authors', key: { 'book_count': -1 }, options: { 'name': 'book_count_-1' }, why: 'Default sort for author listings. build-authors-collection.mjs.' },
  // ── batch_jobs ────────────────────────────────────────────────
  { collection: 'batch_jobs', key: { 'status': 1, 'created_at': 1 }, options: { 'name': 'batch_jobs_status_created_idx', 'background': true }, why: 'Cron reconciliation of pending/processing jobs sorted by created_at. Archived ensure-indexes route.' },
  { collection: 'batch_jobs', key: { 'book_id': 1, 'status': 1 }, options: { 'name': 'batch_jobs_book_status_idx', 'background': true }, why: 'Lookup by book + status. Archived ensure-indexes route.' },
  { collection: 'batch_jobs', key: { 'parent_job_id': 1, 'created_at': -1 }, options: { 'name': 'batch_jobs_parent_created_idx', 'background': true, 'sparse': true }, why: 'Filters out child jobs in the processing overview ({ parent_job_id: { $exists: false } }). Archived ensure-indexes route.' },
  // ── book_indexes ──────────────────────────────────────────────
  { collection: 'book_indexes', key: { 'book_id': 1 }, options: { 'name': 'book_id_1', 'unique': true }, why: 'Unique key for the dedicated per-book index collection split out of books.index.*. scripts/migration/migrate-book-indexes.mjs.' },
  // ── book_metadata_changelog ───────────────────────────────────
  { collection: 'book_metadata_changelog', key: { 'book_id': 1, 'timestamp': -1 }, options: { 'name': 'book_metadata_changelog_book_ts_idx', 'background': true }, why: 'Lookup by book_id, newest first. Archived ensure-indexes route.' },
  // ── books ─────────────────────────────────────────────────────
  { collection: 'books', key: { 'categories': 1 }, options: { 'name': 'categories_1' }, why: 'Category filter on /api/books/library (matchConditions.push({categories: category}), src/app/api/books/library/route.ts:109). Same purpose as the archived route\'s named books_categories_idx — this live instance carries the MongoDB-assigned default name instead.' },
  { collection: 'books', key: { 'id': 1 }, options: { 'name': 'books_id_idx', 'background': true, 'unique': true }, why: 'Canonical id lookup — the primary key used across almost every read path. Archived ensure-indexes route.' },
  { collection: 'books', key: { 'language': 1 }, options: { 'name': 'books_language_idx', 'background': true }, why: 'Language filter on the /library route. Archived ensure-indexes route.' },
  { collection: 'books', key: { 'work_id': 1 }, options: { 'name': 'work_id_1', 'sparse': true }, why: 'WEMI work-level grouping — \'other editions of this work\' lookup, sparse. scripts/enrichment/backfill-work-ids.mjs (also see .claude/docs/work-identity-coverage.md). Same purpose as the archived route\'s books_work_id_idx.' },
  { collection: 'books', key: { 'collections': 1 }, options: { 'name': 'books_collections_idx', 'background': true }, why: 'Collection membership filter for collection browse pages. Archived ensure-indexes route.' },
  { collection: 'books', key: { 'quality_score': -1 }, options: { 'name': 'books_quality_score_idx', 'background': true, 'sparse': true }, why: 'Quality-score sort for homepage/library default sort, sparse. Archived ensure-indexes route.' },
  { collection: 'books', key: { 'pipeline_auto.status': 1, 'pipeline_auto.last_updated': 1 }, options: { 'name': 'books_pipeline_status_updated_idx', 'background': true, 'sparse': true }, why: 'Stale-pipeline detection: { pipeline_auto.status, pipeline_auto.last_updated: { $lt: cutoff } }. Archived ensure-indexes route.' },
  { collection: 'books', key: { 'slug': 1 }, options: { 'name': 'books_slug_idx', 'background': true, 'unique': true, 'sparse': true }, why: 'SEO-friendly slug lookup, unique + sparse. Archived ensure-indexes route / scripts/maintenance/populate-book-slugs.mjs.' },
  { collection: 'books', key: { 'source_fingerprint': 1 }, options: { 'name': 'idx_source_fingerprint', 'sparse': true }, why: 'Exact-match de-dup lookup on the content fingerprint. Matches the \'source_fingerprint\' match strategy in src/lib/dedup.ts (no separate creation script found in-repo; likely created ad hoc alongside the dedup feature).' },
  { collection: 'books', key: { 'normalized_title': 1, 'normalized_author': 1 }, options: { 'name': 'idx_normalized_title_author', 'sparse': true }, why: 'Compound de-dup lookup for the \'title_author\' match strategy in src/lib/dedup.ts (no separate creation script found in-repo; likely created ad hoc alongside the dedup feature).' },
  { collection: 'books', key: { 'author': 1 }, options: { 'name': 'author_1' }, why: 'Book-detail-page \'other books by this author\' count: { author: book.author, id: { $ne: book.id } }. Same purpose as the archived route\'s books_author_idx — this live instance carries the default name instead.' },
  { collection: 'books', key: { 'visible': 1, 'created_at': -1 }, options: { 'name': 'books_visible_created_idx', 'background': true }, why: 'Browse pages, newest-first listing. Without it: 326s full scan on `visible:true` sorted by created_at (issue #561). Archived ensure-indexes route.' },
  { collection: 'books', key: { 'visible': 1, 'categories': 1, 'created_at': -1 }, options: { 'name': 'visible_1_categories_1_created_at_-1' }, why: 'Category/collection browse pages: { visible: true, categories: X }.sort({created_at:-1}) (issue #561). Same shape as the archived route\'s books_visible_categories_idx, live under the default name.' },
  { collection: 'books', key: { 'image_source.provider': 1, 'hidden': 1, 'pages_count': 1, 'created_at': -1 }, options: { 'name': 'books_provider_browse_idx', 'background': true }, why: 'Direct per-provider browse used by scripts/maintenance/rehost-external-thumbnails.mjs (queries { visible, pages_count, image_source.provider } and pins the plan with .hint(\'books_provider_browse_idx\') to avoid scanning all ~9K books) and by tenant/library-partner browse surfaces filtering on image_source.provider + hidden + pages_count + created_at.' },
  { collection: 'books', key: { 'author_entity_id': 1 }, options: { 'name': 'author_entity_id_1', 'background': true, 'sparse': true }, why: 'Legacy author-linkage FK, sparse. Consulted by src/lib/author-thesaurus.ts ({ author_entity_id: { $in: entityIds } }) while author_id/authors-thesaurus migration is in progress — see the \'Author identity\' section of CLAUDE.md (\'author_entity_id → entities is transitional and being retired\').' },
  { collection: 'books', key: { 'held_by': 1, 'visible': 1, 'pages_count': 1 }, options: { 'name': 'held_by_visible_pages', 'background': true }, why: 'Tenant-holdings browse query { held_by, visible, pages_count }. scripts/migration/backfill-held-by.mjs Phase 4, also used by src/app/api/embed/bph/stats/route.ts.' },
  { collection: 'books', key: { 'tenant_id': 1 }, options: { 'name': 'tenant_id_1', 'background': true, 'sparse': true }, why: 'Tenant-scoped data-fetch filter, sparse. Required by the Tenant Subdomain Lockdown invariant in CLAUDE.md (\'the default for tenantId (Atlas) is GLOBAL — explicit filtering is required\'); no dedicated creation script found in-repo.' },
  { collection: 'books', key: { 'art_collection_rank.$**': -1 }, options: { 'name': 'art_collection_rank_wildcard' }, why: 'Wildcard index backing the per-collection art-rank sort in src/app/api/collections/[id]/route.ts (`.sort({ [\\`art_collection_rank.${id}\\`]: -1, commons_width: -1 })`) — a dynamic field per collection id, hence the wildcard.' },
  { collection: 'books', key: { 'author_id': 1 }, options: { 'name': 'author_id_1' }, why: 'Canonical author FK — the read-path join key for /author/[slug]. scripts/maintenance/backfill-author-canonical-links.mjs (\'Index for the read-path author_id lookup (idempotent)\').' },
  { collection: 'books', key: { 'slug_aliases': 1 }, options: { 'name': 'books_slug_aliases_idx', 'background': true, 'sparse': true }, why: 'Miss-path lookup for renamed slugs (findBookByIdOrSlug resolves slug_aliases only on a would-be 404, then 301s to the canonical slug). scripts/maintenance/populate-book-slugs.mjs — sparse + multikey, non-unique to tolerate legacy data.' },
  { collection: 'books', key: { 'id': 1, 'language': 1 }, options: { 'name': 'id_language_covered' }, why: 'Covered index for the /explore/timeline book-language lookup — point-fetching ~14K full book docs (avg ~25KB) was reading ~360MB and timing out; with this index + an _id-excluding projection the query never touches the documents. scripts/maintenance/create-entities-wikidata-indexes.mjs (the #2973 timeline-outage fix that is the direct trigger for this issue, #2978).' },
  // ── books_warehouse ───────────────────────────────────────────
  { collection: 'books_warehouse', key: { 'id': 1 }, options: { 'name': 'id_1', 'unique': true }, why: 'Unique warehouse key, mirrors books.id. scripts/migration/warehouse-migration.mjs.' },
  { collection: 'books_warehouse', key: { 'pipeline_auto.status': 1 }, options: { 'name': 'pipeline_auto.status_1' }, why: 'Pipeline status filter on the warehouse copy. scripts/migration/warehouse-migration.mjs.' },
  { collection: 'books_warehouse', key: { 'ia_identifier': 1 }, options: { 'name': 'ia_identifier_1' }, why: 'Internet Archive identifier lookup for dedup/import reconciliation. scripts/migration/warehouse-migration.mjs.' },
  { collection: 'books_warehouse', key: { 'source_fingerprint': 1 }, options: { 'name': 'source_fingerprint_1' }, why: 'De-dup fingerprint lookup, mirrors the books.idx_source_fingerprint strategy. Origin: backfill-warehouse-dedup-fields.ts (one-time, deleted 2026-08).' },
  { collection: 'books_warehouse', key: { 'normalized_title': 1, 'normalized_author': 1 }, options: { 'name': 'normalized_title_1_normalized_author_1' }, why: 'Title+author de-dup lookup, mirrors books.idx_normalized_title_author. Origin: backfill-warehouse-dedup-fields.ts (one-time, deleted 2026-08).' },
  { collection: 'books_warehouse', key: { 'image_source.iiif_manifest': 1 }, options: { 'name': 'image_source.iiif_manifest_1' }, why: 'IIIF-manifest de-dup lookup. Origin: backfill-warehouse-dedup-fields.ts (one-time, deleted 2026-08).' },
  // ── bookshelves ───────────────────────────────────────────────
  { collection: 'bookshelves', key: { 'visitor_id': 1, 'book_id': 1 }, options: { 'name': 'bookshelves_visitor_book_idx', 'background': true, 'unique': true }, why: 'One shelf entry per visitor+book, unique. Archived ensure-indexes route.' },
  { collection: 'bookshelves', key: { 'visitor_id': 1, 'status': 1, 'updated_at': -1 }, options: { 'name': 'bookshelves_visitor_status_idx', 'background': true }, why: 'Per-visitor shelf listing sorted by updated_at. Archived ensure-indexes route.' },
  // ── catalog_coverage ──────────────────────────────────────────
  { collection: 'catalog_coverage', key: { 'ustc_id': 1 }, options: { 'name': 'ustc_id_1', 'unique': true }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'catalog_coverage', key: { 'language': 1, 'year': 1 }, options: { 'name': 'language_1_year_1' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'catalog_coverage', key: { 'source_library_id': 1 }, options: { 'name': 'source_library_id_1', 'sparse': true }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'catalog_coverage', key: { 'author_surname': 1, 'year': 1 }, options: { 'name': 'author_surname_1_year_1' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'catalog_coverage', key: { 'work_cluster_id': 1 }, options: { 'name': 'work_cluster_id_1' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'catalog_coverage', key: { 'has_iiif_scan': 1, 'has_english_translation': 1, 'language': 1 }, options: { 'name': 'has_iiif_scan_1_has_english_translation_1_language_1' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'catalog_coverage', key: { 'has_iiif_scan': 1 }, options: { 'name': 'has_iiif_scan_1', 'hidden': true }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'catalog_coverage', key: { 'has_english_translation': 1 }, options: { 'name': 'has_english_translation_1' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  // ── chapter_texts ─────────────────────────────────────────────
  { collection: 'chapter_texts', key: { 'book_id': 1, 'chapter_index': 1 }, options: { 'name': 'book_id_1_chapter_index_1' }, why: 'Chapter lookup by book + index. scripts/backfill-chapter-texts.mjs.' },
  // ── collections ───────────────────────────────────────────────
  { collection: 'collections', key: { 'slug': 1 }, options: { 'name': 'collections_slug_idx', 'background': true, 'unique': true }, why: 'Collection page slug lookup, unique. Archived ensure-indexes route.' },
  // ── cron_runs ─────────────────────────────────────────────────
  { collection: 'cron_runs', key: { 'cron': 1, 'timestamp': -1 }, options: { 'name': 'cron_runs_cron_ts_idx', 'background': true }, why: 'Per-cron history (cron name + time desc). Archived ensure-indexes route / scripts/maintenance/create-critical-indexes.mjs.' },
  { collection: 'cron_runs', key: { 'timestamp': -1 }, options: { 'name': 'cron_runs_ts_idx', 'background': true }, why: 'Time-range scans for pipeline/analytics dashboards. Archived ensure-indexes route.' },
  { collection: 'cron_runs', key: { 'status': 1, 'timestamp': -1 }, options: { 'name': 'cron_runs_status_ts_idx', 'background': true }, why: 'Failed-run queries. Archived ensure-indexes route.' },
  { collection: 'cron_runs', key: { 'timestamp': 1 }, options: { 'name': 'cron_runs_ttl_30d', 'background': true, 'expireAfterSeconds': 2592000 }, why: '30-day TTL — deliberate heartbeat retention per Derek 2026-07-05 (#2976, "nine minus the heartbeats"). No exact creator script found for the 30d cron_runs variant; this manifest is now its canonical spec.' },
  // ── curation_drafts ───────────────────────────────────────────
  { collection: 'curation_drafts', key: { 'collection_slug': 1, 'status': 1 }, options: { 'name': 'collection_slug_status_idx' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  // ── curator_sessions ──────────────────────────────────────────
  { collection: 'curator_sessions', key: { 'id': 1 }, options: { 'name': 'id_1', 'unique': true }, why: 'Unique session id. Archived ensure-indexes route (curator_sessions_id_idx equivalent, live under default name).' },
  { collection: 'curator_sessions', key: { 'date': -1 }, options: { 'name': 'curator_sessions_date_idx', 'background': true }, why: 'Date sort for the curator-sessions listing. Archived ensure-indexes route.' },
  { collection: 'curator_sessions', key: { 'themes': 1 }, options: { 'name': 'curator_sessions_themes_idx', 'background': true }, why: 'Theme filter. Archived ensure-indexes route.' },
  // ── deleted_books ─────────────────────────────────────────────
  { collection: 'deleted_books', key: { 'id': 1 }, options: { 'name': 'deleted_books_id_idx', 'background': true }, why: 'Lookup for POST /api/books/restore/[id]. Archived ensure-indexes route.' },
  // ── entities ──────────────────────────────────────────────────
  { collection: 'entities', key: { 'books.book_id': 1 }, options: { 'name': 'books.book_id_1' }, why: 'Reverse lookup: which entities mention this book. src/app/api/entities/route.ts.' },
  { collection: 'entities', key: { 'name': 1, 'type': 1 }, options: { 'name': 'name_1_type_1', 'unique': true }, why: 'Unique (name, type) — the entity identity key. src/app/api/entities/route.ts.' },
  { collection: 'entities', key: { 'type': 1 }, options: { 'name': 'type_1' }, why: 'Type filter for entity listings. src/app/api/entities/route.ts.' },
  { collection: 'entities', key: { 'book_count': -1 }, options: { 'name': 'book_count_-1' }, why: 'Default sort for entity listings. src/app/api/entities/route.ts.' },
  { collection: 'entities', key: { 'name': 1, 'book_count': -1, 'total_mentions': -1 }, options: { 'name': 'name_1_book_count_-1_total_mentions_-1' }, why: 'Name search sorted by book_count/total_mentions ({q searches name and aliases}.sort({book_count:-1, total_mentions:-1})). src/app/api/entities/route.ts.' },
  { collection: 'entities', key: { 'aliases': 1 }, options: { 'name': 'entities_aliases_idx', 'background': true }, why: 'Alias search (\'q: search query (searches name and aliases)\'). src/app/api/entities/route.ts.' },
  { collection: 'entities', key: { 'wikidata_birth_date': 1 }, options: { 'name': 'wikidata_birth_date_partial', 'partialFilterExpression': { 'wikidata_birth_date': { '$exists': true } } }, why: 'Partial index for /explore/timeline + /explore hub stats + /api/explore/map, only a few thousand entities have Wikidata enrichment. scripts/maintenance/create-entities-wikidata-indexes.mjs (the #2973 timeline-outage fix).' },
  { collection: 'entities', key: { 'wikidata_death_date': 1 }, options: { 'name': 'wikidata_death_date_partial', 'partialFilterExpression': { 'wikidata_death_date': { '$exists': true } } }, why: 'Same as wikidata_birth_date_partial. scripts/maintenance/create-entities-wikidata-indexes.mjs.' },
  { collection: 'entities', key: { 'wikidata_coordinates': 1 }, options: { 'name': 'wikidata_coordinates_partial', 'partialFilterExpression': { 'wikidata_coordinates': { '$exists': true } } }, why: 'Same as wikidata_birth_date_partial — backs /api/explore/map. scripts/maintenance/create-entities-wikidata-indexes.mjs.' },
  { collection: 'entities', key: { 'wikidata_id': 1 }, options: { 'name': 'wikidata_id_partial', 'partialFilterExpression': { 'wikidata_id': { '$exists': true } } }, why: 'Same as wikidata_birth_date_partial. scripts/maintenance/create-entities-wikidata-indexes.mjs.' },
  // ── entity_aliases ────────────────────────────────────────────
  { collection: 'entity_aliases', key: { 'canonical_name': 1, 'type': 1 }, options: { 'name': 'canonical_name_1_type_1' }, why: 'Authority-record lookup by canonical name + type. scripts/enrichment/dedup-entities.mjs.' },
  { collection: 'entity_aliases', key: { 'cerl_id': 1 }, options: { 'name': 'cerl_id_1', 'sparse': true }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'entity_aliases', key: { 'viaf_id': 1 }, options: { 'name': 'viaf_id_1', 'sparse': true }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'entity_aliases', key: { 'surnames': 1 }, options: { 'name': 'surnames_1' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'entity_aliases', key: { 'names': 1 }, options: { 'name': 'names_1' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'entity_aliases', key: { 'wikidata_qid': 1 }, options: { 'name': 'wikidata_qid_1', 'unique': true, 'partialFilterExpression': { 'wikidata_qid': { '$type': 'string' } } }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'entity_aliases', key: { 'alias_lower': 1, 'type': 1 }, options: { 'name': 'alias_lower_1_type_1', 'partialFilterExpression': { 'alias_lower': { '$type': 'string' } } }, why: 'Case-folded alias lookup, unique, partial (alias_lower is a string). scripts/enrichment/dedup-entities.mjs.' },
  // ── erara_catalog ─────────────────────────────────────────────
  { collection: 'erara_catalog', key: { 'id': 1 }, options: { 'name': 'id_1', 'unique': true }, why: 'Unique catalog-record id. scripts/catalog-coverage/harvest-erara-catalog.mjs.' },
  { collection: 'erara_catalog', key: { 'title': 'text' }, options: { 'name': 'title_text', 'weights': { 'title': 1 }, 'default_language': 'english', 'language_override': 'language' }, why: 'Free-text title search over the harvested e-rara catalog. No exact creation script found in-repo — the `key` here is reconstructed from the live index\'s reported `weights: {title:1}`, not from a checked-in createIndex() call. Verify before treating this manifest entry as authoritative.' },
  // ── external_catalog ──────────────────────────────────────────
  { collection: 'external_catalog', key: { 'source': 1 }, options: { 'name': 'source_1' }, why: 'Catalog-search filters/sort backing /api/catalog/search and the metadata-verification workers (scripts/enrichment/verify-metadata-from-catalogs.mjs, verify-metadata-llm.mjs). No dedicated creation script found in-repo.' },
  { collection: 'external_catalog', key: { 'title': 1 }, options: { 'name': 'title_1' }, why: 'Catalog-search filters/sort backing /api/catalog/search and the metadata-verification workers (scripts/enrichment/verify-metadata-from-catalogs.mjs, verify-metadata-llm.mjs). No dedicated creation script found in-repo.' },
  { collection: 'external_catalog', key: { 'author': 1 }, options: { 'name': 'author_1' }, why: 'Catalog-search filters/sort backing /api/catalog/search and the metadata-verification workers (scripts/enrichment/verify-metadata-from-catalogs.mjs, verify-metadata-llm.mjs). No dedicated creation script found in-repo.' },
  { collection: 'external_catalog', key: { 'year': 1 }, options: { 'name': 'year_1' }, why: 'Catalog-search filters/sort backing /api/catalog/search and the metadata-verification workers (scripts/enrichment/verify-metadata-from-catalogs.mjs, verify-metadata-llm.mjs). No dedicated creation script found in-repo.' },
  // ── failed_imports ────────────────────────────────────────────
  { collection: 'failed_imports', key: { 'source_id': 1 }, options: { 'name': 'source_id_1', 'unique': true }, why: 'Unique per-source id — prevents re-processing a failed import twice (no exact creation script found in-repo).' },
  // ── ft_reverify_proposal ──────────────────────────────────────
  { collection: 'ft_reverify_proposal', key: { 'book_id': 1 }, options: { 'name': 'book_id_1', 'unique': true }, why: 'One reverify proposal per book, unique. scripts/analysis/ft-ground-remediation.mjs.' },
  // ── gallery_collections ───────────────────────────────────────
  { collection: 'gallery_collections', key: { 'slug': 1 }, options: { 'name': 'gallery_collections_slug_idx', 'background': true, 'unique': true }, why: 'Collection-page slug lookup, unique. Archived ensure-indexes route.' },
  { collection: 'gallery_collections', key: { 'featured': 1, 'sort_order': 1 }, options: { 'name': 'gallery_collections_featured_idx', 'background': true }, why: 'Featured-listing sort. Archived ensure-indexes route.' },
  { collection: 'gallery_collections', key: { 'book_collection_slug': 1 }, options: { 'name': 'book_collection_slug_1', 'sparse': true }, why: 'Per-book gallery-collection lookup used by /api/gallery/collections and /api/gallery/collections/[slug]. No exact creation script found in-repo.' },
  { collection: 'gallery_collections', key: { 'type': 1, 'sort_order': 1 }, options: { 'name': 'type_1_sort_order_1' }, why: 'Type-scoped ordering, a variant of gallery_collections_featured_idx. No exact creation script found in-repo.' },
  // ── gallery_embeddings ────────────────────────────────────────
  { collection: 'gallery_embeddings', key: { 'id': 1 }, options: { 'name': 'gallery_embeddings_id_idx', 'background': true, 'unique': true }, why: 'Unique id lookup. Archived ensure-indexes route.' },
  { collection: 'gallery_embeddings', key: { 'book_id': 1 }, options: { 'name': 'gallery_embeddings_book_idx', 'background': true }, why: 'Lookup by book. Archived ensure-indexes route.' },
  // ── gallery_images ────────────────────────────────────────────
  { collection: 'gallery_images', key: { 'id': 1 }, options: { 'name': 'gallery_images_id_idx', 'background': true, 'unique': true }, why: 'Unique id lookup, used by worker upserts. Archived ensure-indexes route.' },
  { collection: 'gallery_images', key: { 'gallery_quality': -1 }, options: { 'name': 'gallery_images_quality_idx', 'background': true }, why: 'Default gallery sort by quality. Archived ensure-indexes route.' },
  { collection: 'gallery_images', key: { 'book_id': 1, 'gallery_quality': -1 }, options: { 'name': 'gallery_images_book_quality_idx', 'background': true }, why: 'Book filter + quality sort. Archived ensure-indexes route.' },
  { collection: 'gallery_images', key: { 'type': 1 }, options: { 'name': 'gallery_images_type_idx', 'background': true }, why: 'Type filter. Archived ensure-indexes route.' },
  { collection: 'gallery_images', key: { 'metadata.subjects': 1 }, options: { 'name': 'gallery_images_subjects_idx', 'background': true }, why: 'Subject filter. Archived ensure-indexes route.' },
  { collection: 'gallery_images', key: { 'book_year': 1 }, options: { 'name': 'gallery_images_year_idx', 'background': true }, why: 'Year filter. Archived ensure-indexes route.' },
  { collection: 'gallery_images', key: { 'book_rank': 1 }, options: { 'name': 'gallery_images_rank_idx', 'background': true }, why: 'book_rank diversity filter. Archived ensure-indexes route.' },
  { collection: 'gallery_images', key: { 'page_id': 1 }, options: { 'name': 'gallery_images_page_idx', 'background': true }, why: 'page_id lookup for worker upserts. Archived ensure-indexes route.' },
  { collection: 'gallery_images', key: { 'gallery_quality': -1, 'book_year': 1, 'book_id': 1, 'page_number': 1 }, options: { 'name': 'gallery_quality_-1_book_year_1_book_id_1_page_number_1' }, why: 'Backs the main /api/gallery browse query: sort by gallery_quality desc, filter by book_year, diversify by book_id/page_number (src/app/api/gallery/route.ts, src/lib/gallery-merge.ts). No exact creation script found in-repo.' },
  { collection: 'gallery_images', key: { 'book_hidden': 1, 'gallery_quality': -1 }, options: { 'name': 'gallery_images_showcase_idx', 'background': true }, why: 'Homepage/showcase query excluding hidden books, sorted by quality ({ book_hidden: true } excluded, src/app/api/gallery/route.ts:711). No exact creation script found in-repo.' },
  { collection: 'gallery_images', key: { 'book_author': 'text', 'book_title': 'text', 'description': 'text', 'metadata.figures': 'text', 'metadata.subjects': 'text', 'metadata.symbols': 'text', 'museum_description': 'text' }, options: { 'name': 'gallery_images_text_idx', 'background': true, 'weights': { 'book_author': 1, 'book_title': 1, 'description': 5, 'metadata.figures': 2, 'metadata.subjects': 2, 'metadata.symbols': 2, 'museum_description': 3 }, 'default_language': 'english', 'language_override': 'language' }, why: 'Free-text gallery search (description/subjects/figures/symbols), used by src/lib/embassy/librarian.ts. No exact creation script found in-repo — the `key` here is reconstructed from the live index\'s reported `weights` map, not from a checked-in createIndex() call. Verify before treating this manifest entry as authoritative.' },
  { collection: 'gallery_images', key: { 'metadata.iconclass': 1 }, options: { 'name': 'metadata_iconclass_sparse', 'background': true, 'sparse': true }, why: 'Iconclass-code filter, sparse. scripts/backfill-iconclass-gallery.mjs / scripts/compute-iconclass-tree.mjs, consumed by src/app/api/gallery/route.ts.' },
  // ── gemini_usage ──────────────────────────────────────────────
  { collection: 'gemini_usage', key: { 'book_id': 1, 'timestamp': 1 }, options: { 'name': 'gemini_usage_book_ts_idx', 'background': true }, why: 'History/cost queries by book_id. Archived ensure-indexes route.' },
  { collection: 'gemini_usage', key: { 'type': 1, 'status': 1, 'book_id': 1 }, options: { 'name': 'gemini_usage_type_status_book_idx', 'background': true }, why: 'Processing-overview aggregation by type+status+book. Archived ensure-indexes route.' },
  { collection: 'gemini_usage', key: { 'type': 1, 'timestamp': -1 }, options: { 'name': 'type_timestamp', 'background': true }, why: 'Type + timestamp scans. Variant of the archived route\'s intent; no exact creation script found for this specific name.' },
  { collection: 'gemini_usage', key: { 'timestamp': 1 }, options: { 'name': 'timestamp_1', 'background': true }, why: 'Plain timestamp range index — retention is manual per #2976 decision 2026-07-05; TTL removed (was gemini_usage_ttl_90d, 90d). Index kept for query support — CRITICAL per the archived route: \'Without this, 1.4M doc collection scan causes 504 timeouts\'. Swapped from TTL by scripts/maintenance/swap-ttl-to-plain-indexes.mjs post-deploy.' },
  // ── gemini_usage_daily ────────────────────────────────────────
  { collection: 'gemini_usage_daily', key: { 'date': -1 }, options: { 'name': 'gemini_usage_daily_date_idx', 'unique': true }, why: 'Unique pre-aggregated daily summary key. Archived ensure-indexes route.' },
  // ── highlights ────────────────────────────────────────────────
  { collection: 'highlights', key: { 'book_id': 1, 'page_id': 1 }, options: { 'name': 'highlights_book_page_idx', 'background': true }, why: 'Lookup by book + page. Archived ensure-indexes route.' },
  // ── iiif_manifests ────────────────────────────────────────────
  { collection: 'iiif_manifests', key: { 'manifest_url': 1 }, options: { 'name': 'manifest_url_1', 'unique': true }, why: 'Unique manifest URL — the IIIF discovery dedup key. scripts/iiif-discovery/lib/manifest-store.mjs.' },
  { collection: 'iiif_manifests', key: { 'book_id': 1 }, options: { 'name': 'book_id_1' }, why: 'Lookup by imported book. scripts/iiif-discovery/lib/manifest-store.mjs.' },
  { collection: 'iiif_manifests', key: { 'source': 1 }, options: { 'name': 'source_1' }, why: 'Filter by discovery source. scripts/iiif-discovery/lib/manifest-store.mjs.' },
  { collection: 'iiif_manifests', key: { 'fetched_at': 1 }, options: { 'name': 'fetched_at_1' }, why: 'Time-range queries on fetch recency. scripts/iiif-discovery/lib/manifest-store.mjs.' },
  { collection: 'iiif_manifests', key: { 'error': 1 }, options: { 'name': 'error_1' }, why: 'Filter manifests that failed to fetch. scripts/iiif-discovery/lib/manifest-store.mjs.' },
  { collection: 'iiif_manifests', key: { 'decision': 1, 'dedup_status': 1, 'provider': 1 }, options: { 'name': 'decision_1_dedup_status_1_provider_1' }, why: 'FRBR-clustering dedup workflow (decision/dedup_status/provider fields set by scripts/iiif-discovery/dedupe-candidates.mjs). No exact creation script found in-repo.' },
  // ── import_candidates ─────────────────────────────────────────
  { collection: 'import_candidates', key: { 'source': 1, 'status': 1 }, options: { 'name': 'source_1_status_1' }, why: 'Per-source status filtering across the harvest pipeline. scripts/iiif-discovery/lib/candidate-store.mjs.' },
  { collection: 'import_candidates', key: { 'status': 1, 'date_earliest': 1 }, options: { 'name': 'status_1_date_earliest_1' }, why: 'Status + earliest-date filter for triage ordering. scripts/iiif-discovery/lib/candidate-store.mjs.' },
  { collection: 'import_candidates', key: { 'source': 1, 'source_id': 1 }, options: { 'name': 'source_1_source_id_1' }, why: 'Per-source id dedup key. scripts/iiif-discovery/lib/candidate-store.mjs.' },
  { collection: 'import_candidates', key: { 'normalized_title': 1, 'normalized_author': 1 }, options: { 'name': 'normalized_title_1_normalized_author_1' }, why: 'Title+author de-dup lookup, mirrors the books/books_warehouse pattern. scripts/iiif-discovery/lib/candidate-store.mjs.' },
  { collection: 'import_candidates', key: { 'ia_identifier': 1, 'source': 1 }, options: { 'name': 'ia_identifier_source', 'sparse': true }, why: 'IA-identifier de-dup, sparse. scripts/catalog-coverage/harvest-ia-english.mjs.' },
  { collection: 'import_candidates', key: { 'oai_id': 1, 'source': 1 }, options: { 'name': 'oai_id_source', 'sparse': true }, why: 'OAI-id de-dup, sparse. scripts/catalog-coverage/harvest-oai-libraries.mjs / harvest-vatican.mjs.' },
  { collection: 'import_candidates', key: { 'manifest_url': 1 }, options: { 'name': 'manifest_url_lookup', 'sparse': true }, why: 'Manifest-URL lookup, sparse (not unique — duplicate-manifest rows are resolved by dedupe-candidates.mjs\'s FRBR clustering, not deletion; ~91K rows also have a null manifest_url). scripts/iiif-discovery/lib/candidate-store.mjs.' },
  { collection: 'import_candidates', key: { 'ndl_id': 1, 'source': 1 }, options: { 'name': 'ndl_id_source', 'sparse': true }, why: 'NDL-id de-dup, sparse. scripts/catalog-coverage/harvest-ndl-daoist.mjs.' },
  { collection: 'import_candidates', key: { 'author_surname': 1 }, options: { 'name': 'surname_manifest', 'partialFilterExpression': { 'manifest_url': { '$exists': true } } }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  // ── jobs ──────────────────────────────────────────────────────
  { collection: 'jobs', key: { 'book_id': 1, 'type': 1, 'status': 1 }, options: { 'name': 'jobs_book_type_status_idx', 'background': true }, why: 'Pipeline status lookup { book_id, type, status }. Archived ensure-indexes route.' },
  { collection: 'jobs', key: { 'id': 1, 'status': 1 }, options: { 'name': 'id_1_status_1' }, why: 'Active-job lookup by id+status, used by scripts/batch/queue-translations.mjs and queue-ocr-direct.mjs. No exact creation script found in-repo.' },
  { collection: 'jobs', key: { 'status': 1, 'updated_at': -1 }, options: { 'name': 'jobs_status_updated_idx', 'background': true }, why: 'Status + updated_at scans for stale/active job detection. No exact creation script found in-repo.' },
  // ── kloss_catalog ─────────────────────────────────────────────
  { collection: 'kloss_catalog', key: { 'priref': 1 }, options: { 'name': 'priref_1', 'unique': true }, why: 'Unique catalog record id. scripts/one-off/scrape-kloss-catalog.mjs.' },
  { collection: 'kloss_catalog', key: { 'is_kloss': 1 }, options: { 'name': 'is_kloss_1' }, why: 'Kloss-collection membership filter. scripts/one-off/scrape-kloss-catalog.mjs.' },
  { collection: 'kloss_catalog', key: { 'has_digital_copy': 1 }, options: { 'name': 'has_digital_copy_1' }, why: 'Digitization-status filter. scripts/one-off/scrape-kloss-catalog.mjs.' },
  { collection: 'kloss_catalog', key: { 'year': 1 }, options: { 'name': 'year_1' }, why: 'Year filter. scripts/one-off/scrape-kloss-catalog.mjs.' },
  { collection: 'kloss_catalog', key: { 'authors': 1 }, options: { 'name': 'authors_1' }, why: 'Author filter. scripts/one-off/scrape-kloss-catalog.mjs.' },
  // ── latin_translations_census ─────────────────────────────────
  { collection: 'latin_translations_census', key: { '_author_surname': 1 }, options: { 'name': '_author_surname_1' }, why: 'Cross-reference lookup for the Latin translations census. scripts/_archived/2026-07-hygiene/analysis/cross-reference-translations.mjs (script since archived; index remains live).' },
  { collection: 'latin_translations_census', key: { '_canonical_author_norm': 1 }, options: { 'name': '_canonical_author_norm_1' }, why: 'Cross-reference lookup for the Latin translations census. scripts/_archived/2026-07-hygiene/analysis/cross-reference-translations.mjs (script since archived; index remains live).' },
  { collection: 'latin_translations_census', key: { '_canonical_work_norm': 1 }, options: { 'name': '_canonical_work_norm_1' }, why: 'Cross-reference lookup for the Latin translations census. scripts/_archived/2026-07-hygiene/analysis/cross-reference-translations.mjs (script since archived; index remains live).' },
  // ── likes ─────────────────────────────────────────────────────
  { collection: 'likes', key: { 'target_type': 1, 'target_id': 1, 'visitor_id': 1 }, options: { 'name': 'likes_target_visitor_idx', 'background': true, 'unique': true }, why: 'Toggle lookup { target_type, target_id, visitor_id }, unique. Archived ensure-indexes route.' },
  { collection: 'likes', key: { 'target_type': 1, 'target_id': 1 }, options: { 'name': 'likes_target_idx', 'background': true }, why: 'Count aggregation by target. Archived ensure-indexes route.' },
  { collection: 'likes', key: { 'visitor_id': 1, 'target_type': 1 }, options: { 'name': 'likes_visitor_type_idx', 'background': true }, why: 'Visitor\'s likes lookup. Archived ensure-indexes route.' },
  // ── loading_metrics ───────────────────────────────────────────
  { collection: 'loading_metrics', key: { 'received_at': -1 }, options: { 'name': 'loading_metrics_received_at_idx' }, why: 'Time-range scans for the performance dashboard. Archived ensure-indexes route / scripts/maintenance/create-critical-indexes.mjs.' },
  { collection: 'loading_metrics', key: { 'name': 1, 'received_at': -1 }, options: { 'name': 'loading_metrics_name_ts_idx', 'background': true }, why: 'Metric-name-filtered time range queries. Archived ensure-indexes route.' },
  { collection: 'loading_metrics', key: { 'timestamp': 1 }, options: { 'name': 'ttl_30d_timestamp', 'expireAfterSeconds': 2592000 }, why: '30-day TTL on a Date `timestamp` field — deliberate heartbeat retention per Derek 2026-07-05 (#2976, "nine minus the heartbeats"). Original creator (scripts/maintenance/create-ttl-indexes.mjs) is retired; this manifest is now the canonical spec.' },
  { collection: 'loading_metrics', key: { 'received_at': 1 }, options: { 'name': 'ttl_received_at_30d', 'expireAfterSeconds': 2592000 }, why: '30-day TTL on `received_at` — deliberate heartbeat retention per Derek 2026-07-05 (#2976). Original creator (create-ttl-indexes.mjs, retired) noted received_at may be numeric rather than Date — if so this TTL never expired anything anyway.' },
  // ── mcp_tool_calls ────────────────────────────────────────────
  { collection: 'mcp_tool_calls', key: { 'ip_hash': 1, 'ts': -1 }, options: { 'name': 'ip_hash_1_ts_-1' }, why: 'Per-client analysis for the MCP tool-call log. src/lib/mcp-usage.ts.' },
  { collection: 'mcp_tool_calls', key: { 'tool': 1, 'ts': -1 }, options: { 'name': 'tool_1_ts_-1' }, why: '\'How is tool X doing\' queries. src/lib/mcp-usage.ts.' },
  { collection: 'mcp_tool_calls', key: { 'ts': 1 }, options: { 'name': 'ts_1' }, why: 'Plain ts range index — retention is manual per #2976 decision 2026-07-05; TTL removed (was 90d). src/lib/mcp-usage.ts ensureIndexes(), created lazily; live TTL swapped to plain by scripts/maintenance/swap-ttl-to-plain-indexes.mjs post-deploy.' },
  // ── mcp_clients ───────────────────────────────────────────────
  { collection: 'mcp_clients', key: { 'ts': 1 }, options: { 'name': 'ts_1' }, why: 'Plain ts range index — retention is manual per #2976. src/lib/mcp-usage.ts ensureClientIndexes(), created lazily.' },
  { collection: 'mcp_clients', key: { 'client_name': 1, 'ts': -1 }, options: { 'name': 'client_name_1_ts_-1' }, why: '\'How many distinct clients / which ones\' queries over the MCP initialize handshake. src/lib/mcp-usage.ts.' },
  { collection: 'mcp_clients', key: { 'ip_hash': 1, 'ts': -1 }, options: { 'name': 'ip_hash_1_ts_-1' }, why: 'Per-client-IP analysis of MCP handshakes. src/lib/mcp-usage.ts.' },
  // ── correction_events ─────────────────────────────────────────
  { collection: 'correction_events', key: { 'page_id': 1, 'created_at': -1 }, options: { 'name': 'correction_events_page_idx', 'background': true }, why: 'Corrections for a page, newest first. src/lib/correction-events.ts (#3241).' },
  { collection: 'correction_events', key: { 'field': 1, 'created_at': -1 }, options: { 'name': 'correction_events_field_idx', 'background': true }, why: 'Eval-side mining: all OCR (or translation) corrections in time order (#3241).' },
  // ── page_revisions ────────────────────────────────────────────
  { collection: 'page_revisions', key: { 'page_id': 1, 'field': 1, 'created_at': -1 }, options: { 'name': 'page_revisions_page_field_idx', 'background': true }, why: 'Lookup by page + field, newest first (revision history). Archived ensure-indexes route.' },
  { collection: 'page_revisions', key: { 'id': 1 }, options: { 'name': 'page_revisions_id_idx', 'background': true, 'unique': true }, why: 'Unique id lookup. Archived ensure-indexes route.' },
  // ── pages ─────────────────────────────────────────────────────
  { collection: 'pages', key: { 'book_id': 1, 'page_number': 1 }, options: { 'name': 'pages_book_pagenum_idx', 'background': true }, why: 'Lookup by book_id + page_number — the core reader-page query. Archived ensure-indexes route.' },
  { collection: 'pages', key: { 'id': 1 }, options: { 'name': 'pages_id_idx', 'background': true, 'unique': true }, why: 'Unique page id lookup. Archived ensure-indexes route.' },
  { collection: 'pages', key: { 'detected_images.gallery_quality': -1, 'book_id': 1, 'page_number': 1 }, options: { 'name': 'pages_gallery_quality_idx', 'background': true, 'sparse': true }, why: 'Gallery aggregation sort by gallery_quality desc, sparse. Archived ensure-indexes route.' },
  { collection: 'pages', key: { 'translation.updated_at': -1 }, options: { 'name': 'pages_translation_updated_idx', 'background': true, 'sparse': true }, why: 'Recent-translation-throughput queries, sparse (916k pages). Archived ensure-indexes route.' },
  { collection: 'pages', key: { 'ocr.updated_at': -1 }, options: { 'name': 'pages_ocr_updated_idx', 'sparse': true }, why: 'Recent-OCR-throughput queries, sparse (1.84M pages). Archived ensure-indexes route.' },
  { collection: 'pages', key: { 'page_type': 1, 'book_id': 1, 'page_number': 1 }, options: { 'name': 'pages_page_type_book_idx', 'background': true, 'partialFilterExpression': { 'page_type': { '$exists': true } } }, why: 'Cover-thumbnail backfill: filter by page_type within a book, partial (page_type exists). scripts/thumbnails/backfill-covers.mjs.' },
  { collection: 'pages', key: { 'archive_metadata.last_failure_at': 1 }, options: { 'name': 'archive_failure_at_sparse', 'background': true, 'sparse': true }, why: 'Archive-retry queries filtering on archive_metadata.last_failure_at, sparse — without it these full-scan the pages collection. Recommended verbatim in scripts/maintenance/cleanup-dead-pages.mjs (which suggests the identical createIndex for pages_warehouse); this live copy is the pages-collection equivalent.' },
  { collection: 'pages', key: { 'detected_images.0': 1, 'image_extraction_updated_at': 1 }, options: { 'name': 'detected_images_0_image_extraction_updated_at' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978' },
  { collection: 'pages', key: { 'split_from_spread': 1 }, options: { 'name': 'pages_split_from_spread_idx', 'background': true }, why: 'Split-page filter for the spread-OCR corruption audits (#2298/#2297). NOTE: this live index is a single-field { split_from_spread: 1 }, but the checked-in creator script scripts/maintenance/create-split-from-spread-index.mjs targets a DIFFERENT compound key { split_from_spread: 1, \'ocr.model\': 1 } named pages_split_from_spread_ocr_idx, which is NOT live. Investigate before running that script — it would add a second index on the same field rather than replace this one.' },
  { collection: 'pages', key: { 'read_count': 1 }, options: { 'name': 'read_count_ge3_partial', 'partialFilterExpression': { 'read_count': { '$gte': 3 } } }, why: 'Partial index on the read counter (filter constant at 3, the default floor) so the reading-recommendation candidate query doesn\'t full-scan the millions-row pages collection. scripts/seo/flag-indexable-pages.mjs.' },
  { collection: 'pages', key: { 'seo_indexable': 1, '_id': 1 }, options: { 'name': 'seo_indexable_id_partial', 'partialFilterExpression': { 'seo_indexable': true } }, why: 'Partial index on the seo_indexable flag, compound on _id so the sitemap\'s sort({_id:1}) paginated query is served by the index (a single-field version made the planner full-scan in _id order and time out). scripts/seo/flag-indexable-pages.mjs, consumed by src/app/sitemap.ts.' },
  // ── pages_warehouse ───────────────────────────────────────────
  { collection: 'pages_warehouse', key: { 'book_id': 1, 'page_number': 1 }, options: { 'name': 'book_id_1_page_number_1' }, why: 'Lookup by book + page in the warehouse copy. scripts/migration/warehouse-migration.mjs.' },
  { collection: 'pages_warehouse', key: { 'book_id': 1 }, options: { 'name': 'book_id_1', 'hidden': true }, why: 'Lookup by book in the warehouse copy. scripts/migration/warehouse-migration.mjs.' },
  // ── pipeline_snapshots ────────────────────────────────────────
  { collection: 'pipeline_snapshots', key: { 'timestamp': -1 }, options: { 'name': 'pipeline_snapshots_ts_idx' }, why: 'Time-range scans for pipeline velocity charts. Archived ensure-indexes route / scripts/maintenance/create-critical-indexes.mjs.' },
  // ── rate_limits ───────────────────────────────────────────────
  { collection: 'rate_limits', key: { 'expireAt': 1 }, options: { 'name': 'expireAt_1', 'expireAfterSeconds': 0 }, why: 'TTL index so rate-limit window docs self-expire (expireAfterSeconds: 0 — Mongo drops the doc at expireAt). src/lib/rate-limit.ts ensureRateLimitIndex().' },
  // ── revoked_tokens ────────────────────────────────────────────
  { collection: 'revoked_tokens', key: { 'tenant_id': 1, 'id': 1 }, options: { 'name': 'tenant_id_1_id_1', 'unique': true }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978 (no current code references this collection — possibly orphaned from a removed token-revocation feature; verify before assuming it\'s dead.)' },
  { collection: 'revoked_tokens', key: { 'expires_at': 1 }, options: { 'name': 'expires_at_1', 'expireAfterSeconds': 0 }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978 (same collection as tenant_id_1_id_1 above — no current code references this collection.)' },
  // ── search_queries ────────────────────────────────────────────
  { collection: 'search_queries', key: { 'ts': 1 }, options: { 'name': 'ts_1' }, why: 'Plain ts range index on the direct-search query log — retention is manual per #2976 decision 2026-07-05; TTL removed (was 90d). src/lib/search-log.ts ensureIndexes(); live TTL swapped to plain by scripts/maintenance/swap-ttl-to-plain-indexes.mjs post-deploy.' },
  { collection: 'search_queries', key: { 'ip_hash': 1, 'ts': -1 }, options: { 'name': 'ip_hash_1_ts_-1' }, why: 'Per-client analysis. src/lib/search-log.ts.' },
  { collection: 'search_queries', key: { 'route': 1, 'ts': -1 }, options: { 'name': 'route_1_ts_-1' }, why: 'Per-route analysis (/api/search vs /api/search/semantic). src/lib/search-log.ts.' },
  // ── signup_interest ───────────────────────────────────────────
  { collection: 'signup_interest', key: { 'email': 1 }, options: { 'name': 'email_1', 'unique': true }, why: 'Unique email — one signup-interest row per address, read by scripts/workers/refresh-newsletter-audience.mjs when building the newsletter audience union. No exact creation script found in-repo (likely enforced at signup-form insert time).' },
  // ── social_tags ───────────────────────────────────────────────
  { collection: 'social_tags', key: { 'audience': 1 }, options: { 'name': 'audience_1' }, why: 'Audience filter on GET /api/social/tags. No exact creation script found in-repo.' },
  { collection: 'social_tags', key: { 'handle': 1 }, options: { 'name': 'handle_1', 'unique': true }, why: 'Unique handle lookup for GET /api/social/tags/[handle]. No exact creation script found in-repo.' },
  { collection: 'social_tags', key: { 'active': 1, 'audience': 1, 'priority': -1 }, options: { 'name': 'active_1_audience_1_priority_-1' }, why: 'Default listing query: active tags for an audience, sorted by priority. src/app/api/social/tags/route.ts.' },
  // ── tenants ───────────────────────────────────────────────────
  { collection: 'tenants', key: { 'id': 1 }, options: { 'name': 'id_1' }, why: 'NOTE: current tenant lookups query by `slug` (db.collection(\'tenants\').findOne({slug:...}), seen across scripts/backfill-bph-allard-pierson.mjs, dedupe-bph-shared-ubn.mjs, audit/search-tenant-purity.mjs, etc.), not `id`. This index may be a leftover from an earlier schema convention — verify whether a slug index also exists / is needed before relying on this one.' },
  // ── translation_backup_683a_2026_05_31 ────────────────────────
  { collection: 'translation_backup_683a_2026_05_31', key: { 'page_id': 1 }, options: { 'name': 'page_id_1' }, why: 'UNKNOWN — found live 2026-07-05, triage in #2978 (dated backup collection name suggests a one-off snapshot around 2026-05-31; verify it\'s still needed before treating the index as load-bearing.)' },
  // ── translation_catalogs ──────────────────────────────────────
  { collection: 'translation_catalogs', key: { 'author_normalized': 'text', 'english_title_normalized': 'text', 'original_title_normalized': 'text', 'canonical_author_normalized': 'text', 'canonical_work_normalized': 'text' }, options: { 'name': 'translation_catalogs_text_idx', 'weights': { 'author_normalized': 1, 'canonical_author_normalized': 1, 'canonical_work_normalized': 1, 'english_title_normalized': 1, 'original_title_normalized': 1 }, 'default_language': 'none', 'language_override': 'language' }, why: 'Free-text search across normalized author/title fields. scripts/enrichment/import-translation-catalogs.mjs.' },
  { collection: 'translation_catalogs', key: { 'author_surname': 1 }, options: { 'name': 'tc_author_surname_idx' }, why: 'Author-surname filter. scripts/enrichment/import-translation-catalogs.mjs.' },
  { collection: 'translation_catalogs', key: { 'canonical_author_normalized': 1 }, options: { 'name': 'tc_canonical_author_idx' }, why: 'Canonical-author filter. scripts/enrichment/import-translation-catalogs.mjs.' },
  { collection: 'translation_catalogs', key: { 'source': 1 }, options: { 'name': 'tc_source_idx' }, why: 'Source-catalog filter. scripts/enrichment/import-translation-catalogs.mjs.' },
  // ── translation_classification ────────────────────────────────
  { collection: 'translation_classification', key: { 'book_id': 1 }, options: { 'name': 'book_id_1', 'unique': true }, why: 'One classification per book, unique. scripts/analysis/classify-first-translations.mjs.' },
  { collection: 'translation_classification', key: { 'classification': 1 }, options: { 'name': 'classification_1' }, why: 'Classification-value filter. scripts/analysis/classify-first-translations.mjs.' },
  { collection: 'translation_classification', key: { 'confidence': -1 }, options: { 'name': 'confidence_-1' }, why: 'Confidence sort. scripts/analysis/classify-first-translations.mjs.' },
  // ── uptime_checks ─────────────────────────────────────────────
  { collection: 'uptime_checks', key: { 'checked_at': 1 }, options: { 'name': 'checked_at_1', 'background': true, 'expireAfterSeconds': 2592000 }, why: '30-day TTL on uptime-monitor results — deliberate heartbeat retention per Derek 2026-07-05 (#2976, "nine minus the heartbeats"). Creator: scripts/uptime-monitor.mjs.' },
  { collection: 'uptime_checks', key: { 'endpoint': 1, 'checked_at': -1 }, options: { 'name': 'endpoint_1_checked_at_-1', 'background': true }, why: 'Per-endpoint check history, newest first — backs the uptime API route. scripts/uptime-monitor.mjs.' },
  // ── ustc_holdings ─────────────────────────────────────────────
  { collection: 'ustc_holdings', key: { 'ustc_sn': 1 }, options: { 'name': 'ustc_sn_1', 'unique': true }, why: 'Unique USTC serial-number key. scripts/catalog-coverage/harvest-ustc-holdings.mjs.' },
  // ── views ─────────────────────────────────────────────────────
  { collection: 'views', key: { 'target_type': 1, 'target_id': 1 }, options: { 'name': 'views_target_idx', 'unique': true }, why: 'Unique (target_type, target_id) view-counter key, documented inline: \'Index (created 2026-06-03): unique on (target_type, target_id)\' in src/app/api/views/route.ts.' },];

/**
 * Compare a manifest option bag against a live index's reported options to
 * decide whether they're "the same index" for drift-reporting purposes.
 * Only compares fields that affect matching semantics — not `background`
 * (deprecated, ignored by modern MongoDB) and not `v` (internal index version).
 */
const SEMANTIC_OPTION_KEYS = ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds', 'weights', 'default_language', 'language_override'];

function isTextIndexKey(key) {
  return Object.values(key).some((v) => v === 'text') || '_fts' in key;
}

function keysEqual(manifestKey, liveKey) {
  // MongoDB's listIndexes() reports text indexes as { _fts: 'text', _ftsx: 1 }
  // regardless of which fields were actually marked 'text' — the real field
  // list only shows up in `weights`. So for text indexes, the key itself is
  // never comparable; fall back to comparing `weights` in optionsEqual().
  if (isTextIndexKey(manifestKey) && isTextIndexKey(liveKey)) return true;
  return JSON.stringify(manifestKey) === JSON.stringify(liveKey);
}

function optionsEqual(manifestOpts, liveOpts) {
  for (const k of SEMANTIC_OPTION_KEYS) {
    const a = manifestOpts[k];
    const b = liveOpts[k];
    if (a === undefined && b === undefined) continue;
    if (JSON.stringify(a) !== JSON.stringify(b)) return false;
  }
  return true;
}

/**
 * Compute drift between the manifest and a fresh live dump.
 * Never mutates anything — pure comparison, safe to call from a read-only
 * health check.
 *
 * @param {import('mongodb').Db} db
 * @returns {Promise<{missingFromLive: IndexSpec[], unknownLive: {collection: string, name: string, key: unknown}[], mismatched: {collection: string, name: string, reason: string}[]}>}
 */
export async function computeIndexDrift(db) {
  const missingFromLive = [];
  const unknownLive = [];
  const mismatched = [];

  const collectionsInManifest = [...new Set(INDEXES.map((i) => i.collection))];
  const liveByCollection = new Map();
  for (const collection of collectionsInManifest) {
    try {
      liveByCollection.set(collection, await db.collection(collection).indexes());
    } catch {
      liveByCollection.set(collection, []); // collection doesn't exist live
    }
  }

  // Manifest -> live: anything the manifest expects that isn't live is a warning.
  for (const spec of INDEXES) {
    const live = liveByCollection.get(spec.collection) || [];
    const match = live.find((l) => l.name === spec.options.name);
    if (!match) {
      missingFromLive.push(spec);
      continue;
    }
    if (!keysEqual(spec.key, match.key) || !optionsEqual(spec.options, match)) {
      mismatched.push({
        collection: spec.collection,
        name: spec.options.name,
        reason: 'same name, different key/options — manifest and live have diverged',
      });
    }
  }

  // Live -> manifest: any live index not in the manifest is informational only.
  // Collections outside the manifest entirely aren't scanned here (this is a
  // drift check against KNOWN collections, not a full-database crawl).
  for (const [collection, live] of liveByCollection) {
    const manifestNames = new Set(
      INDEXES.filter((i) => i.collection === collection).map((i) => i.options.name),
    );
    for (const idx of live) {
      if (idx.name === '_id_') continue;
      if (!manifestNames.has(idx.name)) {
        unknownLive.push({ collection, name: idx.name, key: idx.key });
      }
    }
  }

  return { missingFromLive, unknownLive, mismatched };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const collectionFilter = args.find((a) => a.startsWith('--collection='))?.split('=')[1];

  console.log(`ensure-indexes: ${apply ? 'APPLY mode — will call createIndex()' : 'DRY RUN (pass --apply to create)'}`);
  if (collectionFilter) console.log(`  filtering to collection: ${collectionFilter}`);
  console.log(`  ${INDEXES.length} indexes in manifest across ${new Set(INDEXES.map((i) => i.collection)).size} collections`);
  const unknownCount = INDEXES.filter((i) => i.why.startsWith('UNKNOWN')).length;
  if (unknownCount > 0) {
    console.log(`  ${unknownCount} entries have UNKNOWN rationale (found live, not yet traced to a creator — see #2978)`);
  }
  console.log('');

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 1_200_000, // large-collection index builds can take a while
  });
  await client.connect();
  const db = client.db('bookstore');

  const toProcess = collectionFilter ? INDEXES.filter((i) => i.collection === collectionFilter) : INDEXES;

  let created = 0;
  let exists = 0;
  let errors = 0;

  for (const spec of toProcess) {
    const label = `${spec.collection}.${spec.options.name}`;
    if (!apply) {
      console.log(`  [dry-run] would ensure: ${label} = ${JSON.stringify(spec.key)}`);
      continue;
    }
    try {
      await db.collection(spec.collection).createIndex(spec.key, spec.options);
      console.log(`  OK: ${label}`);
      created++;
    } catch (e) {
      const err = /** @type {Error & {code?: number}} */ (e);
      if (err.message?.includes('already exists') || err.code === 85 || err.code === 86) {
        console.log(`  EXISTS: ${label}`);
        exists++;
      } else {
        console.error(`  ERROR: ${label} — ${err.message}`);
        errors++;
      }
    }
  }

  if (!apply) {
    console.log(`\nDry run complete — ${toProcess.length} indexes checked, nothing written. Re-run with --apply to create.`);
  } else {
    console.log(`\nDone. ${created} created, ${exists} already existed, ${errors} errors.`);
  }

  await client.close();
  if (errors > 0) process.exitCode = 1;
}

// Only run main() when invoked directly (`node ensure-indexes.mjs`), not when
// imported for INDEXES/computeIndexDrift (e.g. by pipeline-health-alert.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
