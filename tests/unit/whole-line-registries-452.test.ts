/**
 * The whole line's rows are written by hand (src/lib/pipeline-line.ts LINE_STAGES); the steps the pipeline actually
 * has live in three registries. This ties them (v3#452 item 3): every lane step (scripts/lib/lanes.mjs LANE_STEPS),
 * every stage a box reports a cron line under (scripts/maintenance/pipeline-now-push.mjs STAGE_RULES) and every
 * orchestrator status that claims a phase's output (scripts/workers/pipeline-orchestrator.mjs STATUS_OUTPUT_CLAIMS)
 * maps to a row, or to an exemption below with its reason. A step added to any of them fails here until it has one.
 *
 * The mappings are checked against the code, not only listed: a lane step must be the `next.step` of its row, a
 * cron stage's sample line must land on its row by the page's own first-match rule, and the sample must be classified
 * into that stage by the pusher's own stageOf().
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LINE_STAGES } from '@/lib/pipeline-line';
import type { CronLine } from '@/lib/pipeline-now';
import { LANE_STEPS } from '../../scripts/lib/lanes.mjs';
import { STAGE_RULES, OTHER_STAGE, stageOf } from '../../scripts/maintenance/pipeline-now-push.mjs';

const ROWS = new Set(LINE_STAGES.map(s => s.key));

// ── lanes.mjs LANE_STEPS: the next-step names the lanes take work by.
const LANE_EXEMPT: Record<string, string> = {
  any: 'a lane that takes a book at whatever step it is on; it names no step of its own.',
};

// ── pipeline-now-push.mjs STAGE_RULES: the stage each box files a cron line under. A sample command per stage,
// which the pusher must classify into that stage and the page must hand to the row named.
const CRON_STAGE_ROW: Record<string, { row: string; cmd: string }> = {
  qc: { row: 'qa', cmd: 'node scripts/eval/paired-fifths-daily.mjs' },
  embed: { row: 'embed', cmd: 'node scripts/workers/embed-worker.mjs' },
  research: { row: 'ft', cmd: 'node scripts/batch/ft-search-lane.mjs' },
  translate: { row: 'translate', cmd: 'node scripts/batch/cli-translate-lane.mjs' },
  ocr: { row: 'ocr', cmd: 'node scripts/batch/cli-ocr-lane.mjs' },
  enrich: { row: 'enrich', cmd: 'node scripts/workers/enrich-worker.mjs' },
  import: { row: 'import', cmd: 'node scripts/import/acquire-wave.mjs' },
};
const CRON_STAGE_EXEMPT: Record<string, string> = {
  orchestrator: 'the orchestrator and the scheduler run many rows (dupes, split, catalogue, cover, publish); each row names its phase in `inside` and its run log in `runNames`, and the finalize line is matched to Cover by flag.',
  [OTHER_STAGE]: 'a line whose script matches no rule; the page lists every such line under "Other scheduled lines", never as a stage.',
};

// ── pipeline-orchestrator.mjs STATUS_OUTPUT_CLAIMS: the statuses that claim a phase produced output. The orchestrator
// cannot be imported (it starts a worker beacon), so its keys are read from the source.
const CLAIM_ROW: Record<string, string> = {
  archive_complete: 'archive',
  ocr_complete: 'ocr',
  summary_indexed: 'enrich',
  chapters_complete: 'enrich',
  cover_selected: 'cover',
};
const CLAIM_EXEMPT: Record<string, string> = {};

function claimKeys(src: string): string[] {
  const m = src.match(/const STATUS_OUTPUT_CLAIMS = \{\n([\s\S]*?)\n\};/);
  if (!m) throw new Error('STATUS_OUTPUT_CLAIMS not found in pipeline-orchestrator.mjs: the test cannot read it, so it cannot pass');
  return [...m[1].matchAll(/^\s+(\w+):/gm)].map(x => x[1]);
}
const ORCH = fs.readFileSync(path.join(__dirname, '../../scripts/workers/pipeline-orchestrator.mjs'), 'utf8');

const cronLine = (stage: string, cmd: string): CronLine => ({
  stage: stage as CronLine['stage'], script: cmd.split(' ').pop()!, schedule: '0 * * * *', one_shot: false, disabled: false,
  disabled_tag: null, mode: null, flags: [], env: [], log: null, log_at: null, log_last: null, comment: '',
});
/** The row a cron line lands on: the first whose `lines` accepts it, the rule buildLine() uses. */
const rowOf = (l: CronLine) => LINE_STAGES.find(s => s.lines?.((l.script ?? '').split('/').pop() ?? '', l))?.key ?? null;

