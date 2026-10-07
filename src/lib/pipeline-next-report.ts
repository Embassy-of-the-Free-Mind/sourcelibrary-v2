/**
 * PRIOR ART: src/lib/quality-report.ts / src/lib/spend-report.ts — read ONE ops_reports document for an
 * admin page (the pattern followed); neither reads the pipeline-next snapshot.
 * scripts/analytics/snapshot-library-dashboard.mjs — per-step counts for /admin from the 2026-10-01 draft
 * rule, without prices or held cohorts.
 *
 * The /admin/pipeline "what work is left" panel (#5480). Reads the newest `pipeline_next_daily` row that
 * scripts/audit/pipeline-next-step-audit.mjs writes each morning (#5478) — one findOne on a tiny
 * collection, never a scan of `books` on the request path (request-path-queries.md) — and prices it
 * with scripts/lib/pipeline-unit-prices.mjs, where every rate carries its source and date.
 */
import { getDb } from '@/lib/mongodb';
// Scripts-side, pure data: one copy of each rate and of the lane registry, shared with the workers.
import { UNIT_PRICES, STEP_PAGE_FIELD, isChineseLanguage } from '../../scripts/lib/pipeline-unit-prices.mjs';

export const PIPELINE_NEXT_REPORT_TYPE = 'pipeline_next_daily';

export interface Work { books: number; pages: number; archive_pages: number; ocr_pages: number; translate_pages: number }
export interface StepRow { step: string; all: Work; live: Work }
export interface PipelineNextReport {
  _id: string;
  day: string;
  generated_at: Date | string;
  generated_by: string;
  denominator: { rule: string; books: number; live: number; live_rule: string };
  verdict: { status: string; fails: string[] };
  steps: StepRow[];
  step_reasons: (StepRow & { reason: string })[];
  step_languages_live: Record<string, (Work & { language: string })[]>;
  held: { reason: string; issue: number | null; all: Work; live: Work }[];
  shapes: Record<string, { all?: number | null; live?: number | null; note?: string }>;
  agreement: { compared: number; disagree: number; fresh: number; stale: number; stale_pct: number; last_stamp_run: Date | string | null };
}

export async function getLatestPipelineNextReport(): Promise<PipelineNextReport | null> {
  const db = await getDb();
  const rows = await db.collection('ops_reports')
    .find({ type: PIPELINE_NEXT_REPORT_TYPE, scope: 'corpus' })
    .sort({ day: -1 })
    .limit(1)
    .toArray();
  return (rows[0] as unknown as PipelineNextReport) ?? null;
}

type Price = { low: number; high: number; currency: string; basis: string; sources: { value: number; what: string; where: string; measured: string | null }[] };
const PRICES = UNIT_PRICES as Record<string, Price>;

export interface WorkRow {
  key: string;
  label: string;
  note?: string;
  books: number;
  pages: number;
  pageKind: string;
  price: Price;
  costLow: number;
  costHigh: number;
}

export interface HeldRow { reason: string; issue: number | null; books: number; live: number; ocr_pages: number; translate_pages: number }

const zero = (): Work => ({ books: 0, pages: 0, archive_pages: 0, ocr_pages: 0, translate_pages: 0 });
const add = (a: Work, b: Work): Work => ({
  books: a.books + b.books, pages: a.pages + b.pages, archive_pages: a.archive_pages + b.archive_pages,
  ocr_pages: a.ocr_pages + b.ocr_pages, translate_pages: a.translate_pages + b.translate_pages,
});
const sub = (a: Work, b: Work): Work => ({
  books: a.books - b.books, pages: a.pages - b.pages, archive_pages: a.archive_pages - b.archive_pages,
  ocr_pages: a.ocr_pages - b.ocr_pages, translate_pages: a.translate_pages - b.translate_pages,
});

function row(key: string, label: string, books: number, pages: number, pageKind: string, priceKey: string, note?: string): WorkRow {
  const price = PRICES[priceKey];
  return { key, label, note, books, pages, pageKind, price, costLow: pages * price.low, costHigh: pages * price.high };
}

/**
 * The remaining-work table, LIVE books only (what a reader can open). Pure over the snapshot.
 * OCR is split: the Chinese cohort is held out of the OCR sweep for the #5547 engine decision and
 * priced at the PaddleOCR-VL rate (EUR); everything else at the Gemini lite batch range. The
 * translation that OCR will make necessary is its own row, so the OCR row is not read as the whole bill.
 */
export function remainingWork(report: PipelineNextReport): { rows: WorkRow[]; held: HeldRow[] } {
  const live = (step: string) => report.steps.find((s) => s.step === step)?.live ?? zero();
  const field = (step: string) => (STEP_PAGE_FIELD as Record<string, keyof Work>)[step];

  const tr = live('translate');
  const body = report.step_reasons.find((r) => r.step === 'translate' && r.reason === 'body')?.live ?? zero();
  const tail = report.step_reasons.find((r) => r.step === 'translate' && r.reason === 'tail')?.live ?? zero();

  const ocr = live('ocr');
  const zh = (report.step_languages_live?.ocr ?? []).filter((l) => isChineseLanguage(l.language)).reduce((a, l) => add(a, l), zero());
  const ocrOther = sub(ocr, zh);

  const rows: WorkRow[] = [
    row('translate', 'Translate', tr.books, tr[field('translate')], 'pages to translate', 'translate',
      `body ${body.books.toLocaleString('en-US')} books · tail (readable → complete) ${tail.books.toLocaleString('en-US')} books`),
    row('enrich', 'Enrich', live('enrich').books, live('enrich')[field('enrich')], 'pages in the book', 'enrich'),
    row('images', 'Images', live('images').books, live('images')[field('images')], 'pages in the book', 'images',
      'overstated until the image collectors stamp images_done_at (#5477)'),
    row('archive', 'Archive', live('archive').books, live('archive')[field('archive')], 'pages to fetch', 'archive'),
    row('ocr', 'OCR (not Chinese)', ocrOther.books, ocrOther[field('ocr')], 'pages to OCR', 'ocr'),
    row('ocr_zh', 'OCR — Chinese', zh.books, zh.ocr_pages, 'pages to OCR', 'ocr_zh_paddle',
      'every live Chinese book at OCR; the cohort held out of the #4719 sweep for the #5547 engine decision is part of it. Priced at the PaddleOCR-VL pilot rate'),
    row('ocr_then_translate', 'Translate after OCR', ocr.books, ocr.translate_pages, 'pages to translate', 'translate',
      'the translation the OCR row makes necessary (non-English books)'),
  ];

  // Held books wait on a named decision or a specialist lane, so they are listed, not priced at a Gemini rate.
  const held: HeldRow[] = report.held.map((h) => ({
    reason: h.reason, issue: h.issue, books: h.all.books, live: h.live.books,
    ocr_pages: h.all.ocr_pages, translate_pages: h.all.translate_pages,
  }));

  return { rows, held };
}
