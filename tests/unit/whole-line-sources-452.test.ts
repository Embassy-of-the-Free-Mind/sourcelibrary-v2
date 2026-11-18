/**
 * The whole line's sources in the morning brief (v3#452): a stopped, missing or unreadable source is one "broke"
 * line owned by v3#452, a broken nightly probe is one line naming its stages, and a source that recovers is gone
 * from the next brief (the check is pure and judged afresh each run; nothing is remembered between runs).
 */
import { describe, it, expect } from 'vitest';
import { LINE_OWNER, LINE_SOURCES, briefOf, lineSourceItems, summarize } from '../../scripts/maintenance/situation.mjs';

const NOW = Date.parse('2026-11-17T07:20:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const H = 60;

const fresh = () => ({
  snapshot: { timestamp: new Date(NOW - 3 * H * 60_000), stages: [{ stage: 'ocr', status: 'ok' }, { stage: 'translated', status: 'ok' }] },
  nextDaily: { generated_at: new Date(NOW - 35 * 60_000) },
  corpus: { generated_at: ago(4.5 * H) },
  imageProv: { at: ago(9 * H) },
});

describe('lineSourceItems (v3#452)', () => {
  it('says nothing when every source is fresh', () => {
    expect(lineSourceItems(fresh(), NOW)).toEqual([]);
  });

  it('one line per stale source, each owned by v3#452, at the bound for that source', () => {
    const d = fresh();
    d.snapshot.timestamp = new Date(NOW - 27 * H * 60_000);
    d.corpus.generated_at = ago(30 * H);
    d.imageProv.at = ago(9 * 24 * H);
    const items = lineSourceItems(d, NOW);
    expect(items.map(i => i.what)).toEqual([
      'whole line: nightly stage snapshot (stage_coverage_snapshots) stopped, last written 27h ago (allowed 26h)',
      'whole line: corpus report (pipeline-now:corpus) stopped, last written 30h ago (allowed 26h)',
      'whole line: weekly image audit (image-provenance-coverage) stopped, last written 9d ago (allowed 8d)',
    ]);
    expect(items.every(i => i.owner === LINE_OWNER)).toBe(true);
  });

  it('a source just inside its bound is not stale', () => {
    const d = fresh();
    d.nextDaily.generated_at = new Date(NOW - (26 * H - 1) * 60_000);
    d.imageProv.at = ago(8 * 24 * H - 1);
    expect(lineSourceItems(d, NOW)).toEqual([]);
  });

  it('a missing document is a line, not silence', () => {
    const d = { ...fresh(), nextDaily: null, imageProv: { at: null } };
    expect(lineSourceItems(d, NOW).map(i => i.what)).toEqual([
      'whole line: daily next-step report (pipeline_next_daily) missing, so /admin/pipeline shows no figure from it',
      'whole line: weekly image audit (image-provenance-coverage) missing, so /admin/pipeline shows no figure from it',
    ]);
  });

  it('a read that failed says so, and is not read as a broken probe', () => {
    const d = { ...fresh(), snapshot: { failed: 'stage_coverage_snapshots: operation exceeded time limit' } };
    expect(lineSourceItems(d, NOW)).toEqual([
      { what: 'whole line: nightly stage snapshot (stage_coverage_snapshots) could not be read (stage_coverage_snapshots: operation exceeded time limit)', owner: LINE_OWNER },
    ]);
  });

  it('a night with broken probes is ONE line naming the stages', () => {
    const d = fresh();
    d.snapshot.stages = [{ stage: 'archived', status: 'probe_broken' }, { stage: 'ocr', status: 'ok' }, { stage: 'translated', status: 'probe_broken' }];
    expect(lineSourceItems(d, NOW)).toEqual([
      { what: "whole line: last night's probe could not measure archived, translated (probe_broken: the monitor failed, not the stage)", owner: LINE_OWNER },
    ]);
  });

  it('clears: the same sources, recovered, drop off the next run', () => {
    const stale = { ...fresh(), corpus: { generated_at: ago(40 * H) }, snapshot: { timestamp: ago(3 * H), stages: [{ stage: 'ocr', status: 'probe_broken' }] } };
    expect(lineSourceItems(stale, NOW)).toHaveLength(2);
    expect(lineSourceItems(fresh(), NOW + 60_000)).toEqual([]);
  });

  it('covers the four sources the brief names', () => {
    expect(LINE_SOURCES.map(s => [s.key, s.maxMin])).toEqual([['snapshot', 1560], ['nextDaily', 1560], ['corpus', 1560], ['imageProv', 11520]]);
  });
});

describe('the brief carries them (v3#452)', () => {
  const reports = { 'pipeline-now:corpus': { generated_at: ago(30 * H) } };
  const s = (sources: unknown) => summarize({ reports, live: { rows: [] }, ops: { dir: null }, snapshot: fresh().snapshot, sources } as never, { now: NOW, hours: 24 });

  it('a stale source is a broke item with its owner', () => {
    const b = briefOf(s({ nextDaily: fresh().nextDaily, imageProv: fresh().imageProv }), { day: '2026-11-16' });
    expect(b.broke).toContainEqual({ what: 'whole line: corpus report (pipeline-now:corpus) stopped, last written 30h ago (allowed 26h)', owner: LINE_OWNER });
  });

  it('a caller that did not read the sources judges none of them', () => {
    const b = briefOf(s(null), { day: '2026-11-16' });
    expect(b.broke.some(x => x.what.startsWith('whole line:'))).toBe(false);
  });
});

describe('the page reads the brief\'s age (v3#452 item 2)', () => {
  it('brief:latest is a source with a day\'s bound, and an unread one says never', async () => {
    const { buildLine, BRIEF_STALE_MIN } = await import('@/lib/pipeline-line');
    const base = { coverage: [], next: null, now: null, fine: null, runs: [] };
    const src = (l: ReturnType<typeof buildLine>) => l.sources.find(x => x.label === 'morning brief');
    expect(src(buildLine({ ...base, briefAt: new Date('2026-11-16T09:15:23.307Z') }))).toEqual({ label: 'morning brief', at: '2026-11-16T09:15:23.307Z', staleAfterMin: BRIEF_STALE_MIN });
    expect(BRIEF_STALE_MIN).toBe(26 * 60);
    expect(src(buildLine(base))?.at).toBeNull();
  });
});
