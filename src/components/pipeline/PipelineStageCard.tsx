/* ── Stage detail cards for /developers/pipeline ── */

interface StageDetail {
  id: string;
  name: string;
  color: string;
  description: string;
  backend: string;
  costPerPage?: string;
  model?: string;
  notes?: string[];
}

export const STAGE_DETAILS: StageDetail[] = [
  {
    id: 'import',
    name: 'Import',
    color: '#78716c',
    description: 'Books arrive from 13 digital library sources. Each import fetches metadata and page images via IIIF manifests or provider-specific APIs.',
    backend: 'API routes (manual trigger)',
    notes: [
      'Sources: Internet Archive, Gallica, MDZ, Wellcome, e-rara, Bodleian, Cambridge, HAB, Vatican, Google Books, Europeana, Library of Congress, generic IIIF',
      'Creates book + page records in MongoDB, queues split detection',
    ],
  },
  {
    id: 'archive',
    name: 'Archive',
    color: 'var(--accent-gold)',
    description: 'Page images are archived from external sources to Vercel Blob, ensuring long-term availability. Original URLs are always preserved for provenance.',
    backend: 'Hetzner server (external script) + cron check',
    notes: [
      'Generates thumbnails; split detection uses aspect ratio analysis to identify two-page spreads',
      '24h timeout — OCR works on original IIIF URLs if archiving stalls',
    ],
  },
  {
    id: 'ocr',
    name: 'OCR',
    color: 'var(--accent-sage)',
    description: 'Gemini vision models extract text from page images. Handles blackletter (Fraktur), Latin abbreviations, ligatures, multi-column layouts, and drop caps.',
    backend: 'Lambda workers (primary) or Gemini Batch API (50% cheaper, slower)',
    costPerPage: '~$0.002 (realtime) / ~$0.001 (batch)',
    model: 'gemini-3-flash-preview',
    notes: [
      'Standard OCR prompt (v6) used for all languages',
      'Outputs XML tags: <page-type>, <columns>, <column-break/>, <detected-images>, <language>',
      'Lambda processes 1 page per invocation via SQS standard queue (parallel)',
      'Backpressure: max 50 active Lambda OCR jobs, max 200 Batch API jobs',
    ],
  },
  {
    id: 'metadata',
    name: 'Metadata Enrichment',
    color: 'var(--accent-gold)',
    description: 'AI reads first 25 OCR pages to classify the book: language, categories, description, display title, subject keywords, source work dates, and first-translation status.',
    backend: 'Gemini realtime (pipeline cron inline)',
    costPerPage: '~$0.005/book',
    model: 'gemini-3-flash-preview',
    notes: [
      'Only applies changes at medium+ confidence — low-confidence results stored but don\'t overwrite',
      'source_work_dates tracks compositional layers (e.g. Plato\'s Timaeus: composition c. 360 BCE, Ficino translation 1484)',
      'Non-blocking: failures skip ahead so they don\'t stall translation',
    ],
  },
  {
    id: 'ft-verify',
    name: 'First Translation Check',
    color: '#7c5db5',
    description: 'Verifies whether this is the first known English translation of the source work. Uses Gemini with function calling to search Open Library, Google Books, USTC, and local catalogs.',
    backend: 'Gemini function calling (2-6 rounds per book)',
    costPerPage: '~$0.003/book',
    model: 'gemini-3-flash-preview',
    notes: [
      'Five tools: search_local_catalogs, search_open_library, search_google_books, search_ustc, make_determination',
      'Dispositions: first_translation, translation_exists, first_full_translation, needs_review',
      'English books and already-verified books skip this stage',
      'Non-blocking: persistent failures skip to next stage',
    ],
  },
  {
    id: 'translate',
    name: 'Translation',
    color: 'var(--accent-rust)',
    description: 'Pages translated to English via Lambda FIFO queue. Each page receives the previous page\'s translation as context for terminology consistency and sentence continuity.',
    backend: 'Lambda workers (SQS FIFO queue only — never Batch API)',
    costPerPage: '~$0.002',
    model: 'gemini-3-flash-preview',
    notes: [
      'FIFO queue ensures sequential page order per book — critical for context continuity',
      'English books (pre-1700) get modernized instead of translated',
      'Nearly-done books (90%+ translated) are prioritized',
      'Backpressure: max 100 active Lambda translation jobs',
    ],
  },
  {
    id: 'enrich',
    name: 'Enrichment',
    color: 'var(--accent-violet)',
    description: 'Generates a reading summary (overview, themes, quotes) and a searchable index of people, places, concepts, key terms, and section summaries.',
    backend: 'enrich-books cron (Gemini realtime, all books concurrent)',
    costPerPage: '~$0.04/book',
    model: 'gemini-3-flash-preview',
    notes: [
      'Books processed concurrently with Promise.allSettled + 120s per-book timeout',
      'Also runs scoreBookQuality() for KDP publishing score',
      'Non-critical: persistent failure skips to next stage',
    ],
  },
  {
    id: 'chapters',
    name: 'Chapter Extraction',
    color: 'var(--accent-violet)',
    description: 'Extracts chapter and section headings from OCR text and links them to specific pages, creating a navigable table of contents.',
    backend: 'enrich-books cron (sequential, not concurrent)',
    costPerPage: '~$0.01/book',
    model: 'gemini-3-flash-preview',
    notes: [
      'Skips books with fewer than 10 pages',
      'Non-critical: persistent failure skips to next stage',
    ],
  },
  {
    id: 'images',
    name: 'Image Extraction',
    color: 'var(--status-warning)',
    description: 'AI vision scans pages with visual content for illustrations, emblems, diagrams, and decorative elements. Only pages with visual page types (illustration, diagram, map, frontispiece, mixed) or OCR-detected images are processed — text-only and blank pages are skipped.',
    backend: 'Lambda workers (SQS standard queue)',
    costPerPage: '~$0.002 per scanned page',
    model: 'gemini-3-flash-preview',
    notes: [
      'Filters by page_type and <detected-images> OCR tags — skips ~80-90% of pages',
      'Gallery images require quality >= 0.5 and a bounding box',
      'Rich metadata per detection: subjects, figures, symbols, style, technique, museum-style label',
      'Backpressure: max 10 active image extraction jobs',
      'Results flow through write-results SQS queue to Writer Lambda',
    ],
  },
  {
    id: 'complete',
    name: 'Complete',
    color: 'var(--status-success)',
    description: 'Fully processed: every page has OCR text, English translation, and illustration detection. Book has summary, index, and chapters.',
    backend: 'Pipeline cron (finalization check)',
    notes: [
      'Requires >10% OCR coverage to pass validation',
      'Syncs book text to GitHub on completion (non-blocking)',
      'Empty books (0 pages) get flagged as needs_attention instead',
    ],
  },
];

export default function PipelineStageCard({ stage }: { stage: StageDetail }) {
  return (
    <div
      id={`stage-${stage.id}`}
      className="bg-white rounded-xl border border-border-light p-6 scroll-mt-24"
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <h3 className="font-semibold text-primary text-lg">{stage.name}</h3>
      </div>

      <p className="text-secondary text-[15px] leading-relaxed mb-4">
        {stage.description}
      </p>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
        <div>
          <span className="text-muted">Backend: </span>
          <span className="text-secondary">{stage.backend}</span>
        </div>
        {stage.model && (
          <div>
            <span className="text-muted">Model: </span>
            <code className="text-accent-rust text-xs">{stage.model}</code>
          </div>
        )}
        {stage.costPerPage && (
          <div>
            <span className="text-muted">Cost: </span>
            <span className="text-secondary">{stage.costPerPage}</span>
          </div>
        )}
      </div>

      {stage.notes && stage.notes.length > 0 && (
        <ul className="space-y-1.5 text-sm text-muted">
          {stage.notes.map((note, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-border-medium mt-0.5 shrink-0">&bull;</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
