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
  details: string[];
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
          padding: 24, maxWidth: 520, width: '90%', maxHeight: '80vh', overflowY: 'auto',
          color: '#c9d1d9',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{data.icon}</span>
            <div>
              <h2 style={{ fontSize: 18, color: '#f0f6fc', margin: 0 }}>{data.label}</h2>
              {data.subtitle && <p style={{ fontSize: 13, color: '#8b949e', margin: 0 }}>{data.subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#8b949e', fontSize: 20,
              cursor: 'pointer', padding: '4px 8px',
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ borderTop: '1px solid #21262d', paddingTop: 12 }}>
          {data.details.map((d, i) => (
            <p key={i} style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 8, color: '#c9d1d9' }}>{d}</p>
          ))}
        </div>

        {data.files && data.files.length > 0 && (
          <div style={{ marginTop: 12, borderTop: '1px solid #21262d', paddingTop: 12 }}>
            <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, fontWeight: 600 }}>KEY FILES</p>
            {data.files.map((f, i) => (
              <code key={i} style={{ display: 'block', fontSize: 12, color: '#7ee787', marginBottom: 4, wordBreak: 'break-all' }}>{f}</code>
            ))}
          </div>
        )}

        {data.collections && data.collections.length > 0 && (
          <div style={{ marginTop: 12, borderTop: '1px solid #21262d', paddingTop: 12 }}>
            <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, fontWeight: 600 }}>MONGODB COLLECTIONS</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {data.collections.map((c, i) => (
                <span key={i} style={{
                  fontSize: 11, background: '#21262d', padding: '2px 8px',
                  borderRadius: 4, color: '#c9d1d9', fontFamily: 'monospace',
                }}>{c}</span>
              ))}
            </div>
          </div>
        )}

        {data.url && (
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block', marginTop: 16, padding: '8px 16px',
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

function GroupNode({ data }: { data: ServiceInfo }) {
  return (
    <div
      style={{
        background: `${data.color}08`, border: `1px dashed ${data.color}40`,
        borderRadius: 12, padding: '8px 12px', minWidth: 160,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: data.color, textTransform: 'uppercase', letterSpacing: 1 }}>
        {data.icon} {data.label}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  service: ServiceNode,
  group: GroupNode,
};

// --- Node definitions ---
const serviceData: Record<string, ServiceInfo> = {
  browser: {
    label: 'Browser', subtitle: 'sourcelibrary.org', color: '#58a6ff', icon: '🌐',
    url: 'https://sourcelibrary.org',
    details: [
      '~160 pages serving readers, researchers, and admins.',
      '29 blog posts + 6 press pages (hardcoded JSX, no CMS).',
      'Core features: book reader, full-text search, collections, gallery, encyclopedia.',
      'Auth via NextAuth (Google + Email). Admin via whitelist.',
    ],
    files: ['src/app/', 'src/components/ (148 components, 35 unused)'],
  },
  next: {
    label: 'Next.js 16', subtitle: '~160 pages · 316 API routes', color: '#f0f6fc', icon: '▲',
    url: 'https://sourcelibrary.org/admin/pipeline',
    details: [
      'Vercel project: sourcelibrary-v2. Hosted on Vercel.',
      'No repository/service layer — API routes query MongoDB directly via getDb().collection().',
      '316 API routes: books (50+), pages (20+), import (13), admin (30+), search (6), gallery (9), social (11).',
      'Frontend API client: src/lib/api-client/ (31 typed wrappers).',
    ],
    files: ['src/app/api/', 'src/lib/api-client/', 'src/lib/types/'],
    collections: ['All 57 collections accessed directly from routes'],
  },
  mongodb: {
    label: 'MongoDB Atlas', subtitle: 'bookstore · 57 collections', color: '#4db33d', icon: '🗄️',
    url: 'https://cloud.mongodb.com',
    details: [
      'Production database: bookstore (~5,355 books).',
      'Singleton connection with pool management. Lambda: 1 conn/instance. Vercel: max 3.',
      'Atlas saturates at ~40 concurrent Lambda jobs. Backpressure limits per phase.',
      'id vs _id: ~1,186 old books have id !== _id. Always use book.id for lookups.',
    ],
    files: ['src/lib/mongodb.ts', 'src/lib/mongodb-client.ts', 'src/lib/book-lookup.ts'],
    collections: [
      'books', 'pages', 'deleted_books', 'collections', 'entities',
      'jobs', 'batch_jobs', 'page_revisions', 'gemini_usage', 'system_config',
      'users', 'admin_users', 'likes', 'highlights', 'reading_history',
      'gallery_images', 'gallery_collections', 'gallery_embeddings',
      'social_posts', 'discussions', 'purchases', 'editions',
      'analytics_events', 'pipeline_health_daily', 'cron_runs', 'audit_log',
    ],
  },
  r2: {
    label: 'Cloudflare R2', subtitle: 'images.sourcelibrary.org', color: '#f38020', icon: '📦',
    url: 'https://images.sourcelibrary.org',
    details: [
      'Object storage for page images, thumbnails, gallery PDFs.',
      'Migrated from Vercel Blob — saves ~$655/mo.',
      'Public URL: images.sourcelibrary.org.',
      'R2 abstraction with Vercel Blob fallback in storage.ts.',
    ],
    files: ['src/lib/storage.ts'],
  },
  pipeline: {
    label: 'Pipeline Orchestrator', subtitle: 'post-import-pipeline · every 10min', color: '#d63031', icon: '🔄',
    url: 'https://sourcelibrary.org/admin/pipeline',
    details: [
      'ONE unified pipeline with 3 parallel phases (OCR, translation, image extraction).',
      'Runs on Hetzner cax31 (46.224.122.120), NOT on Vercel. Crons not in git.',
      'Global kill switch: system_config.processing_control.paused.',
      'paused: true stops NEW job queueing but does NOT stop in-flight Lambda workers.',
    ],
    files: ['src/app/api/cron/post-import-pipeline/', 'src/app/api/jobs/queue-books/'],
    collections: ['jobs', 'batch_jobs', 'system_config', 'gemini_usage'],
  },
  enrich: {
    label: 'Enrichment', subtitle: 'enrich-books · every 10min', color: '#d63031', icon: '✨',
    url: 'https://sourcelibrary.org/admin/pipeline',
    details: [
      'Metadata enrichment: summaries, chapter extraction, indexes, transliteration.',
      'Uses Gemini (gemini-3-flash-preview) for all tasks.',
      'Runs on Hetzner alongside the main pipeline orchestrator.',
    ],
    files: ['src/app/api/cron/enrich-books/', 'src/lib/metadata-enrichment.ts'],
  },
  sync: {
    label: 'Sync Worker', subtitle: 'every 2h', color: '#d63031', icon: '🔃',
    details: [
      'Replaces Vercel crons: sync-page-counts + sync-gallery-images.',
      'Refreshes cached book-level page counts (pages_ocr, pages_translated).',
      'Syncs gallery_images collection with detected_images.',
    ],
    files: ['scripts/workers/sync-worker.mjs'],
    collections: ['books', 'gallery_images'],
  },
  sqs: {
    label: 'SQS Queues', subtitle: '4 queues · eu-central-1', color: '#ff9f43', icon: '📬',
    url: 'https://eu-central-1.console.aws.amazon.com/sqs/v3/home?region=eu-central-1',
    details: [
      'pageOcr (FIFO) — parallel processing, batch-friendly.',
      'pageTranslation (FIFO) — sequential, needs cross-page context chain.',
      'pageImageExtraction — parallel processing.',
      'writeResults — batched MongoDB writes from all workers.',
    ],
    files: ['src/lib/sqs-client.ts'],
  },
  lambda_ocr: {
    label: 'OCR Processor', subtitle: '10 concurrent', color: '#6c5ce7', icon: '👁️',
    url: 'https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions/sourcelibrary-ocr-processor',
    details: [
      'Processes individual pages: image → Gemini → OCR text.',
      'Standard OCR prompt v6. NEVER use language-specific prompts.',
      'Writes results to writeResults SQS queue for batched DB writes.',
      'Reserved concurrency: 10 (backpressure limit: 20).',
    ],
    files: ['src/workers/ocr-processor.ts', 'src/workers/ocr-processor-logic.ts'],
    collections: ['pages (ocr.data)', 'page_revisions', 'gemini_usage'],
  },
  lambda_trans: {
    label: 'Translation Processor', subtitle: '15 concurrent', color: '#6c5ce7', icon: '🌍',
    url: 'https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions/sourcelibrary-translation-processor',
    details: [
      'Translates pages sequentially — each page reads previous translation for context.',
      'FIFO queue ensures page ordering. Realtime API ONLY (never Batch API).',
      'Reserved concurrency: 15 (backpressure limit: 30).',
      'CRITICAL: NEVER use Gemini Batch API for translation — lacks cross-page context.',
    ],
    files: ['src/workers/translation-processor.ts', 'src/workers/translation-processor-logic.ts'],
    collections: ['pages (translation.data)', 'page_revisions', 'gemini_usage'],
  },
  lambda_img: {
    label: 'Image Extraction', subtitle: '10 concurrent', color: '#6c5ce7', icon: '🖼️',
    url: 'https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions/sourcelibrary-image-extraction-processor',
    details: [
      'Extracts gallery images from pages using Gemini Vision.',
      'Generates metadata: subjects, figures, symbols, style, technique.',
      'Writes to writeResults queue for batched DB writes.',
      'Reserved concurrency: 10 (backpressure limit: 50).',
    ],
    files: ['src/workers/image-extraction-processor.ts', 'src/lib/image-extraction.ts'],
    collections: ['gallery_images', 'gallery_embeddings', 'detected_images'],
  },
  lambda_write: {
    label: 'Write Processor', subtitle: '50 concurrent', color: '#6c5ce7', icon: '💾',
    details: [
      'Consumes writeResults SQS queue. Batched MongoDB writes.',
      'Creates page revisions before overwriting ocr.data or translation.data.',
      'High concurrency (50) to keep up with all 3 processing phases.',
    ],
    files: ['src/workers/write-processor.ts', 'src/workers/write-processor-logic.ts'],
    collections: ['pages', 'page_revisions'],
  },
  gemini: {
    label: 'Gemini AI', subtitle: '10-key rotation', color: '#4285f4', icon: '🤖',
    url: 'https://ai.google.dev/gemini-api/docs/models',
    details: [
      'Model: gemini-3-flash-preview for ALL tasks (OCR, translation, summary, images).',
      '10 API keys with 60s cooldown rotation. GEMINI_API_KEY through _10.',
      'GEMINI_API_KEY_TIER3 for heavy batch work.',
      'Cost tracked in gemini_usage collection (single source of truth).',
    ],
    files: ['src/lib/ai.ts', 'src/lib/gemini-client.ts', 'src/lib/gemini-batch.ts'],
    collections: ['gemini_usage', 'gemini_usage_daily'],
  },
  archives: {
    label: 'IIIF Archives', subtitle: 'IA · Gallica · Wellcome · LOC', color: '#e17055', icon: '🏛️',
    url: 'https://sourcelibrary.org/libraries',
    details: [
      'Primary import: Internet Archive (IIIF manifests).',
      'Fallback chain: IA → Gallica → HathiTrust → Project Gutenberg.',
      '13 source-specific importers + generic IIIF importer.',
      'If a source 403s, move on immediately.',
    ],
    files: ['src/app/api/import/', 'src/lib/import-utils.ts'],
    collections: ['external_catalog', 'import_candidates'],
  },
  stripe: {
    label: 'Stripe', subtitle: 'Ficino Society', color: '#635bff', icon: '💳',
    url: 'https://dashboard.stripe.com',
    details: [
      'Ficino Society membership: $100/year.',
      'Feature-flagged via STRIPE_SECRET_KEY presence.',
      'Museum vibe — prices hidden until download intent.',
    ],
    files: ['src/lib/stripe.ts', 'src/app/api/stripe/'],
    collections: ['purchases'],
  },
  twitter: {
    label: 'Twitter/X', subtitle: '@SourceLibrary_', color: '#1da1f2', icon: '🐦',
    url: 'https://x.com/SourceLibrary_',
    details: [
      'Automated posting via Vercel cron (every 3h).',
      'Tweet generator in tweet-generator.ts (616 lines).',
      'Daily reset cron resets tweet counter. Monthly reset on 1st.',
    ],
    files: ['src/lib/twitter.ts', 'src/lib/tweet-generator.ts', 'src/app/api/cron/social-post/'],
    collections: ['social_posts', 'social_config', 'social_tags'],
  },
  zenodo: {
    label: 'Zenodo', subtitle: 'DOI minting', color: '#2980b9', icon: '📄',
    url: 'https://zenodo.org',
    details: [
      'InvenioRDM REST API for minting DOIs on scholarly editions.',
      'Edition lifecycle: draft → review → published.',
      'First mint: Fludd (2026-03-15).',
    ],
    files: ['src/lib/zenodo.ts'],
    collections: ['editions'],
  },
  crons: {
    label: 'Vercel Crons', subtitle: '4 active', color: '#f0f6fc', icon: '⏰',
    details: [
      'social-post: every 3h — auto-post queued tweets.',
      'health-check: hourly — DB latency, zombie jobs, alerts.',
      'daily-pipeline-report: 6 AM UTC — writes to pipeline_health_daily.',
      'social-reset: daily midnight — reset tweet counter.',
      '7 pipeline crons moved to Hetzner (code still exists but disabled).',
    ],
    files: ['src/app/api/cron/', 'vercel.json'],
    collections: ['cron_runs', 'pipeline_health_daily'],
  },
  scripts: {
    label: 'Scripts', subtitle: '233 operational', color: '#fdcb6e', icon: '📜',
    details: [
      'Analysis (~49): pipeline stats, OCR backlog, duplicate detection.',
      'Batch processing (~33): realtime OCR, translations, re-OCR.',
      'Enrichment (~38): catalog enrichment, entity extraction, classification.',
      'Maintenance (~49): fix stuck jobs, page counts, covers, indexes.',
      'Import (~12): bulk collection imports from archives.',
      '+ 42 untracked _tmp-* scripts at root (scratch work).',
    ],
    files: ['scripts/', 'scripts/lib/', 'scripts/aws-lambda/'],
  },
};

// --- Layout positions ---
const nodes: Node[] = [
  // Users row
  { id: 'browser', type: 'service', position: { x: 100, y: 0 }, data: serviceData.browser },
  { id: 'scripts', type: 'service', position: { x: 400, y: 0 }, data: serviceData.scripts },

  // Vercel row
  { id: 'next', type: 'service', position: { x: 100, y: 150 }, data: serviceData.next },
  { id: 'crons', type: 'service', position: { x: 400, y: 150 }, data: serviceData.crons },

  // Hetzner row
  { id: 'pipeline', type: 'service', position: { x: -200, y: 320 }, data: serviceData.pipeline },
  { id: 'enrich', type: 'service', position: { x: -200, y: 460 }, data: serviceData.enrich },
  { id: 'sync', type: 'service', position: { x: -200, y: 580 }, data: serviceData.sync },

  // SQS
  { id: 'sqs', type: 'service', position: { x: 100, y: 320 }, data: serviceData.sqs },

  // Lambda row
  { id: 'lambda_ocr', type: 'service', position: { x: 100, y: 480 }, data: serviceData.lambda_ocr },
  { id: 'lambda_trans', type: 'service', position: { x: 310, y: 480 }, data: serviceData.lambda_trans },
  { id: 'lambda_img', type: 'service', position: { x: 520, y: 480 }, data: serviceData.lambda_img },
  { id: 'lambda_write', type: 'service', position: { x: 310, y: 640 }, data: serviceData.lambda_write },

  // Gemini
  { id: 'gemini', type: 'service', position: { x: 730, y: 480 }, data: serviceData.gemini },

  // Storage
  { id: 'mongodb', type: 'service', position: { x: 310, y: 800 }, data: serviceData.mongodb },
  { id: 'r2', type: 'service', position: { x: 100, y: 800 }, data: serviceData.r2 },

  // External
  { id: 'archives', type: 'service', position: { x: 700, y: 150 }, data: serviceData.archives },
  { id: 'stripe', type: 'service', position: { x: 700, y: 270 }, data: serviceData.stripe },
  { id: 'twitter', type: 'service', position: { x: 570, y: 60 }, data: serviceData.twitter },
  { id: 'zenodo', type: 'service', position: { x: 700, y: 370 }, data: serviceData.zenodo },
];

const edges: Edge[] = [
  // Users → Vercel
  { id: 'e-browser-next', source: 'browser', target: 'next', animated: true, style: { stroke: '#58a6ff' } },
  { id: 'e-scripts-mongodb', source: 'scripts', target: 'mongodb', style: { stroke: '#fdcb6e' } },

  // Vercel → External
  { id: 'e-next-mongodb', source: 'next', target: 'mongodb', animated: true, style: { stroke: '#4db33d' } },
  { id: 'e-next-r2', source: 'next', target: 'r2', style: { stroke: '#f38020' } },
  { id: 'e-next-archives', source: 'next', target: 'archives', label: 'import', style: { stroke: '#e17055' } },
  { id: 'e-next-stripe', source: 'next', target: 'stripe', style: { stroke: '#635bff' } },
  { id: 'e-next-zenodo', source: 'next', target: 'zenodo', style: { stroke: '#2980b9' } },
  { id: 'e-crons-twitter', source: 'crons', target: 'twitter', style: { stroke: '#1da1f2' } },

  // Pipeline → SQS
  { id: 'e-pipeline-sqs', source: 'pipeline', target: 'sqs', animated: true, style: { stroke: '#d63031' }, label: 'queue jobs' },
  { id: 'e-enrich-next', source: 'enrich', target: 'next', style: { stroke: '#d63031' } },
  { id: 'e-sync-mongodb', source: 'sync', target: 'mongodb', style: { stroke: '#d63031' } },

  // SQS → Lambda
  { id: 'e-sqs-ocr', source: 'sqs', target: 'lambda_ocr', animated: true, style: { stroke: '#ff9f43' } },
  { id: 'e-sqs-trans', source: 'sqs', target: 'lambda_trans', animated: true, style: { stroke: '#ff9f43' } },
  { id: 'e-sqs-img', source: 'sqs', target: 'lambda_img', animated: true, style: { stroke: '#ff9f43' } },

  // Lambda → Gemini
  { id: 'e-ocr-gemini', source: 'lambda_ocr', target: 'gemini', style: { stroke: '#6c5ce7' } },
  { id: 'e-trans-gemini', source: 'lambda_trans', target: 'gemini', style: { stroke: '#6c5ce7' } },
  { id: 'e-img-gemini', source: 'lambda_img', target: 'gemini', style: { stroke: '#6c5ce7' } },

  // Lambda → Write processor
  { id: 'e-ocr-write', source: 'lambda_ocr', target: 'lambda_write', style: { stroke: '#6c5ce7', strokeDasharray: '4' } },
  { id: 'e-trans-write', source: 'lambda_trans', target: 'lambda_write', style: { stroke: '#6c5ce7', strokeDasharray: '4' } },
  { id: 'e-img-write', source: 'lambda_img', target: 'lambda_write', style: { stroke: '#6c5ce7', strokeDasharray: '4' } },

  // Write → MongoDB
  { id: 'e-write-mongodb', source: 'lambda_write', target: 'mongodb', animated: true, style: { stroke: '#4db33d' }, label: 'write pages' },
];

export default function SystemMapPage() {
  const [nodesState, setNodes, onNodesChange] = useNodesState(nodes);
  const [edgesState, setEdges, onEdgesChange] = useEdgesState(edges);
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
        padding: '12px 16px',
      }}>
        <h1 style={{ fontSize: 16, color: '#f0f6fc', margin: 0 }}>Source Library — System Map</h1>
        <p style={{ fontSize: 12, color: '#8b949e', margin: '4px 0 0' }}>Click any node for details. Scroll to zoom. Drag to pan.</p>
      </div>

      <ReactFlow
        nodes={nodesState}
        edges={edgesState}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#0d1117' }}
      >
        <Background color="#21262d" gap={20} />
        <Controls
          style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8 }}
        />
        <MiniMap
          nodeColor={(node) => (node.data as ServiceInfo)?.color || '#30363d'}
          maskColor="rgba(0,0,0,0.7)"
          style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 8 }}
        />
      </ReactFlow>

      {popup && <InfoPopup data={popup} onClose={() => setPopup(null)} />}
    </div>
  );
}
