'use client';

import { useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// --- Node data types ---
interface ServiceInfo extends Record<string, unknown> {
  label: string;
  subtitle?: string;
  color: string;
  icon: string;
  url?: string;
  summary: string;
  details: string[];
  gotchas?: string[];
  files?: string[];
  collections?: string[];
}

// --- Popup ---
function InfoPopup({ data, onClose }: { data: ServiceInfo; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
          padding: 24, maxWidth: 640, width: '92%', maxHeight: '85vh', overflowY: 'auto',
          color: '#c9d1d9',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 28 }}>{data.icon}</span>
            <div>
              <h2 style={{ fontSize: 20, color: '#f0f6fc', margin: 0 }}>{data.label}</h2>
              {data.subtitle && <p style={{ fontSize: 13, color: '#8b949e', margin: 0 }}>{data.subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#8b949e', fontSize: 24,
              cursor: 'pointer', padding: '4px 8px',
            }}
          >
            &times;
          </button>
        </div>

        {/* Summary */}
        <p style={{
          fontSize: 14, lineHeight: 1.7, color: '#e6edf3', margin: '0 0 16px',
          padding: '12px 16px', background: '#0d1117', borderRadius: 8, borderLeft: `3px solid ${data.color}`,
        }}>
          {data.summary}
        </p>

        {/* Details */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>How it works</p>
          {data.details.map((d, i) => (
            <p key={i} style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 6, color: '#c9d1d9' }}>{d}</p>
          ))}
        </div>

        {/* Gotchas */}
        {data.gotchas && data.gotchas.length > 0 && (
          <div style={{
            marginBottom: 16, padding: '12px 16px', background: '#2d1b1b',
            border: '1px solid #6e3630', borderRadius: 8,
          }}>
            <p style={{ fontSize: 12, color: '#f85149', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gotchas & Warnings</p>
            {data.gotchas.map((g, i) => (
              <p key={i} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 4, color: '#ffa198' }}>{g}</p>
            ))}
          </div>
        )}

        {/* Files */}
        {data.files && data.files.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Key Files</p>
            {data.files.map((f, i) => (
              <code key={i} style={{ display: 'block', fontSize: 12, color: '#7ee787', marginBottom: 4, wordBreak: 'break-all' }}>{f}</code>
            ))}
          </div>
        )}

        {/* Collections */}
        {data.collections && data.collections.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>MongoDB Collections</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {data.collections.map((c, i) => (
                <span key={i} style={{
                  fontSize: 11, background: '#21262d', padding: '3px 8px',
                  borderRadius: 4, color: '#c9d1d9', fontFamily: 'monospace',
                }}>{c}</span>
              ))}
            </div>
          </div>
        )}

        {/* Dashboard link */}
        {data.url && (
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block', marginTop: 4, padding: '8px 16px',
              background: data.color, color: '#fff', borderRadius: 6,
              textDecoration: 'none', fontSize: 13, fontWeight: 600,
            }}
          >
            Open Dashboard &rarr;
          </a>
        )}
      </div>
    </div>
  );
}

