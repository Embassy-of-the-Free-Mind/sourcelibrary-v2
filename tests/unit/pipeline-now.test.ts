/**
 * /admin/pipeline/now (#7759): how a live crontab line becomes a lane row. Fixtures are real lines from the boxes'
 * crontabs on 2026-10-29 (main and gex45), clipped where the tail did not matter.
 */
import { describe, it, expect } from 'vitest';
import {
  flagsOf, gateTime, isOneShot, logPathOf, modeOf, parseCrontab, pipelineLines, scriptsOf, stageOf, trailingComment,
} from '../../scripts/maintenance/pipeline-now-push.mjs';
import { laneTable, linesByStage, untilText, type CronLine } from '@/lib/pipeline-now';

const CHAINED = `*/5 * * * * cd /root/sourcelibrary && [ -f scripts/lib/translate-batch-chained.mjs ] && flock -n /tmp/sl-translate-chained.lock bash -c "set -a; source .env.production.local; set +a; node scripts/workers/translate-batch-worker.mjs --chained --tick" >> /var/log/sourcelibrary/translate-chained.log 2>&1`;
const SIKU = `*/15 * * * * export PATH=/usr/local/bin:/root/.local/bin:/usr/bin:/bin; f=/root/sourcelibrary/scripts/batch/siku-translate-lane.mjs; [ -f $f ] && cd /root/sourcelibrary && flock -n /tmp/siku-lane.lock timeout 4h node --no-warnings --env-file=.env.production.local $f run --apply --max-minutes=180 --parallel=6 >> /var/log/sourcelibrary/siku-lane.log 2>&1`;
const OFF = `#OCRFIRST-7701 50 * * * * export PATH=/usr/local/bin:/usr/bin:/bin; f=/root/sourcelibrary/scripts/batch/cli-ocr-lane.mjs; [ -f $f ] && cd /root/sourcelibrary && flock -n /tmp/cli-ocr-correct.lock timeout 110m node --no-warnings --env-file=.env.production.local $f correct --out=/root/jobs/cli-ocr-correct/$(date +\\%F) --max-pages=3000 --concurrency=6 >> /var/log/sourcelibrary/cli-ocr-correct.log 2>&1`;
const READER = `5 1-23/2 * * * export PATH=/usr/local/bin:/usr/bin:/bin AGY_HOME=/root/.agy-james; f=/root/sourcelibrary/scripts/batch/reader-request-lane.mjs; [ -f $f ] && cd /root/sourcelibrary && node --env-file=.env.production.local $f run --max-pages=200 --apply >> /var/log/sourcelibrary/reader-request-lane.log 2>&1`;
const KRAKEN = `*/30 * * * * bash /root/sourcelibrary/scripts/workers/syriac-kraken-relaunch.sh >> /root/syriac-kraken/relaunch.log 2>&1 # syriac-kraken-4883 (remove when the lane is done)`;
const SPARE = `*/30 * * * * f=/root/sourcelibrary/scripts/workers/spare-lane.py; [ -f $f ] && /usr/bin/python3 $f >> /var/log/sourcelibrary/spare-lane.log 2>&1  # #6395`;
const GPU = `*/5 * * * * /root/bin/gpu-queue.sh >> /var/log/sourcelibrary/gpu-queue.log 2>&1`;

describe('scriptsOf / stageOf', () => {
  it('puts the executed script before one that only appears in an existence guard', () => {
    expect(scriptsOf(CHAINED)[0]).toBe('scripts/workers/translate-batch-worker.mjs');
    expect(stageOf(CHAINED)).toBe('translate');
  });
  it('resolves $f lanes and /root/bin scripts', () => {
    expect(scriptsOf(SIKU)).toEqual(['scripts/batch/siku-translate-lane.mjs']);
    expect(scriptsOf(GPU)).toEqual(['/root/bin/gpu-queue.sh']);
    expect(stageOf(GPU)).toBe('ocr');
    expect(stageOf(KRAKEN)).toBe('ocr');
  });
  it('leaves non-pipeline jobs out', () => {
    expect(stageOf(SPARE)).toBeNull();
  });
  it('reads a QC script that names translation as QC, and FT search as research', () => {
    expect(stageOf('30 7 * * * node scripts/maintenance/mark-stale-translations.mjs --apply')).toBe('qc');
    expect(stageOf('30 1 * * * sh scripts/ft-search/nightly.sh')).toBe('research');
  });
});