/** Every name in `names` is mapped or exempt (never both), and every mapping names a real row. */
function unmapped(names: readonly string[], map: Record<string, unknown>, exempt: Record<string, string>) {
  return names.filter(n => !(n in map) && !(n in exempt));
}

describe('the whole line has a row for every step the registries name (v3#452)', () => {
  it('every lane step is the next step of a row, or exempt', () => {
    expect(unmapped(LANE_STEPS, {}, { ...LANE_EXEMPT, ...Object.fromEntries(LINE_STAGES.filter(s => s.next).map(s => [s.next!.step, s.key])) }),
      'lanes.mjs LANE_STEPS without a LINE_STAGES row (give a row next.step, or add it to LANE_EXEMPT with a reason)').toEqual([]);
  });

  it('every cron stage the pusher files lines under lands on a row, or is exempt', () => {
    const stages = [...STAGE_RULES.map(([s]: [string]) => s), OTHER_STAGE];
    expect(unmapped(stages, CRON_STAGE_ROW, CRON_STAGE_EXEMPT),
      'pipeline-now-push.mjs STAGE_RULES stages without a LINE_STAGES row (add to CRON_STAGE_ROW with a sample command, or CRON_STAGE_EXEMPT with a reason)').toEqual([]);
    for (const [stage, { row, cmd }] of Object.entries(CRON_STAGE_ROW)) {
      expect(ROWS.has(row), `${stage} → ${row}: no such row`).toBe(true);
      expect(stageOf(cmd), `the pusher files "${cmd}" under ${stage}`).toBe(stage);
      expect(rowOf(cronLine(stage, cmd)), `a ${stage} line (${cmd}) lands on ${row}`).toBe(row);
    }
  });

  it('every orchestrator output claim maps to a row, or is exempt', () => {
    const keys = claimKeys(ORCH);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    expect(unmapped(keys, CLAIM_ROW, CLAIM_EXEMPT),
      'pipeline-orchestrator.mjs STATUS_OUTPUT_CLAIMS without a LINE_STAGES row (add to CLAIM_ROW, or CLAIM_EXEMPT with a reason)').toEqual([]);
    for (const [k, row] of Object.entries(CLAIM_ROW)) expect(ROWS.has(row), `${k} → ${row}: no such row`).toBe(true);
  });

  it('no name is both mapped and exempt, and no mapping is left over from a removed step', () => {
    const steps = new Set<string>(LANE_STEPS);
    const stages = new Set<string>([...STAGE_RULES.map(([s]: [string]) => s), OTHER_STAGE]);
    const claims = new Set(claimKeys(ORCH));
    expect(Object.keys(LANE_EXEMPT).filter(k => !steps.has(k))).toEqual([]);
    expect([...Object.keys(CRON_STAGE_ROW), ...Object.keys(CRON_STAGE_EXEMPT)].filter(k => !stages.has(k))).toEqual([]);
    expect([...Object.keys(CLAIM_ROW), ...Object.keys(CLAIM_EXEMPT)].filter(k => !claims.has(k))).toEqual([]);
    expect(Object.keys(CRON_STAGE_ROW).filter(k => k in CRON_STAGE_EXEMPT)).toEqual([]);
    expect(Object.keys(CLAIM_ROW).filter(k => k in CLAIM_EXEMPT)).toEqual([]);
  });
});
