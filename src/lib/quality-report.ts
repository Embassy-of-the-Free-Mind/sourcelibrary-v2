/**
 * Quality report (/admin/quality, #5474): is the text we serve good, and is it getting better?
 *
 * PRIOR ART: src/lib/spend-report.ts — the same split (renderer in this repo, every figure in one
 * `ops_reports` document, refresh without a deploy). It does not fit as-is: spend is gated by a
 * named allow-list and redacts people; quality figures are admin-wide and need neither, so this
 * file keeps only the document read and the types.
 *
 * The document is written by scripts/eval/quality-dashboard/build.mjs --push, which copies what the
 * instruments wrote (corpus audits, OCR evidence, reader reports) and the four trend lines (#6429).
 * The page renders it and computes nothing. A section whose instrument has not run arrives as null
 * and is shown as "no measurement", never as zero.
 */
import { getDb } from '@/lib/mongodb';

export const OPS_REPORTS_COLLECTION = 'ops_reports';
export const QUALITY_REPORT_ID = 'quality-dashboard';

export type Interval = [number, number] | null;
export interface Rate { est: number; ci: Interval; ci_kind: string }
export interface GroupCell { n: number; weighting: string; ge4: Rate; any_major: Rate }

export interface AuditRun {
  id: string;
  population: 'served' | 'chained';
  label: string;
  drawn_at: string;
  n: number;
  n_books: number;
  judge: string;
  second_judge: string | null;
  controls_pass: boolean;
  source: string;
  report: string;
  groups: Record<string, GroupCell | null>;
  flags: { flag: string; est: number | null; ci: Interval; count: number | null }[];
  defect_types: { type: string; severity: string; count: number }[];
}

export interface AuditPick {
  run: string; label: string; drawn_at: string; n: number; judge: string; source: string;
  ge4: Rate; any_major: Rate; weighting: string;
}

/** One trend chart (#6429). Every label, statement and tooltip is written by build.mjs (trends.mjs). */
export interface TrendChart {
  id: string;
  title: string;
  unit: 'pct' | 'usd' | 'count';
  y_label: string;
  lower_is_better: boolean;
  /** Date of the newest point (YYYY-MM-DD); null = no measurement. */
  newest: string | null;
  statement: string | null;
  /** Set when the newest point is older than the series' cadence allows. */
  stale: string | null;
  key_type?: string;
  key_note?: string;
  panel_note?: string;
  extra_legend?: { style: 'dots'; label: string }[];
  ref?: { value: number; label: string };
  series: {
    key: string; label: string; slot: 1 | 2 | 3; style: 'line' | 'dots'; cadence_days: number; legend?: boolean;
    points: { date: string; value: number; tip: string }[];
  }[];
  source: string;
}

export interface QualityData {
  generated: string;
  sampling: string;
  /** Absent on documents written before #6429; null when the history store was not read. */
  trends?: TrendChart[] | null;
  translation: {
    runs: AuditRun[];
    latest: AuditPick | null;
    previous: AuditPick | null;
    /** Monthly draws pushed to a branch but not yet judged onto main. */
    pending: { month: string; branch: string }[];
    group_labels: Record<string, string>;
    instrument: string;
    instrument_source: string;
  };
  ocr: {
    production_engine: string;
    measure: string;
    latest_file_date: string | null;
    n_files: number;
    thresholds: { directional_n: number; decision_n: number };
    rows: { script: string; n_run: number; n: number; median_cer: number | null; ci: Interval; grade: string }[];
    page: string;
    source: string;
  } | null;
  other_instruments: {
    label: string; value: number; value_kind: string; n: number; n_note?: string;
    chance: number | null; date: string; source: string;
  }[];
  defects: {
    run: string; drawn_at: string; n: number; source: string; taxonomy: string;
    rows: {
      flag: string; label: string; est: number | null; ci: Interval; count: number | null;
      classes: { code: string; title: string | null; issue: number | null; issue_state: string | null; url: string | null }[];
    }[];
    defect_types: { type: string; severity: string; count: number }[];
  } | null;
  reader: {
    window_days: number; from: string; to: string;
    page_reports: {
      total: number;
      by_kind: { kind: string; count: number }[];
      top_books: { book_id: string; title: string | null; count: number; url: string }[];
      instrument: string;
      instrument_since: string;
    };
    feedback_total: number;
    poorly_read: number | null;
    poorly_read_note: string;
  } | null;
}

export interface QualityReportDoc {
  _id: string;
  schema_version: number;
  generated_at: Date | string;
  generated_by: string;
  data: QualityData;
}

export async function getQualityReport(): Promise<QualityReportDoc | null> {
  const db = await getDb();
  const doc = await db
    .collection<QualityReportDoc>(OPS_REPORTS_COLLECTION)
    .findOne({ _id: QUALITY_REPORT_ID } as Record<string, unknown>);
  if (!doc || !doc.data) return null;
  return doc;
}
