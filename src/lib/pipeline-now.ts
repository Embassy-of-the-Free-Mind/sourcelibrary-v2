/**
 * PRIOR ART: src/lib/pipeline-next-report.ts — the work LEFT (backlog by step, from a daily audit), not what is
 * RUNNING. src/lib/work-board.ts — headless Claude jobs per box, not the cron lanes. Both are linked from the page.
 *
 * Pipeline now (#7759): the documents scripts/maintenance/pipeline-now-push.mjs writes to ops_reports, one per box
 * plus one for the corpus, and the Claude account meter main already pushes (claude-limits:latest). Read-only:
 * /admin/pipeline/now renders these and nothing else consumes them.
 */
import { getDb } from '@/lib/mongodb';

export const PIPELINE_NOW_TYPE = 'pipeline-now';
/** Every box that runs the pusher hourly, in the order shown. */
export const EXPECTED_BOXES = ['hetzner', 'gex45', 'cloudlayer', 'l7a'] as const;
/** A box section older than this is shown red: a dead pusher must not look like a quiet box. */
export const BOX_STALE_MIN = 150;
/** The corpus section runs nightly. */
export const CORPUS_STALE_MIN = 26 * 60;

export type Stage = 'qc' | 'research' | 'orchestrator' | 'embed' | 'translate' | 'ocr' | 'enrich' | 'import';
export const STAGE_ORDER: Stage[] = ['ocr', 'translate', 'enrich', 'embed', 'import', 'orchestrator', 'qc', 'research'];
export const STAGE_LABEL: Record<Stage, string> = {
  ocr: 'OCR', translate: 'Translation', enrich: 'Enrichment', embed: 'Embeddings', import: 'Import',
  orchestrator: 'Orchestrator', qc: 'Quality checks', research: 'First-translation search',
};

export interface CronLine {
  stage: Stage; schedule: string; one_shot: boolean; disabled: boolean; disabled_tag: string | null;
  script: string | null; mode: string | null; flags: string[]; env: string[];
  log: string | null; log_at: string | null; log_last: string | null; comment: string;
}
export interface AgyPool { pool: string; busy: boolean; weekly: number | null; weekly_reset: string | null; five_hour: number | null; five_hour_reset: string | null }
export interface LaneState {
  lane: string; stopped: boolean; state_at: string | null; written_total?: number | null; spot_at?: number | null;
  last_wave?: { id: string; pool: string; written: number | null; stopped: string | null; finished_at: string | null } | null;
}
export interface BoxDoc {
  _id: string; box: string; generated_at: string; lines: CronLine[]; lanes: LaneState[];
  gpu_queue: { pending: number; next: string[]; held: number; lock: string | null } | null;
  agy_pools: AgyPool[] | null;
}
export interface DayRow { day: string; lane: string; model: string; pages: number }
export interface CorpusDoc {
  _id: string; generated_at: string; since: string;
  dial: { paused: boolean | null; daily_budget_usd: number | null } | null;
  quality_gates: { id: string; step: string | null; verdict: string | null; window: string | null; books: number | null; at: string | null }[];
  translated_per_day: DayRow[] | null; ocr_per_day: DayRow[] | null; errors: string[];
}
export interface ClaudeAccount { email: string; ok: boolean; limits?: { key: string; label: string; percent: number | null; resets_at: string | null }[] }

export interface PipelineNow {
  boxes: { box: string; doc: BoxDoc | null }[];
  corpus: CorpusDoc | null;
  claude: { checked_at: string | null; accounts: ClaudeAccount[] } | null;
}

export async function getPipelineNow(): Promise<PipelineNow> {
  const db = await getDb();
  const reports = db.collection('ops_reports');
  const [docs, claude] = await Promise.all([
    reports.find({ type: PIPELINE_NOW_TYPE }).toArray(),
    reports.findOne({ _id: 'claude-limits:latest' as never }),
  ]);
  const byId = new Map(docs.map(d => [String(d._id), d]));
  const expected: readonly string[] = EXPECTED_BOXES;
  const extra = docs.map(d => String(d.box)).filter(b => b !== 'corpus' && !expected.includes(b));
  return {
    boxes: [...expected, ...extra].map(box => ({ box, doc: (byId.get(`${PIPELINE_NOW_TYPE}:${box}`) ?? null) as unknown as BoxDoc | null })),
    corpus: (byId.get(`${PIPELINE_NOW_TYPE}:corpus`) ?? null) as unknown as CorpusDoc | null,
    claude: claude ? { checked_at: (claude.checked_at as string) ?? null, accounts: (claude.accounts as ClaudeAccount[]) ?? [] } : null,
  };
}

// ───────────────────────────────────────────── pure helpers

export function ageMin(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((now.getTime() - t) / 60_000) : null;
}

export function agoText(iso: string | null | undefined, now: Date): string {
  const m = ageMin(iso, now);
  if (m === null) return '–';
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

/** "in 3 h" for a future time, '–' when absent or past. */
export function untilText(iso: string | null | undefined, now: Date): string {
  const m = ageMin(iso, now);
  if (m === null || m > 0) return '–';
  const ahead = -m;
  if (ahead < 60) return `in ${ahead} min`;
  if (ahead < 48 * 60) return `in ${Math.round(ahead / 60)} h`;
  return `in ${Math.round(ahead / 1440)} d`;
}

/** Lines grouped by stage in STAGE_ORDER, each group's live lines before disabled and one-shot ones. */
export function linesByStage(lines: CronLine[]): { stage: Stage; lines: CronLine[] }[] {
  return STAGE_ORDER.map(stage => ({
    stage,
    lines: lines.filter(l => l.stage === stage).sort((a, b) => Number(a.disabled || a.one_shot) - Number(b.disabled || b.one_shot)),
  })).filter(g => g.lines.length);
}

/** Pages per lane × model over the window: total and one count per UTC day (oldest first; the last day is partial). */
export function laneTable(rows: DayRow[] | null): { days: string[]; lanes: { lane: string; model: string; total: number; perDay: number[] }[] } {
  if (!rows?.length) return { days: [], lanes: [] };
  const days = [...new Set(rows.map(r => r.day))].sort();
  const map = new Map<string, { lane: string; model: string; total: number; perDay: number[] }>();
  for (const r of rows) {
    const k = `${r.lane}\u0000${r.model}`;
    let e = map.get(k);
    if (!e) { e = { lane: r.lane, model: r.model, total: 0, perDay: days.map(() => 0) }; map.set(k, e); }
    e.total += r.pages;
    e.perDay[days.indexOf(r.day)] += r.pages;
  }
  return { days, lanes: [...map.values()].sort((a, b) => b.total - a.total) };
}

/** The weekly-all-models percent used for a Claude account, or null. */
export function weeklyPct(a: ClaudeAccount): { pct: number | null; resets_at: string | null } {
  const w = a.limits?.find(l => l.key === 'weekly_all:all');
  return { pct: w?.percent ?? null, resets_at: w?.resets_at ?? null };
}
