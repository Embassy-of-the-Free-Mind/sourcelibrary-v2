/**
 * The daily spend check line on /admin/work (#5743): "spend check: PASS/FAIL — …", with the four checks'
 * lines behind a disclosure. Written once a day by scripts/audit/spend-daily.mjs as an ops_reports
 * document of type `spend_daily`.
 *
 * PRIOR ART: src/lib/work-board.ts — reads the `work-board` documents for the same page. Kept apart:
 * a daily document among the 10-minute pushers would read as a stale box after 30 minutes.
 */
import { getDb } from '@/lib/mongodb';

export const SPEND_CHECK_TYPE = 'spend_daily';
/** The check runs at 07:00Z; older than this and the line says the check itself has stopped. */
export const SPEND_STALE_H = 26;

export type SpendStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
interface Check { status: SpendStatus; lines: string[] }
export interface SpendDoc {
  _id: string; day: string; generated_at: Date | string; status: SpendStatus; line: string;
  checks: { ledger: Check; machines: Check; envelopes: Check; dial: Check };
}

export interface SpendLine {
  status: SpendStatus | 'STALE' | 'MISSING';
  line: string;
  day: string | null;
  sections: { title: string; status: SpendStatus; lines: string[] }[];
}

const TITLES: Record<keyof SpendDoc['checks'], string> = {
  ledger: 'Ledger (paid vs got)', machines: 'Machines', envelopes: 'Envelopes', dial: 'Dial vs invoice',
};

/** Pure: the latest document and the clock → what the page shows. A missing or old check is said, in red. */
export function spendLine(doc: SpendDoc | null, now: Date = new Date()): SpendLine {
  if (!doc) return { status: 'MISSING', line: 'spend check: NO DATA — scripts/audit/spend-daily.mjs has never written a row', day: null, sections: [] };
  const ageH = (now.getTime() - new Date(doc.generated_at).getTime()) / 3600_000;
  const sections = (Object.keys(TITLES) as (keyof SpendDoc['checks'])[])
    .filter(k => doc.checks?.[k])
    .map(k => ({ title: TITLES[k], status: doc.checks[k].status, lines: doc.checks[k].lines ?? [] }));
  if (!(ageH <= SPEND_STALE_H)) {
    return { status: 'STALE', line: `spend check: STALE — last run ${Math.round(ageH)} h ago (${doc.day}); the 07:00Z cron has stopped`, day: doc.day, sections };
  }
  return { status: doc.status, line: doc.line, day: doc.day, sections };
}

export async function getSpendLine(now: Date = new Date()): Promise<SpendLine> {
  const db = await getDb();
  const [doc] = await db.collection('ops_reports').find({ type: SPEND_CHECK_TYPE }).sort({ day: -1 }).limit(1).toArray();
  return spendLine((doc as unknown as SpendDoc) ?? null, now);
}