// --- Custom Node ---
function ServiceNode({ data }: { data: ServiceInfo }) {
  return (
    <div
      style={{
        background: '#161b22', border: `2px solid ${data.color}`,
        borderRadius: 10, padding: '10px 16px', minWidth: 140,
        textAlign: 'center', cursor: 'pointer',
        transition: 'box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 16px ${data.color}60`;
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: data.color, border: 'none' }} />
      <div style={{ fontSize: 18, marginBottom: 2 }}>{data.icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f6fc' }}>{data.label}</div>
      {data.subtitle && <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{data.subtitle}</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: data.color, border: 'none' }} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  service: ServiceNode,
};

// --- Node definitions ---
const serviceData: Record<string, ServiceInfo> = {
  frontend: {
    label: 'Frontend Pages', subtitle: '~160 pages', color: '#58a6ff', icon: '🌐',
    url: 'https://sourcelibrary.org',
    summary: 'The public-facing Next.js app at sourcelibrary.org. Serves readers, researchers, the Ficino Society community, and admins. About 160 pages total, ranging from the book reader and search to admin dashboards and a blog.',
    details: [
      'Core reader experience: /book/[id] renders a dual-pane reader with original scans on the left and OCR/translation on the right. Supports page-by-page navigation, zoom, and AI-powered Q&A per page.',
      'Search: /search uses a unified endpoint that queries across book metadata, full-text OCR content, image descriptions, and gallery metadata. Supports faceted filtering by tradition, language, era, and form.',
      'Collections: /collections/[id] groups books by tradition (Alchemy, Hermetica, Kabbalah, etc.). Sub-collections exist for finer granularity. Collection assignment is AI-assisted via Gemini.',
      'Gallery: /gallery extracts illustrations from historical books with AI-generated metadata (subjects, symbols, technique, art period). Supports similarity search via vector embeddings.',
      'Encyclopedia: /encyclopedia/[name] has auto-generated entity pages for people, places, and concepts mentioned across the corpus.',
      'Blog: 29 posts at /blog/*, all hardcoded as JSX components (no CMS or MDX). Topics range from origin story to OCR methodology to progress updates.',
      'Press: 6 themed press releases at /press/* — alchemy, hermetic tradition, kabbalah, origins of science, world sacred texts, BPH partnership.',
      'Ficino Society: /ficino-society has membership landing, discussion forum, and member directory. Gated by Stripe subscription ($100/year).',
      'Admin: /admin/* has ~15 dashboard pages for pipeline control, collection management, email campaigns, social media, KDP publishing, and duplicate detection.',
    ],
    gotchas: [
      '35 of 148 components are unused dead code (24%). Tracked in GitHub issue #258.',
      '/testloader is a debug page that should not be publicly accessible.',
      '/fulldata exposes bulk data export — should be admin-gated.',
      'Blog content is entirely in git as JSX. No way to edit without deploying code.',
    ],
    files: [
      'src/app/ — all pages',
      'src/components/ — 148 React components (113 active, 35 dead)',
      'src/hooks/ — 9 hooks (1 unused: useBetaGate)',
    ],
  },
  api: {
    label: 'API Layer', subtitle: '316 routes · no ORM', color: '#f0f6fc', icon: '▲',
    url: 'https://sourcelibrary.org/admin/pipeline',
    summary: 'All backend logic lives in Next.js API routes. There is no repository pattern, no service layer, and no ORM — every route queries MongoDB directly via getDb().collection(). This keeps things simple but means business logic is scattered across 316 route files.',
    details: [
      'Books API (50+ routes): CRUD, processing triggers, OCR/translation management, indexing, quality scoring, pipeline enrollment, edition management, DOI minting. The /api/books/[id] route is the workhorse — handles GET for detail and PATCH for updates.',
      'Pages API (20+ routes): Individual page operations — OCR, translation, splitting, transliteration, modernization, revisions. Every write to ocr.data or translation.data must go through createRevision() first.',
      'Import API (13 routes): One importer per IIIF source — Internet Archive, Gallica, Bodleian, Cambridge, LOC, Vatican, Wellcome, HAB, e-Rara, MDZ, Europeana, Google Books, plus a generic IIIF handler. Each fetches a manifest, creates book + page documents, and optionally queues OCR.',
      'Search API (6 routes): Unified search, suggestions/autocomplete, vocabulary, AI query expansion. Full-text search uses MongoDB text indexes, not a dedicated search engine.',
      'Admin API (30+ routes): Emergency stop, adaptive backpressure limits, bulk OCR/re-OCR, data backfills, sync operations, collection management, email campaigns, KDP publishing.',
      'Gallery API (9 routes): Browse, collection management, image detail, high-res access, similarity search, curation tools.',
      'Social API (11 routes): Post management, scheduling, auto-generation, metrics refresh, Twitter integration.',
      'Cron endpoints (11 routes): 4 active on Vercel (social, health, reporting), 7 disabled (moved to Hetzner). Code still exists for all 11.',
      'Auth: NextAuth with Google OAuth + Email (Nodemailer/Resend). Admin check via admin_users collection whitelist. No RBAC — you\'re either admin or not.',
      'Frontend API client: src/lib/api-client/ has 31 typed wrapper files that the React frontend uses to call these routes. Centralized axios instance with auth interceptors.',
    ],
    gotchas: [
      'No repository layer means refactoring a collection schema requires touching every route that queries it.',
      'withAdminAuth() is the only protection on admin routes — no middleware.ts exists.',
      'Dataset API (/api/dataset/v1/*) has its own API key system with per-key rate limits, separate from admin auth.',
      '2 duplicate functions: withTimeout() and sortCollections() exist in both lib/collections-utils.ts and app/page.tsx.',
    ],
    files: [
      'src/app/api/ — 316 route handlers',
      'src/lib/api-client/ — 31 frontend API wrappers',
      'src/lib/auth.ts — NextAuth configuration',
      'src/lib/auth-helpers.ts — withAuth(), withAdminAuth()',
      'src/lib/types/ — 17 TypeScript type definition files',
    ],
  },
  mongodb_core: {
    label: 'Core Data', subtitle: 'books · pages · collections', color: '#4db33d', icon: '📚',
    url: 'https://cloud.mongodb.com',
    summary: 'The heart of the database. The books collection stores metadata for ~5,355 books. The pages collection stores individual page content including OCR text and translations. These two collections are where most reads and writes happen.',
    details: [
      'books: Each document has an id field (string, NOT ObjectId) that is the primary lookup key. ~1,186 legacy books have id !== _id — always use book.id, never _id. Key fields: title, author, slug, language, published, pages_count, pages_ocr, pages_translated, thumbnail, hidden, collections, dublin_core.',
      'pages: Linked to books via book_id (matches book.id). OCR text at ocr.data (string), translation at translation.data (string). Also stores detected_images array, page_type, page_number. This is the highest-volume collection.',
      'pages_count, pages_ocr, pages_translated on books are performance caches, refreshed by sync-page-counts cron every 6h. Source of truth is always the pages collection. translation_percent is never stored — computed at read time.',
      'collections: Book groupings by tradition (alchemy, hermetica, kabbalah, etc.) with slug-based lookup. Sub-collections supported. Some collections are hidden (thin content).',
      'entities: Auto-generated encyclopedia entries — people, places, concepts extracted from the corpus. entity_aliases stores alternate names.',
      'deleted_books: Soft-delete destination. Recoverable via POST /api/books/restore/[id]. Always check here before assuming a book is gone.',
    ],
    gotchas: [
      'CRITICAL: id vs _id distinction. ~1,186 old books have id !== _id. Pages use book_id matching book.id. Issues #215, #218.',
      'NEVER delete books without explicit confirmation. NEVER batch delete — list first, wait for approval.',
      'pages_count caches can be stale (up to 6h). Use the pages collection for accurate counts.',
    ],
    files: [
      'src/lib/mongodb.ts — connection singleton, pool management',
      'src/lib/mongodb-client.ts — NextAuth adapter connection',
      'src/lib/book-lookup.ts — findBookBySlug(), findBookById()',
      'src/lib/slugify.ts — bookUrl(), generateBookSlug()',
    ],
    collections: ['books', 'pages', 'deleted_books', 'collections', 'entities', 'entity_aliases'],
  },
  mongodb_processing: {
    label: 'Processing Data', subtitle: 'jobs · revisions · usage', color: '#4db33d', icon: '⚙️',
    url: 'https://cloud.mongodb.com',
    summary: 'Pipeline state tracking. The jobs collection is the master registry for all processing work (OCR, translation, image extraction). Page revisions provide an audit trail before any OCR or translation data is overwritten. Gemini usage tracks AI costs.',
    details: [
      'jobs: Single collection for all pipeline work. Discriminated by type field: "ocr", "translation", "image_extraction", "summary". Status lifecycle: pending → processing → completed/failed. Links to books via bookId and pages via config.page_ids.',
      'batch_jobs: Tracks Gemini Batch API jobs specifically. Supports parent/child hierarchy — a parent job orchestrates multiple child jobs (each handling 100-500 pages). Also supports single batch jobs for backward compatibility.',
      'page_revisions: Audit trail created by createRevision(pageId, field, jobId?) before any write to ocr.data or translation.data. This is a hard safety rule — any script or worker that modifies page content MUST create a revision first.',
      'gemini_usage: Logs every Gemini API call with model, tokens, cost, latency. This is the single source of truth for AI cost tracking. The deprecated cost_tracking collection should not be used.',
      'gemini_usage_daily: Aggregated daily rollups for the analytics dashboard. Generated by a daily pipeline report cron.',
      'system_config: Global settings document. Key document: _id "processing_control" with paused (boolean), paused_phases (array of "ocr"/"translation"/"images"), and adaptive limit settings.',
    ],
    gotchas: [
      'paused: true on system_config only stops NEW job queueing. It does NOT stop in-flight Lambda workers. You must CANCEL jobs in the jobs collection for actual load reduction.',
      'Page revisions are mandatory. Any code path that skips createRevision() is a bug.',
      'cost_tracking collection is deprecated. Only use gemini_usage.',
    ],
    files: [
      'src/lib/page-revisions.ts — createRevision()',
      'src/lib/processing-priority.ts — job prioritization scoring',
      'src/lib/adaptive-limits.ts — backpressure control',
      'src/lib/queue-utils.ts — job queue helpers',
    ],
    collections: ['jobs', 'batch_jobs', 'page_revisions', 'gemini_usage', 'gemini_usage_daily', 'system_config'],
  },
  mongodb_user: {
    label: 'User & Social', subtitle: 'users · posts · discussions', color: '#4db33d', icon: '👥',
    url: 'https://cloud.mongodb.com',
    summary: 'User accounts, engagement data, social media automation, and the Ficino Society community forum. Auth is NextAuth with Google OAuth + Email. Admin access is whitelist-based, not role-based.',
    details: [
      'users: NextAuth user accounts (Google OAuth or email). Standard NextAuth schema with id, name, email, image.',
      'admin_users: Simple whitelist — documents with email and active fields. isAdminUser() checks this collection. No roles, no permissions granularity.',
      'reading_history: Tracks which pages a user has viewed. Used for the /reading-history page and potentially for recommendation.',
      'likes: User favorites on books, pages, or gallery images. Powers the /favorites page.',
      'highlights: User text annotations/highlights on specific page content.',
      'social_posts: Queued and published tweets. The social-post cron (every 3h) picks the next unpublished post and sends it via Twitter API v2. Generated by tweet-generator.ts.',
      'social_config: Social media settings — daily post limit, last post time, monthly reset state.',
      'social_tags: Hashtag tracking and performance metrics.',
      'discussions: Ficino Society forum threads. Each thread has a title, body, author, and collection of replies.',
      'discussion_replies: Individual replies to discussion threads.',
      'purchases: Stripe payment records for Ficino Society memberships ($100/year).',
    ],
    files: [
      'src/lib/auth.ts — NextAuth config (Google + Email providers)',
      'src/lib/twitter.ts — Twitter API v2 client',
      'src/lib/tweet-generator.ts — AI-powered tweet generation (616 lines)',
      'src/lib/stripe.ts — Stripe client',
    ],
    collections: [
      'users', 'admin_users', 'sessions', 'reading_history', 'likes', 'highlights',
      'social_posts', 'social_config', 'social_tags',
      'discussions', 'discussion_replies', 'purchases',
    ],
  },
  mongodb_gallery: {
    label: 'Gallery & Media', subtitle: 'images · embeddings', color: '#4db33d', icon: '🖼️',
    url: 'https://sourcelibrary.org/gallery',
    summary: 'The image gallery system. During pipeline Phase 3 (image extraction), Gemini Vision analyzes each page and extracts illustrations, diagrams, and decorative elements. These are stored with rich metadata and vector embeddings for similarity search.',
    details: [
      'gallery_images: Each document represents one extracted image from a page. Contains page_id (link back to source), bounding box coordinates, and rich AI-generated metadata: subjects, figures, symbols, art style, technique, time period, and a museum-style description.',
      'gallery_collections: Curated sets of gallery images, organized by theme (e.g., "Alchemical Diagrams", "Kabbalistic Trees"). Each has a slug, name, description, and cover image.',
      'gallery_embeddings: Vector embeddings for each gallery image, enabling similarity search. When a user clicks "find similar" on an image, the system queries nearest neighbors in embedding space.',
      'detected_images: Raw detection results from Gemini Vision before they\'re promoted to gallery_images. Includes gallery_quality score used for cover selection. The sync-gallery-images cron reconciles these two collections.',
    ],
    gotchas: [
      'Cover selection uses detected_images.gallery_quality score, not just page_type. 810 books were backfilled 2026-03-19.',
      'Never store /api/image?url= as book.thumbnail — it crashes SSR. Store direct http(s) URLs only.',
    ],
    files: [
      'src/lib/image-extraction.ts — Gemini Vision extraction logic (437 lines)',
      'src/app/api/gallery/ — 9 gallery endpoints',
      'src/components/gallery/ — gallery UI components',
    ],
    collections: ['gallery_images', 'gallery_collections', 'gallery_embeddings', 'detected_images'],
  },
  mongodb_analytics: {
    label: 'Analytics & Monitoring', subtitle: 'events · health · errors', color: '#4db33d', icon: '📊',
    url: 'https://sourcelibrary.org/analytics',
    summary: 'Observability layer. Tracks user behavior (pageviews, search queries, engagement), pipeline health (daily snapshots, cron execution logs), admin actions (audit trail), and application errors.',
    details: [
      'analytics_events: Custom event tracking — search queries, book opens, gallery views, feature usage. Written by client-side tracking and server-side API calls.',
      'analytics_pageviews: Page view metrics with path, referrer, user agent. Used for the analytics dashboard.',
      'pipeline_snapshots: Point-in-time captures of pipeline state — how many jobs pending, processing, completed. Used for trend charts.',
      'pipeline_health_daily: Daily health report written by the 6 AM UTC cron. Includes DB latency, job throughput, error rates, queue depths.',
      'cron_runs: Execution log for every cron invocation — start time, duration, success/failure, items processed. Useful for debugging why a cron didn\'t fire.',
      'audit_log: Admin action trail — who did what, when. Covers sensitive operations like book deletion, emergency stops, bulk re-processing.',
      'application_errors: Server-side error logging. Structured error documents with stack traces, request context, and error categorization.',
    ],
    files: [
      'src/lib/analytics.ts — event tracking helpers',
      'src/app/api/analytics/ — 9 analytics endpoints',
      'src/app/api/cron/health-check/ — hourly health monitoring',
      'src/app/api/cron/daily-pipeline-report/ — daily snapshot',
    ],
    collections: [
      'analytics_events', 'analytics_pageviews', 'loading_metrics',
      'pipeline_snapshots', 'pipeline_health_daily',
      'cron_runs', 'audit_log', 'application_errors',
    ],
  },
  r2: {
    label: 'Cloudflare R2', subtitle: 'images.sourcelibrary.org', color: '#f38020', icon: '📦',
    url: 'https://images.sourcelibrary.org',
    summary: 'Object storage for all page images, thumbnails, gallery exports, and archived high-res scans. Migrated from Vercel Blob in March 2026, saving ~$655/month. Accessed via the S3-compatible API with a public CDN at images.sourcelibrary.org.',
    details: [
      'Stores the actual page scan images (JPEG/PNG) that users see in the reader. Each page has an image URL pointing to R2.',
      'Thumbnails: Generated at multiple sizes for book covers, search results, and gallery grids.',
      'Gallery PDFs: Downloadable high-res PDFs generated on demand for Ficino Society members.',
      'The storage.ts abstraction supports both R2 and Vercel Blob. R2 is primary; Blob is a fallback for any objects not yet migrated.',
      'Public URL pattern: https://images.sourcelibrary.org/{bucket-path}',
      'Environment: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL.',
    ],
    gotchas: [
      'Some older books may still have Vercel Blob URLs. The storage abstraction handles transparent fallback.',
      'R2 has no built-in image resizing — thumbnails must be pre-generated.',
    ],
    files: [
      'src/lib/storage.ts — R2 + Vercel Blob abstraction',
    ],
  },
  pipeline: {
    label: 'Pipeline Orchestrator', subtitle: 'Hetzner · every 2min', color: '#d63031', icon: '🔄',
    url: 'https://sourcelibrary.org/admin/pipeline',
    summary: 'The central pipeline that moves books from raw imports through OCR, translation, enrichment, and image extraction. Runs on a Hetzner cax31 ARM server (pipeline-orchestrator.mjs, ~2,900 lines). 21 cron entries handle different phases independently.',
    details: [
      'The orchestrator runs every 2 minutes on Hetzner (46.224.122.120). Individual phases also run as separate cron entries so a slow phase doesn\'t block others. Crontab is versioned at scripts/workers/crontab.production.',
      'OCR: Submitted directly to Gemini Batch API from Hetzner (50% cost discount). Results collected by batch-collector.mjs every 10 min. Lambda is only used for preview OCR (first 25 pages).',
      'Translation: Hetzner translate-worker.mjs calls Gemini API directly (no SQS, no Lambda). 15 concurrent books, self-dispatches from metadata_enriched (no Phase 4 wait). Each book gets 200 pages then is parked as translate_partial — fresh books always prioritized. ~14K pages/hr peak, ~7K sustained. Model routing: gemini-3-flash-preview for BPH, gemini-3.1-flash-lite-preview for others.',
      'Enrichment: Summary, index, chapters, transliteration — all orchestrated from Hetzner, calling Vercel API routes for summary/index/chapters and running transliteration inline.',
      'Image Extraction: Still uses Lambda workers via SQS (Phase 8). Results written via write-processor Lambda.',
      'Backpressure: MongoDB Atlas saturates at ~40 concurrent connections. Adaptive limits auto-adjust based on DB latency (healthy → ramp up 20%, degraded → reduce 50%, critical → slam to minimums).',
    ],
    gotchas: [
      'paused: true stops new job queueing but does NOT stop in-flight Lambda workers or translate-worker. Must CANCEL jobs in MongoDB.',
      'Hetzner workers that write to pages must also update book-level counters (pages_ocr, pages_translated, pages_archived). sync-worker reconciles every 2h as safety net.',
      'Stale Vercel connection pools after DB recovery — must redeploy Vercel to reset.',
      'Legacy Vercel cron code exists in src/app/api/cron/_archived/ and can be re-enabled. See pipeline-architecture.md.',
    ],
    files: [
      'scripts/workers/pipeline-orchestrator.mjs — main orchestrator (~2,900 lines)',
      'scripts/workers/translate-worker.mjs — inline translation worker',
      'scripts/workers/batch-collector.mjs — Gemini Batch API result collector',
      'scripts/workers/crontab.production — Hetzner crontab (versioned)',
      'src/lib/adaptive-limits.ts — dynamic backpressure',
    ],
    collections: ['jobs', 'batch_jobs', 'system_config', 'gemini_usage'],
  },
  enrich: {
    label: 'Enrichment', subtitle: 'Hetzner · consolidated', color: '#d63031', icon: '✨',
    url: 'https://sourcelibrary.org/admin/pipeline',
    summary: 'Enriches books with AI-generated metadata: summaries, chapter extraction, searchable indexes, and transliteration of non-Latin scripts. Now consolidated into the Hetzner orchestrator (Phases 3.5, 6, 7, 3.7).',
    details: [
      'Summary + Index (Phase 6): Calls Vercel API /api/books/[id]/index from Hetzner. enrich-worker uses gemini-3.1-flash-lite-preview for summary/index.',
      'Chapter extraction (Phase 7): Calls Vercel API /api/books/[id]/extract-chapters from Hetzner. Skips books with <10 pages.',
      'Transliteration (Phase 3.7): Runs inline on Hetzner via Gemini. For non-Latin scripts (Greek, Hebrew, Arabic, Chinese, etc.). Uses gemini-3.1-flash-lite-preview (text-only, cheap).',
      'Metadata enrichment (Phase 3.5): Calls Vercel API /api/books/[id]/verify-metadata. Detects language, categories, description, source_work_dates.',
      'All enrichment phases are non-critical — failures skip ahead rather than blocking the pipeline.',
      'Legacy: The enrich-books Vercel cron exists in _archived/ but is not active. All enrichment runs from the Hetzner orchestrator now.',
    ],
    gotchas: [
      'enrich-worker uses gemini-3.1-flash-lite-preview for summary/index.',
      'Enrichment only runs on books that have completed translation (translate_complete status).',
    ],
    files: [
      'scripts/workers/pipeline-orchestrator.mjs — enrichment phases',
      'src/lib/metadata-enrichment.ts — AI enrichment',
      'src/lib/ai.ts — core Gemini operations',
      'src/app/api/cron/_archived/enrich-books/ — legacy Vercel cron (not active)',
    ],
  },
  sync: {
    label: 'Sync Worker', subtitle: 'Hetzner · every 2h', color: '#d63031', icon: '🔃',
    summary: 'Cache refresh worker. Book-level fields like pages_count, pages_ocr, and pages_translated are performance caches — the source of truth is the pages collection. This worker reconciles them every 2 hours.',
    details: [
      'Replaces two former Vercel crons: sync-page-counts and sync-gallery-images.',
      'Page count sync: For each book, counts actual pages in the pages collection with OCR and translation data, then updates the book document. Also recalculates quality scores.',
      'Gallery sync: Reconciles the gallery_images collection with detected_images from page processing. Promotes new detections, removes stale entries, updates gallery collection memberships.',
      'Runs as a standalone Node.js script on Hetzner (scripts/workers/sync-worker.mjs), not as a Vercel API route.',
    ],
    gotchas: [
      'Page count caches can be up to 2h stale. For accurate counts, query the pages collection directly.',
      'translation_percent is never stored on book documents — always computed at read time from pages_translated / pages_count.',
    ],
    files: [
      'scripts/workers/sync-worker.mjs — standalone worker',
    ],
    collections: ['books', 'gallery_images', 'detected_images'],
  },
  sqs_ocr: {
    label: 'pageOcr Queue', subtitle: 'standard · preview only', color: '#ff9f43', icon: '📬',
    url: 'https://eu-central-1.console.aws.amazon.com/sqs/v3/home?region=eu-central-1',
    summary: 'SQS queue for OCR jobs — PREVIEW PATH ONLY. Full-book OCR uses Gemini Batch API on Hetzner (no SQS). This queue handles preview OCR (first 25 pages) and manual submissions.',
    details: [
      'Production OCR bypasses this queue entirely — Hetzner submits directly to Gemini Batch API.',
      'Preview OCR (Phase 1.5): First 25 pages sent here for fast results while batch API processes the full book.',
      'Message format: PageProcessingMessage with pageId, bookId, jobId.',
      'Consumer: sourcelibrary-ocr-processor Lambda (reserved concurrency: 10).',
    ],
    files: ['src/lib/sqs-client.ts'],
  },
  sqs_trans: {
    label: 'pageTranslation Queue', subtitle: 'FIFO · fallback only', color: '#ff9f43', icon: '📬',
    url: 'https://eu-central-1.console.aws.amazon.com/sqs/v3/home?region=eu-central-1',
    summary: 'SQS FIFO queue for translation jobs. FALLBACK PATH ONLY — production translation uses Hetzner translate-worker.mjs (direct Gemini calls, no SQS). This queue is still used for preview translation and manual job submissions.',
    details: [
      'Production path: Hetzner translate-worker.mjs picks up translate_submitted books and calls Gemini directly. No SQS involved.',
      'Fallback: This queue is used for preview translation (first 25 pages) and manual job submission via /api/jobs/queue-books.',
      'Message group ID is the jobId (not bookId), ensuring all pages of a job are processed in order.',
      'FIFO ordering guarantees sequential processing — required for cross-page context continuity.',
      'Consumer: sourcelibrary-translation-processor Lambda (reserved concurrency: 15).',
    ],
    gotchas: [
      'CRITICAL: NEVER use Gemini Batch API for translation. It lacks cross-page context continuity.',
      'Production translation is NOT on this queue — it runs on Hetzner via translate-worker.mjs.',
    ],
    files: ['src/lib/sqs-client.ts'],
  },
  sqs_img: {
    label: 'pageImageExtraction Queue', subtitle: 'standard · parallel', color: '#ff9f43', icon: '📬',
    url: 'https://eu-central-1.console.aws.amazon.com/sqs/v3/home?region=eu-central-1',
    summary: 'SQS queue for image extraction jobs. Pages can be processed in any order since each page\'s images are independently detected and described.',
    details: [
      'Standard (not FIFO) queue — order doesn\'t matter for image detection.',
      'Consumer: sourcelibrary-image-extraction-processor Lambda (reserved concurrency: 10).',
      'Results go to gallery_images and detected_images collections via the write-results queue.',
    ],
    files: ['src/lib/sqs-client.ts'],
  },
  sqs_write: {
    label: 'writeResults Queue', subtitle: 'batched DB writes', color: '#ff9f43', icon: '📬',
    url: 'https://eu-central-1.console.aws.amazon.com/sqs/v3/home?region=eu-central-1',
    summary: 'Collects results from all three processing phases and batches MongoDB writes. This exists because direct writes from each Lambda would overwhelm the Atlas connection pool.',
    details: [
      'All three worker Lambdas (OCR, translation, image extraction) send their results here instead of writing directly to MongoDB.',
      'The write-processor Lambda consumes from this queue with high concurrency (50) to keep up with all three phases.',
      'Before writing, the write-processor creates a page revision via createRevision() — this is a hard safety rule.',
      'Batching reduces Atlas connection pressure from potentially 85 concurrent writers to a controlled 50.',
    ],
    files: ['src/workers/write-processor.ts', 'src/workers/write-processor-logic.ts'],
  },
  lambda_ocr: {
    label: 'OCR Processor', subtitle: 'Lambda · preview only', color: '#6c5ce7', icon: '👁️',
    url: 'https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions/sourcelibrary-ocr-processor',
    summary: 'Lambda worker for OCR — PREVIEW PATH ONLY. Full-book OCR uses Gemini Batch API on Hetzner (50% cost discount). This Lambda handles preview OCR (first 25 pages for fast results) and manual job submissions.',
    details: [
      'Production OCR: Hetzner pipeline-orchestrator.mjs Phase 2 submits directly to Gemini Batch API. Results collected by batch-collector.mjs.',
      'This Lambda handles PREVIEW OCR (Phase 1.5): first 25 pages sent to SQS for fast results (minutes vs hours for batch).',
      'Input: SQS message with pageId and imageUrl. Downloads the page image from R2/archive source.',
      'Processing: Sends image to Gemini with Standard OCR prompt v6. All languages, no language-specific prompts.',
      'Output: WriteResultMessage to writeResults SQS queue with OCR text, content hash, detected_images.',
      'Error handling: RECITATION fallback chain: gemini-3-flash-preview, gemini-3.1-flash-lite-preview.',
      'Reserved concurrency: 10 Lambda instances.',
    ],
    gotchas: [
      'NEVER use language-specific OCR prompts. Standard OCR v6 handles all languages.',
      'Lambda cold starts can take 2-3s. Keep the package small (no unnecessary dependencies).',
    ],
    files: [
      'src/workers/ocr-processor.ts — Lambda entry point (SQS handler)',
      'src/workers/ocr-processor-logic.ts — core OCR logic',
      'scripts/aws-lambda/build-lambda.sh — esbuild compilation',
      'scripts/aws-lambda/package-lambda.sh — zip packaging',
    ],
    collections: ['pages (ocr.data)', 'page_revisions', 'gemini_usage'],
  },
  lambda_trans: {
    label: 'Translation Processor', subtitle: 'Lambda · fallback only', color: '#6c5ce7', icon: '🌍',
    url: 'https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions/sourcelibrary-translation-processor',
    summary: 'Lambda worker for translation — FALLBACK PATH. Production translation uses Hetzner translate-worker.mjs (direct Gemini calls, 40 concurrent books, self-dispatching). This Lambda only handles preview translation and manual job submissions.',
    details: [
      'Production path: Hetzner translate-worker.mjs runs every 2 min, self-dispatches from metadata_enriched, translates 200 pages per book then parks as translate_partial. Model routing: flash for BPH, lite for others.',
      'This Lambda is the FALLBACK — triggered by preview translation (first 25 pages) and manual /api/jobs/queue-books submissions.',
      'Input: SQS FIFO message with pageId, bookId, OCR text.',
      'Processing: Fetches previous page translation from MongoDB for context, calls Gemini realtime.',
      'Output: Writes translation.data directly to MongoDB (hybrid pattern for FIFO context chain). Sends logging to writeResults queue.',
      'Reserved concurrency: 15 Lambda instances.',
    ],
    gotchas: [
      'CRITICAL: NEVER use Gemini Batch API for translation. It processes pages out of order, breaking context continuity.',
      'Production translation runs on Hetzner, not here. Check translate-worker.mjs for issues.',
    ],
    files: [
      'src/workers/translation-processor.ts — Lambda entry point',
      'src/workers/translation-processor-logic.ts — translation logic with context chain',
    ],
    collections: ['pages (translation.data)', 'page_revisions', 'gemini_usage'],
  },
  lambda_img: {
    label: 'Image Extraction', subtitle: '10 concurrent', color: '#6c5ce7', icon: '🎨',
    url: 'https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions/sourcelibrary-image-extraction-processor',
    summary: 'Lambda worker that analyzes page scans with Gemini Vision to find and catalog illustrations, diagrams, symbols, and decorative elements. Generates museum-quality metadata for each detected image.',
    details: [
      'Input: SQS message with pageId and imageUrl.',
      'Detection: Gemini Vision identifies distinct visual elements on the page — illustrations, woodcuts, diagrams, decorative borders, symbols, marginalia.',
      'Metadata generation: For each detected image, generates: subjects (what\'s depicted), figures (people/entities), symbols (alchemical, astrological, etc.), art style, technique (woodcut, engraving, etc.), time period estimate, and a museum-style prose description.',
      'Quality scoring: Each detection gets a gallery_quality score (0-1) used for cover image selection and gallery curation.',
      'Output: Writes to the writeResults queue. The write-processor creates gallery_images documents and updates the page\'s detected_images array.',
      'Reserved concurrency: 10 Lambda instances. Backpressure limit: 50 concurrent (higher than OCR/translation because image extraction is less DB-intensive).',
    ],
    files: [
      'src/workers/image-extraction-processor.ts — Lambda entry point',
      'src/workers/image-extraction-processor-logic.ts — detection logic',
      'src/lib/image-extraction.ts — shared extraction utilities (437 lines)',
    ],
    collections: ['gallery_images', 'gallery_embeddings', 'detected_images'],
  },
  lambda_write: {
    label: 'Write Processor', subtitle: '50 concurrent', color: '#6c5ce7', icon: '💾',
    summary: 'Lambda worker that batches MongoDB writes from all three processing phases. Exists to prevent connection pool exhaustion on Atlas — instead of 85 workers writing directly, writes are funneled through this single consumer.',
    details: [
      'Consumes WriteResultMessage from the writeResults SQS queue.',
      'Before writing: Creates a page revision via createRevision(pageId, field, jobId). This is mandatory and enforced.',
      'Writes: Updates pages.ocr.data, pages.translation.data, or pages.detected_images depending on the message type.',
      'High concurrency (50 reserved Lambda instances) to keep up with the combined output of all three processing phases.',
      'Also updates job status in the jobs collection and logs to gemini_usage.',
    ],
    gotchas: [
      'Page revisions are mandatory before every write. Code that skips this is a bug.',
      'Connection pool: Even at 50 concurrent, each Lambda uses 1 MongoDB connection. Combined with OCR/translation Lambdas that also connect (for reads), total can approach the ~40 connection saturation point.',
    ],
    files: [
      'src/workers/write-processor.ts — Lambda entry point',
      'src/workers/write-processor-logic.ts — write logic with revision creation',
    ],
    collections: ['pages', 'page_revisions', 'jobs', 'gemini_usage'],
  },
  gemini: {
    label: 'Gemini AI', subtitle: '11-key rotation', color: '#4285f4', icon: '🤖',
    url: 'https://ai.google.dev/gemini-api/docs/models',
    summary: 'Google\'s Gemini is the AI backbone for everything: OCR, translation, image extraction, enrichment, and classification. Model routing: gemini-3-flash-preview for BPH books, gemini-3.1-flash-lite-preview for everything else. 11 API keys with rotation.',
    details: [
      'Model routing: BPH books use gemini-3-flash-preview (higher quality). All other books use gemini-3.1-flash-lite-preview (50% cheaper). Summary/index generation uses lite. Transliteration always uses lite (text-only).',
      'Key rotation: 11 API keys (GEMINI_API_KEY, GEMINI_API_KEY_2 through _10, GEMINI_API_KEY_TIER3). On rate limit (429), rotate to next key. translate-worker.mjs and pipeline-orchestrator.mjs each manage their own rotation.',
      'Batch API: Used for OCR (50% cost discount, submitted from Hetzner). NEVER for translation (lacks cross-page context). Batch jobs are only visible to the creating API key.',
      'Cost tracking: Every API call logged to gemini_usage with model, tokens, cost, latency. ~$0.009/page full pipeline. Monthly run rate ~$3,700-$4,000.',
      'Prompt management: OCR uses Standard OCR v6. Translation prompt includes previous page context. Enrichment prompts in metadata-enrichment.ts. Prompts collection stores versioned copies for A/B testing.',
    ],
    gotchas: [
      'Summary/index generation uses gemini-3.1-flash-lite-preview (not flash).',
      'Batch API jobs are only visible to the creating API key. Lost visibility if you switch keys.',
      'NEVER use Batch API for translation.',
    ],
    files: [
      'src/lib/ai.ts — core AI operations (506 lines)',
      'src/lib/gemini-client.ts — key rotation + rate limit handling',
      'src/lib/gemini-batch.ts — Batch API orchestration (607 lines)',
    ],
    collections: ['gemini_usage', 'gemini_usage_daily', 'prompts'],
  },
  ia: {
    label: 'Internet Archive', subtitle: 'Primary import source', color: '#e17055', icon: '🏛️',
    url: 'https://archive.org',
    summary: 'The primary source for book imports. Most of the ~5,355 books in Source Library were imported from Internet Archive via their IIIF manifest API. IA provides both the metadata and high-resolution page scan images.',
    details: [
      'Import flow: POST /api/import/ia with an IA identifier (e.g., "liber-de-voluptate"). The importer fetches metadata from archive.org/metadata/{id} and the IIIF manifest from iiif.archive.org/iiif/{id}/manifest.json.',
      'Page images: Extracted from the IIIF manifest canvases. Default resolution: 50% of original (pct:50) to balance quality and storage. Full resolution available on demand.',
      'Duplicate detection: The importer checks if a book with the same IA identifier already exists before creating a new one.',
      'Batch import: _tmp-batch-import.mjs processes a list of IA identifiers sequentially with 2s delay between imports to avoid rate limiting.',
      'Fallback: If IA doesn\'t have a book (404 or 403), the fallback chain is: IA → Gallica → HathiTrust → Project Gutenberg.',
    ],
    gotchas: [
      'If IA returns 403, move on immediately. Don\'t retry — it usually means the item is restricted.',
      'IA IIIF manifests occasionally have missing canvases or incorrect page ordering. The importer handles most cases but some books need manual page reordering.',
    ],
    files: [
      'src/app/api/import/ia/ — IA-specific importer',
      'src/lib/import-utils.ts — IIIF manifest parsing (463 lines)',
    ],
  },
  other_archives: {
    label: 'Other IIIF Sources', subtitle: 'Gallica · Wellcome · LOC · 10 more', color: '#e17055', icon: '📜',
    url: 'https://sourcelibrary.org/libraries',
    summary: 'Source Library can import from 13 different IIIF-compliant digital libraries. Each has a dedicated importer that understands that library\'s specific manifest format and metadata schema.',
    details: [
      'Gallica (BnF): French National Library. High-quality scans of French manuscripts and early printed books. Ark-based identifiers.',
      'Bodleian Library (Oxford): Medieval and early modern manuscripts. IIIF v3 manifests.',
      'Cambridge University Library: Rare books and manuscripts collection.',
      'Library of Congress: American collections plus international acquisitions.',
      'Vatican Library: Manuscript digitization project. Some of the oldest texts in the collection.',
      'Wellcome Library: History of medicine and science collections.',
      'Herzog August Bibliothek (HAB): Major German library for early modern European scholarship.',
      'e-Rara: Swiss platform for digitized rare books.',
      'Bayerische Staatsbibliothek (MDZ): Bavarian State Library digitization.',
      'Europeana: Aggregator across European cultural institutions.',
      'Google Books: Limited IIIF support via proxy.',
      'Generic IIIF: Catches any IIIF v2/v3 manifest URL not covered by a specific importer.',
      'The external_catalog / import_candidates collection tracks what\'s available across all these sources — a kind of union catalog of digitized pre-modern texts (~740K estimated unique items).',
    ],
    files: [
      'src/app/api/import/ — 13 source-specific importers + generic',
      'src/lib/import-utils.ts — shared IIIF parsing',
    ],
    collections: ['external_catalog', 'import_candidates'],
  },
  stripe: {
    label: 'Stripe', subtitle: 'Ficino Society · $100/year', color: '#635bff', icon: '💳',
    url: 'https://dashboard.stripe.com',
    summary: 'Handles payments for the Ficino Society membership ($100/year). The monetization follows a "museum vibe" — prices are hidden until the user expresses download or premium feature intent. Feature-flagged via the presence of STRIPE_SECRET_KEY.',
    details: [
      'Checkout: /api/stripe/checkout creates a Stripe Checkout session for Ficino Society membership.',
      'Webhook: /api/stripe/webhook handles payment confirmations, subscription updates, and cancellations.',
      'Portal: /api/stripe/portal redirects to Stripe\'s customer portal for subscription management.',
      'Feature gating: If STRIPE_SECRET_KEY is not set, all monetization UI is hidden. This allows the site to run in "open" mode for development.',
      'Ficino Society benefits: Access to high-resolution downloads, discussion forum, member directory, DOI-published scholarly editions.',
    ],
    files: [
      'src/lib/stripe.ts — Stripe client initialization',
      'src/app/api/stripe/ — 4 payment endpoints',
      'src/app/ficino-society/ — membership pages',
    ],
    collections: ['purchases'],
  },
  twitter: {
    label: 'Twitter/X', subtitle: '@SourceLibrary_', color: '#1da1f2', icon: '🐦',
    url: 'https://x.com/SourceLibrary_',
    summary: 'Automated social media posting to @SourceLibrary_ (with underscore). A Vercel cron runs every 3 hours, picks the next queued post from social_posts, and publishes via the Twitter API v2.',
    details: [
      'Content generation: tweet-generator.ts (616 lines) uses Gemini to create engaging tweets about books, gallery images, and milestones. Generates multiple candidates and picks the best.',
      'Scheduling: Posts are queued in social_posts with a scheduled publish time. The social-post cron picks the next unpublished post whose time has passed.',
      'Rate limiting: Daily post limit stored in social_config. The social-reset cron resets the counter at midnight UTC. Monthly reset on the 1st.',
      'Metrics: social_tags tracks hashtag performance. /api/social/posts/refresh-metrics updates engagement data.',
      'Manual control: Admin can create, edit, and schedule posts via /admin/social. Also supports batch generation for content calendars.',
    ],
    files: [
      'src/lib/twitter.ts — Twitter API v2 client',
      'src/lib/tweet-generator.ts — AI tweet generation (616 lines)',
      'src/app/api/social/ — 11 social media endpoints',
      'src/app/api/cron/social-post/ — posting cron',
      'src/app/api/cron/social-reset/ — daily/monthly reset',
    ],
    collections: ['social_posts', 'social_config', 'social_tags'],
  },
  zenodo: {
    label: 'Zenodo', subtitle: 'DOI minting', color: '#2980b9', icon: '📄',
    url: 'https://zenodo.org',
    summary: 'Scholarly publishing via Zenodo\'s InvenioRDM REST API. When a translated book reaches publication quality, it can be minted with a DOI (Digital Object Identifier) that makes it citable in academic papers. First DOI minted: Robert Fludd, 2026-03-15.',
    details: [
      'Edition lifecycle: A book goes through draft → review → published. Each edition is a versioned snapshot with front matter, translator credits, and a permanent DOI.',
      'Front matter generation: /api/books/[id]/editions/front-matter uses Gemini to generate a scholarly introduction, translator\'s note, and colophon.',
      'DOI minting: /api/books/[id]/editions/mint-doi creates a Zenodo deposit, uploads the edition, and registers the DOI.',
      'EPUB generation: The kdp-epub.ts module (454 lines) creates EPUB files for both Zenodo deposits and Amazon KDP publishing.',
      'Zenodo API quirks: Rate limits are generous but the API occasionally returns 500s on large uploads. The integration has retry logic.',
    ],
    files: [
      'src/lib/zenodo.ts — Zenodo API integration (467 lines)',
      'src/lib/kdp-epub.ts — EPUB generation (454 lines)',
      'src/app/api/books/[id]/editions/ — edition management',
    ],
    collections: ['editions', 'kdp_publications'],
  },
  crons: {
    label: 'Vercel Crons', subtitle: '5 active · 7 archived', color: '#f0f6fc', icon: '⏰',
    summary: 'Vercel runs 5 lightweight crons only (social, health, reporting, warming). All pipeline processing runs on Hetzner (21 cron entries). Archived cron routes exist in _archived/ and can be re-enabled.',
    details: [
      'warm (every 5 min): Keeps serverless pools warm for fast API responses.',
      'social-post (every 3h): Posts to social media. Triggered from Hetzner via cron-caller.mjs.',
      'health-check (hourly): Monitors MongoDB latency, zombie jobs, email alerts.',
      'daily-pipeline-report (6 AM UTC): Daily snapshot — books, pages, costs. Writes to pipeline_health_daily.',
      'social-reset (daily midnight UTC): Resets daily post counter.',
      'Archived routes (in _archived/, NOT active): post-import-pipeline, enrich-books, process-batches, submit-batch-ocr, sync-page-counts, sync-gallery-images, archive-ocr. All replaced by Hetzner workers.',
    ],
    gotchas: [
      'social-post, social-reset, and daily-pipeline-report are also triggered from Hetzner via cron-caller.mjs as a redundancy measure.',
      'Vercel crons have 300s max timeout (Pro). Heavy processing moved to Hetzner for this reason.',
      'To re-enable Vercel pipeline crons: add routes back to vercel.json, disable Hetzner crons. See pipeline-architecture.md.',
    ],
    files: [
      'src/app/api/cron/ — 5 active + 7 archived route handlers',
      'vercel.json — cron schedule (5 active entries)',
      'scripts/workers/cron-caller.mjs — Hetzner → Vercel proxy',
    ],
    collections: ['cron_runs', 'pipeline_health_daily', 'social_posts'],
  },
  scripts: {
    label: 'Scripts', subtitle: '233 in scripts/ + 42 temp', color: '#fdcb6e', icon: '📜',
    summary: 'Operational scripts for analysis, batch processing, enrichment, maintenance, and imports. Run manually via `set -a; source .env.production.local; set +a; node scripts/whatever.mjs`. Plus ~42 untracked _tmp-* scratch scripts at the project root.',
    details: [
      'Analysis (~49 scripts): Pipeline stats, OCR backlog checks, duplicate detection, data quality audits, processing candidate identification. Examples: pipeline-stats.mjs, find-duplicates.mjs, check-ocr-backlog.mjs.',
      'Batch processing (~33): Direct Gemini API calls for bulk OCR, translation, re-OCR. Examples: realtime-ocr.mjs (Tier 3 keys, high RPS), submit-translations.mjs, retranslate-stale.mjs.',
      'Enrichment (~38): Catalog enrichment from USTC/BPH databases, entity extraction, collection assignment, language normalization, work ID assignment. Examples: enrich-from-catalogs.mjs, assign-collections.mjs, verify-first-translations.mjs.',
      'Maintenance (~49): Fix stuck jobs, correct page counts, repair covers, create MongoDB indexes, clean up Gemini batch artifacts. Examples: fix-stuck-jobs.mjs, fix-inflated-page-counts.mjs, create-critical-indexes.mjs.',
      'Import (~12): Bulk collection imports from specific archives. Examples: import-kloss-collection.mjs, import-laurenziana.mjs, import-getty-alchemy.mjs.',
      'Lambda build/deploy: scripts/aws-lambda/ has build-lambda.sh (esbuild), package-lambda.sh (zip), deploy-lambda.sh (AWS CLI upload).',
      'Shared utilities: scripts/lib/ has database helpers, API clients, prompt definitions, and common utilities used across scripts.',
      'Temp scripts (~42): _tmp-* files at project root. Scratch work from curation sessions, batch imports, and data fixes. Should not be committed.',
    ],
    gotchas: [
      'Scripts connect directly to MongoDB, bypassing the API layer. They can cause data inconsistencies if they skip page revisions.',
      'Always run with: set -a; source .env.production.local; set +a; node scripts/whatever.mjs',
      'secret-lover run does NOT work in background processes (Keychain inaccessible). Only use in foreground.',
    ],
    files: [
      'scripts/ — 233 operational scripts',
      'scripts/lib/ — shared utilities',
      'scripts/aws-lambda/ — Lambda build/deploy',
      'scripts/workers/ — 15 Hetzner workers (orchestrator, translate, collector, archive, sync, etc.)',
    ],
  },
};

// --- Layout positions ---
// Organized in a top-down flow: Users → App → Pipeline → Workers → Storage
const nodes: Node[] = [
  // Row 0: Users
  { id: 'frontend', type: 'service', position: { x: 60, y: 0 }, data: serviceData.frontend },
  { id: 'scripts', type: 'service', position: { x: 360, y: 0 }, data: serviceData.scripts },

  // Row 1: App layer
  { id: 'api', type: 'service', position: { x: 60, y: 160 }, data: serviceData.api },
  { id: 'crons', type: 'service', position: { x: 360, y: 160 }, data: serviceData.crons },

  // Row 1 right: External services
  { id: 'ia', type: 'service', position: { x: 660, y: 0 }, data: serviceData.ia },
  { id: 'other_archives', type: 'service', position: { x: 660, y: 140 }, data: serviceData.other_archives },
  { id: 'stripe', type: 'service', position: { x: 860, y: 0 }, data: serviceData.stripe },
  { id: 'twitter', type: 'service', position: { x: 860, y: 140 }, data: serviceData.twitter },
  { id: 'zenodo', type: 'service', position: { x: 860, y: 280 }, data: serviceData.zenodo },

  // Row 2: Hetzner orchestration
  { id: 'pipeline', type: 'service', position: { x: -240, y: 340 }, data: serviceData.pipeline },
  { id: 'enrich', type: 'service', position: { x: -240, y: 500 }, data: serviceData.enrich },
  { id: 'sync', type: 'service', position: { x: -240, y: 640 }, data: serviceData.sync },

  // Row 2: SQS queues (broken out)
  { id: 'sqs_ocr', type: 'service', position: { x: 20, y: 340 }, data: serviceData.sqs_ocr },
  { id: 'sqs_trans', type: 'service', position: { x: 220, y: 340 }, data: serviceData.sqs_trans },
  { id: 'sqs_img', type: 'service', position: { x: 420, y: 340 }, data: serviceData.sqs_img },
  { id: 'sqs_write', type: 'service', position: { x: 220, y: 680 }, data: serviceData.sqs_write },

  // Row 3: Lambda workers
  { id: 'lambda_ocr', type: 'service', position: { x: 20, y: 500 }, data: serviceData.lambda_ocr },
  { id: 'lambda_trans', type: 'service', position: { x: 220, y: 500 }, data: serviceData.lambda_trans },
  { id: 'lambda_img', type: 'service', position: { x: 420, y: 500 }, data: serviceData.lambda_img },
  { id: 'lambda_write', type: 'service', position: { x: 220, y: 830 }, data: serviceData.lambda_write },

  // Row 3 right: Gemini
  { id: 'gemini', type: 'service', position: { x: 660, y: 500 }, data: serviceData.gemini },

  // Row 4: Storage layer (MongoDB broken out)
  { id: 'mongodb_core', type: 'service', position: { x: 20, y: 990 }, data: serviceData.mongodb_core },
  { id: 'mongodb_processing', type: 'service', position: { x: 220, y: 990 }, data: serviceData.mongodb_processing },
  { id: 'mongodb_user', type: 'service', position: { x: 420, y: 990 }, data: serviceData.mongodb_user },
  { id: 'mongodb_gallery', type: 'service', position: { x: 620, y: 990 }, data: serviceData.mongodb_gallery },
  { id: 'mongodb_analytics', type: 'service', position: { x: 820, y: 990 }, data: serviceData.mongodb_analytics },
  { id: 'r2', type: 'service', position: { x: -180, y: 990 }, data: serviceData.r2 },
];

const edges: Edge[] = [
  // Users → App
  { id: 'e-front-api', source: 'frontend', target: 'api', animated: true, style: { stroke: '#58a6ff' } },
  { id: 'e-scripts-core', source: 'scripts', target: 'mongodb_core', style: { stroke: '#fdcb6e' } },

  // App → External
  { id: 'e-api-ia', source: 'api', target: 'ia', label: 'import', style: { stroke: '#e17055' } },
  { id: 'e-api-other', source: 'api', target: 'other_archives', label: 'import', style: { stroke: '#e17055' } },
  { id: 'e-api-stripe', source: 'api', target: 'stripe', style: { stroke: '#635bff' } },
  { id: 'e-api-zenodo', source: 'api', target: 'zenodo', style: { stroke: '#2980b9' } },
  { id: 'e-crons-twitter', source: 'crons', target: 'twitter', style: { stroke: '#1da1f2' } },

  // App → Storage
  { id: 'e-api-core', source: 'api', target: 'mongodb_core', animated: true, style: { stroke: '#4db33d' } },
  { id: 'e-api-user', source: 'api', target: 'mongodb_user', style: { stroke: '#4db33d' } },
  { id: 'e-api-gallery', source: 'api', target: 'mongodb_gallery', style: { stroke: '#4db33d' } },
  { id: 'e-api-analytics', source: 'api', target: 'mongodb_analytics', style: { stroke: '#4db33d' } },
  { id: 'e-api-r2', source: 'api', target: 'r2', style: { stroke: '#f38020' } },
  { id: 'e-crons-analytics', source: 'crons', target: 'mongodb_analytics', style: { stroke: '#f0f6fc40' } },

  // Pipeline → SQS
  { id: 'e-pipe-ocr', source: 'pipeline', target: 'sqs_ocr', animated: true, style: { stroke: '#d63031' } },
  { id: 'e-pipe-trans', source: 'pipeline', target: 'sqs_trans', animated: true, style: { stroke: '#d63031' } },
  { id: 'e-pipe-img', source: 'pipeline', target: 'sqs_img', animated: true, style: { stroke: '#d63031' } },
  { id: 'e-enrich-api', source: 'enrich', target: 'api', style: { stroke: '#d63031' } },
  { id: 'e-sync-core', source: 'sync', target: 'mongodb_core', style: { stroke: '#d63031' } },
  { id: 'e-sync-gallery', source: 'sync', target: 'mongodb_gallery', style: { stroke: '#d63031' } },

  // SQS → Lambda
  { id: 'e-sq-ocr', source: 'sqs_ocr', target: 'lambda_ocr', animated: true, style: { stroke: '#ff9f43' } },
  { id: 'e-sq-trans', source: 'sqs_trans', target: 'lambda_trans', animated: true, style: { stroke: '#ff9f43' } },
  { id: 'e-sq-img', source: 'sqs_img', target: 'lambda_img', animated: true, style: { stroke: '#ff9f43' } },
  { id: 'e-sq-write', source: 'sqs_write', target: 'lambda_write', animated: true, style: { stroke: '#ff9f43' } },

  // Lambda → Gemini
  { id: 'e-ocr-gem', source: 'lambda_ocr', target: 'gemini', style: { stroke: '#6c5ce7' } },
  { id: 'e-trans-gem', source: 'lambda_trans', target: 'gemini', style: { stroke: '#6c5ce7' } },
  { id: 'e-img-gem', source: 'lambda_img', target: 'gemini', style: { stroke: '#6c5ce7' } },
  { id: 'e-enrich-gem', source: 'enrich', target: 'gemini', style: { stroke: '#d63031' } },

  // Lambda → writeResults
  { id: 'e-ocr-wr', source: 'lambda_ocr', target: 'sqs_write', style: { stroke: '#6c5ce7', strokeDasharray: '5' } },
  { id: 'e-trans-wr', source: 'lambda_trans', target: 'sqs_write', style: { stroke: '#6c5ce7', strokeDasharray: '5' } },
  { id: 'e-img-wr', source: 'lambda_img', target: 'sqs_write', style: { stroke: '#6c5ce7', strokeDasharray: '5' } },

  // Write → MongoDB
  { id: 'e-write-core', source: 'lambda_write', target: 'mongodb_core', animated: true, style: { stroke: '#4db33d' }, label: 'pages' },
  { id: 'e-write-proc', source: 'lambda_write', target: 'mongodb_processing', style: { stroke: '#4db33d' }, label: 'jobs + revisions' },
  { id: 'e-write-gal', source: 'lambda_write', target: 'mongodb_gallery', style: { stroke: '#4db33d' }, label: 'images' },
];

// --- Styles ---
const nodeColorMap: Record<string, string> = {};
for (const [key, val] of Object.entries(serviceData)) {
  nodeColorMap[key] = val.color;
}

export default function SystemMapPage() {
  const [nodesState, , onNodesChange] = useNodesState(nodes);
  const [edgesState, , onEdgesChange] = useEdgesState(edges);
  const [popup, setPopup] = useState<ServiceInfo | null>(null);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.data && (node.data as ServiceInfo).details) {
      setPopup(node.data as ServiceInfo);
    }
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0d1117' }}>
      <div style={{
        position: 'absolute', top: 16, left: 16, zIndex: 10,
        background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
        padding: '12px 16px', maxWidth: 320,
      }}>
        <h1 style={{ fontSize: 16, color: '#f0f6fc', margin: 0 }}>Source Library — System Map</h1>
        <p style={{ fontSize: 12, color: '#8b949e', margin: '4px 0 0' }}>
          Click any node for detailed info. Scroll to zoom. Drag to pan.
        </p>
        <div style={{ fontSize: 11, color: '#484f58', marginTop: 8, lineHeight: 1.6 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#58a6ff', marginRight: 4, verticalAlign: 'middle' }} /> Frontend
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#d63031', marginRight: 4, marginLeft: 10, verticalAlign: 'middle' }} /> Hetzner
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#ff9f43', marginRight: 4, marginLeft: 10, verticalAlign: 'middle' }} /> SQS
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#6c5ce7', marginRight: 4, marginLeft: 10, verticalAlign: 'middle' }} /> Lambda
          <br />
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#4db33d', marginRight: 4, verticalAlign: 'middle' }} /> MongoDB
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#f38020', marginRight: 4, marginLeft: 10, verticalAlign: 'middle' }} /> R2
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#4285f4', marginRight: 4, marginLeft: 10, verticalAlign: 'middle' }} /> Gemini
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#e17055', marginRight: 4, marginLeft: 10, verticalAlign: 'middle' }} /> Archives
        </div>
      </div>

      <ReactFlow
        nodes={nodesState}
        edges={edgesState}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#0d1117' }}
      >
        <Background color="#21262d" gap={20} />
        <Controls
          style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8 }}
        />
        <MiniMap
          nodeColor={(node) => nodeColorMap[node.id] || '#30363d'}
          maskColor="rgba(0,0,0,0.7)"
          style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 8 }}
        />
      </ReactFlow>

      {popup && <InfoPopup data={popup} onClose={() => setPopup(null)} />}
    </div>
  );
}