describe('flagsOf / modeOf / logPathOf / trailingComment', () => {
  it('keeps flags, joins space-separated values, drops node plumbing', () => {
    expect(flagsOf(SIKU).flags).toEqual(['--apply', '--max-minutes=180', '--parallel=6']);
    expect(flagsOf('node x.mjs --phase 9 --batch 400 --state /root/a.json').flags).toEqual(['--phase=9', '--batch=400', '--state']);
  });
  it('shows an allowlisted env name with its value, never other env', () => {
    expect(flagsOf(READER).env).toEqual(['AGY_HOME=/root/.agy-james']);
    expect(flagsOf('GEMINI_API_KEY=abc node x.mjs').env).toEqual([]);
  });
  it('reads the lane subcommand', () => {
    expect(modeOf(SIKU, 'scripts/batch/siku-translate-lane.mjs')).toBe('run');
    expect(modeOf(OFF, 'scripts/batch/cli-ocr-lane.mjs')).toBe('correct');
    expect(modeOf(CHAINED, 'scripts/workers/translate-batch-worker.mjs')).toBeNull();
  });
  it('finds the log and the trailing comment, not a # inside quotes', () => {
    expect(logPathOf(SIKU)).toBe('/var/log/sourcelibrary/siku-lane.log');
    expect(trailingComment(KRAKEN)).toBe('syriac-kraken-4883 (remove when the lane is done)');
    expect(trailingComment(`node x.mjs --title "a # b" >> /l 2>&1`)).toBe('');
  });
});

describe('parseCrontab / pipelineLines', () => {
  const text = [
    'MAILTO=""', '# Siku lane, see #5600', SIKU, OFF, SPARE,
    `5 22 30 10 * crontab -l | sed -e 's/--max-calls-day=2500/--max-calls-day=600/' | crontab - # enrich-agy SPEND-OUT restore`,
  ].join('\n');
  it('keeps commented-out job lines as disabled with their tag, skips prose comments and env lines', () => {
    const rows = parseCrontab(text);
    expect(rows.map(r => [r.schedule, r.disabled, r.tag])).toEqual([
      ['*/15 * * * *', false, null], ['50 * * * *', true, 'OCRFIRST-7701'], ['*/30 * * * *', false, null], ['5 22 30 10 *', false, null],
    ]);
  });
  it('rows only pipeline stages, in stage order; a dated sed on a lane is kept as a one-shot', () => {
    const rows = pipelineLines(text);
    expect(rows.map(r => [r.stage, r.script, r.disabled, r.one_shot])).toEqual([
      ['translate', 'scripts/batch/siku-translate-lane.mjs', false, false],
      ['ocr', 'scripts/batch/cli-ocr-lane.mjs', true, false],
      ['enrich', null, false, true],
    ]);
  });
  it('flags a dated line as one-shot', () => {
    expect(isOneShot('5 22 30 10 *')).toBe(true);
    expect(isOneShot('30 4 1 * *')).toBe(false);
  });
});

describe('gateTime', () => {
  it('reads the time out of a gate id', () => {
    expect(gateTime('qg_translate_202610101657_1rqt')).toBe('2026-10-10T16:57:00.000Z');
    expect(gateTime('x')).toBeNull();
  });
});

describe('page helpers', () => {
  it('laneTable sums per lane × model and orders days', () => {
    const t = laneTable([
      { day: '2026-10-29', lane: 'agy-flash-translate', model: 'gemini-3.8-flash-low', pages: 30 },
      { day: '2026-10-28', lane: 'agy-flash-translate', model: 'gemini-3.8-flash-low', pages: 10 },
      { day: '2026-10-29', lane: 'ai', model: 'claude-opus-5-5', pages: 5 },
    ]);
    expect(t.days).toEqual(['2026-10-28', '2026-10-29']);
    expect(t.lanes[0]).toEqual({ lane: 'agy-flash-translate', model: 'gemini-3.8-flash-low', total: 40, perDay: [10, 30] });
    expect(t.lanes[1].perDay).toEqual([0, 5]);
  });
  it('linesByStage puts live lines before disabled ones', () => {
    const l = (stage: CronLine['stage'], disabled: boolean) => ({ stage, disabled, one_shot: false } as CronLine);
    const g = linesByStage([l('ocr', true), l('qc', false), l('ocr', false)]);
    expect(g.map(x => x.stage)).toEqual(['ocr', 'qc']);
    expect(g[0].lines.map(x => x.disabled)).toEqual([false, true]);
  });
  it('untilText', () => {
    const now = new Date('2026-10-29T22:00:00Z');
    expect(untilText('2026-10-30T22:00:00Z', now)).toBe('in 24 h');
    expect(untilText('2026-10-29T21:00:00Z', now)).toBe('–');
  });
});
