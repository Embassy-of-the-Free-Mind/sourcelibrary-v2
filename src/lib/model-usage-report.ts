/**
 * Model usage snapshot (/about/models, #5601): how many pages each engine's text is on today.
 *
 * PRIOR ART: src/lib/quality-report.ts — the same split (every figure in one `ops_reports`
 * document, the page renders it and computes nothing). It does not fit as-is: its document
 * and types are the quality dashboard's. This file keeps only the read and the types.
 *
 * Written by scripts/audit/model-usage-snapshot.mjs --apply (a checkpointed walk over pages;
 * never a request-path aggregate). Absent document → null, shown as "not yet counted".
 */
import { getReadDb } from '@/lib/mongodb';

export const MODEL_USAGE_REPORT_ID = 'model-usage';

export interface UsageRow {
  lane: 'ocr' | 'translation' | 'translation_es';
  model: string | null;
  source: string | null;
  pages: number;
  pages_with_text: number;
  pages_last_30d: number;
  books: number;
  languages: { language: string; books: number }[];
}

/** One entry on the page (engineFor() in src/data/public-models.ts): rows merged, books de-duplicated. */
export interface EngineRow {
  lane: 'ocr' | 'translation' | 'translation_es';
  id: string;
  pages: number;
  pages_last_30d: number;
  books: number;
  languages: { language: string; books: number }[];
}

export interface ImageRow { lane: 'images'; model: string | null; images: number; images_last_30d: number }
export interface SearchRow { table: string; rows_estimated: number | null; models_in_latest_200: string[]; error: string | null }

export interface ModelUsageReport {
  _id: string;
  generated_at: Date;
  generated_by: string;
  walk: { started_at: string; pages_seen: number; recent_since: string };
  engines: EngineRow[];
  rows: UsageRow[];
  images: ImageRow[];
  search: SearchRow[];
}

/** Throws on a database error (ISR then keeps the last good page); null only when never written. */
export async function getModelUsageReport(): Promise<ModelUsageReport | null> {
  const db = await getReadDb();
  return db
    .collection<ModelUsageReport>('ops_reports')
    .findOne({ _id: MODEL_USAGE_REPORT_ID }, { maxTimeMS: 10000 });
}
