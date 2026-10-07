/**
 * Quality report (/admin/quality, #5474): is the text we serve good, and is it getting better?
 *
 * PRIOR ART: src/lib/spend-report.ts — the same split (renderer in this repo, every figure in one
 * `ops_reports` document, refresh without a deploy). It does not fit as-is: spend is gated by a
 * named allow-list and redacts people; quality figures are admin-wide and need neither, so this
 * file keeps only the document read and the types.
 *
 * The document is written by scripts/eval/quality-dashboard/build.mjs --push, which copies what the
 * instruments wrote (corpus audits, OCR evidence, the speed-test gate ledger, quality round 1,
 * reader reports). The page renders it and computes nothing. A section whose instrument has not run
 * arrives as null / 'not_run' and is shown as "no measurement", never as zero.
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

export interface QualityData {
  generated: string;
  sampling: string;
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
  lanes: {
    windows: {
      window: string; judged_at: string; verdict: string; reasons: string[];
      n: number; defective: number; major_pct: number | null; ci: Interval;
      seeded: { n: number; major: number } | null; seam: { n: number; major: number } | null;
      by_class: Record<string, number>; controls: Record<string, string> | null;
      warn_count: number; trend_warn: boolean; by_eye: string[];
    }[];
    baseline: { label: string; run: string; drawn_at: string; n: number; any_major: Rate; source: string } | null;
    trend_rule: { bound_pct: number; floor_pp: number } | null;
    ledger: string;
    issue: string;
    missing?: boolean;
  };
  round1: {
    status: 'not_run' | 'done';
    issue: string;
    preregistration: string;
    drawn: string | null;
    result?: string;
    date?: string | null;
    rows: {
      stratum: string; n: number | null; cost_per_book_usd: number | null; days: number | null;
      ocr_score: number | null; translation_major_pct: number | null; verdict: string | null;
    }[];
  };
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
