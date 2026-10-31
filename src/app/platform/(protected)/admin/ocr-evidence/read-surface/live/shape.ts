/**
 * The data contract of ops_reports `read-surface-6740:live`, asserted on READ (#6740).
 *
 * The experiment job writes the doc (scripts/eval/read-surface-6740/publish-live.mjs, which checks the same fields
 * before writing); this page is the other side. A doc that does not match renders a "data shape changed" box naming
 * the fields, never an empty chart: an empty surface reads as "no runs yet", which is the wrong story.
 */

export const LIVE_REPORT_ID = 'read-surface-6740:live';
export const STATUSES = ['planned', 'running', 'done', 'aborted'] as const;
export const THINKING = ['low', 'medium', 'high'] as const;
export type Status = (typeof STATUSES)[number];
export type Thinking = (typeof THINKING)[number];

export interface LiveSetting {
  id: string; lang?: string; stage: string; pages_a_call: number; long_edge: number | null; thinking: Thinking;
  prompt_line: string; status: Status; live?: boolean;
}
export interface LiveRow {
  run_id: string; setting_id: string; lang: string; book_id: string; century: number | null; face: string | null;
  pool: string; cer: number | null; quota_cost: number; calls: number; wall_s: number; accepted?: boolean;
  wrong_text: boolean; loop: boolean; cut: boolean; excluded: boolean; long_edge_px?: number; completed_at?: string | null;
}
export interface LiveDoc {
  updated_at: string;
  design: { factors: { key: string; levels: (number | string)[] }[]; settings: LiveSetting[] };
  rows: LiveRow[];
  weights: Record<string, Record<string, number>>;
  budget: { calls_used: number; calls_max: number; pool_weekly: Record<string, number> | null };
}

export type ShapeResult = { ok: true; doc: LiveDoc } | { ok: false; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Check every field the page reads; collect at most 12 problems so the box stays readable. */
export function assertLiveDoc(x: unknown): ShapeResult {
  const p: string[] = [];
  const add = (s: string) => { if (p.length < 12) p.push(s); };
  if (!isObj(x)) return { ok: false, problems: ['the doc is missing or not an object'] };
  if (typeof x.updated_at !== 'string' || Number.isNaN(Date.parse(x.updated_at))) add('updated_at: not an ISO time');
  const design = x.design;
  if (!isObj(design)) add('design: missing');
  else {
    if (!Array.isArray(design.factors)) add('design.factors: not an array');
    if (!Array.isArray(design.settings) || design.settings.length === 0) add('design.settings: missing or empty');
    else design.settings.forEach((s: unknown, i: number) => {
      if (!isObj(s)) return add(`design.settings[${i}]: not an object`);
      if (typeof s.id !== 'string') add(`design.settings[${i}].id: not a string`);
      if (!num(s.pages_a_call)) add(`design.settings[${i}].pages_a_call: not a number`);
      if (s.long_edge !== null && !num(s.long_edge)) add(`design.settings[${i}].long_edge: not a number or null`);
      if (!THINKING.includes(s.thinking as Thinking)) add(`design.settings[${i}].thinking: "${String(s.thinking)}" is not low/medium/high`);
      if (typeof s.prompt_line !== 'string') add(`design.settings[${i}].prompt_line: not a string`);
      if (!STATUSES.includes(s.status as Status)) add(`design.settings[${i}].status: "${String(s.status)}" is not ${STATUSES.join('/')}`);
    });
  }
  if (!Array.isArray(x.rows)) add('rows: not an array');
  else {
    // Row problems grouped by field: a renamed field fails on every row, and the box should say so once.
    const byField = new Map<string, { first: number; n: number }>();
    const bad = (i: number, msg: string) => { const c = byField.get(msg); if (c) c.n++; else byField.set(msg, { first: i, n: 1 }); };
    x.rows.forEach((r: unknown, i: number) => {
      if (!isObj(r)) return bad(i, 'not an object');
      for (const k of ['run_id', 'setting_id', 'lang', 'book_id', 'pool']) if (typeof r[k] !== 'string') bad(i, `${k}: not a string`);
      for (const k of ['quota_cost', 'calls', 'wall_s']) if (!num(r[k])) bad(i, `${k}: not a number`);
      if (r.cer !== null && !num(r.cer)) bad(i, 'cer: not a number or null');
      for (const k of ['wrong_text', 'loop', 'cut', 'excluded']) if (typeof r[k] !== 'boolean') bad(i, `${k}: not true/false`);
      if (r.long_edge_px !== undefined && !num(r.long_edge_px)) bad(i, 'long_edge_px: not a number');
    });
    for (const [msg, c] of byField) add(`rows[${c.first}]${msg.startsWith('not an') ? ': ' : '.'}${msg}${c.n > 1 ? ` (and ${c.n - 1} more rows)` : ''}`);
  }
  if (!isObj(x.weights)) add('weights: not an object');
  const b = x.budget;
  if (!isObj(b) || !num(b.calls_used) || !num(b.calls_max)) add('budget: calls_used / calls_max missing');
  return p.length ? { ok: false, problems: p } : { ok: true, doc: x as unknown as LiveDoc };
}
