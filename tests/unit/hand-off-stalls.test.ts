/**
 * Hand-off stall rule (#8482 part C). The positive control is 2026-11-09: first-translation searches had been
 * landing (upstream > 0) while the ingest wrote nothing for a day.
 */
import { describe, it, expect } from 'vitest';
import { evaluateStalls, edgesToPage, recordPaged, pageText, windowOf, ocrStageWindows } from '../../scripts/lib/hand-off-stalls.mjs';
import { handoffCounts } from '../../scripts/maintenance/pipeline-now-push.mjs';

const ok = { last24h: 5, prev72h: 5 };
const healthy = { gpu_draft: ok, armc_correct: ok, translate: ok, enrich: ok, ft_search: ok, ft_ingest: ok };
const edge = (s: ReturnType<typeof evaluateStalls>, id: string) => s.find(x => x.edge === id)!;

describe('evaluateStalls', () => {
  it('flags ft_search->ft_ingest when searches landed in the 72 h before and the ingest wrote 0 (2026-11-09)', () => {
    const s = evaluateStalls({ ...healthy, ft_search: { last24h: 0, prev72h: 435 }, ft_ingest: { last24h: 0, prev72h: 0 } });
    expect(edge(s, 'ft_search->ft_ingest').stalled).toBe(true);
    expect(s.filter(x => x.stalled)).toHaveLength(1);
  });
  it('flags nothing when every downstream wrote in the last 24 h', () => {
    expect(evaluateStalls(healthy).some(x => x.stalled)).toBe(false);
  });
  it('does not flag a downstream of 0 when the upstream was quiet too', () => {
    const s = evaluateStalls({ ...healthy, translate: { last24h: 0, prev72h: 0 }, enrich: { last24h: 0, prev72h: 0 } });
    expect(edge(s, 'translate->enrich').stalled).toBe(false);
  });
  it('flags a quiet upstream when the downstream queue is known non-empty', () => {
    const s = evaluateStalls({ ...healthy, gpu_draft: { last24h: 0, prev72h: 0 }, armc_correct: { last24h: 0, prev72h: 0 } }, { armc_correct: 12 });
    expect(edge(s, 'gpu_draft->armc_correct').stalled).toBe(true);
  });
  it('reports an unread stage as unknown, never as a stall', () => {
    const { enrich: _e, ...rest } = healthy;
    expect(edge(evaluateStalls(rest), 'translate->enrich')).toMatchObject({ stalled: false, unknown: true });
  });
});

describe('paging', () => {
  const now = new Date('2026-11-10T06:00:00Z');
  const stalls = evaluateStalls({ ...healthy, enrich: { last24h: 0, prev72h: 0 } });
  it('pages a new stall once, not again within 24 h, then again after', () => {
    const first = edgesToPage(stalls, [], now);
    expect(first.map(s => s.edge)).toEqual(['translate->enrich']);
    const rec = recordPaged(stalls, [], first, now);
    expect(edgesToPage(rec, rec, new Date('2026-11-11T05:00:00Z'))).toHaveLength(0);
    expect(edgesToPage(rec, rec, new Date('2026-11-11T06:01:00Z'))).toHaveLength(1);
  });
  it("keeps an edge's earlier last_paged_at when it is not paged this run", () => {
    const prev = [{ edge: 'translate->enrich', last_paged_at: '2026-11-09T12:00:00.000Z' }];
    expect(recordPaged(stalls, prev, [], now).find(s => s.edge === 'translate->enrich')!.last_paged_at).toBe('2026-11-09T12:00:00.000Z');
  });
  it('words one message for several edges', () => {
    const two = evaluateStalls({ ...healthy, enrich: { last24h: 0, prev72h: 0 }, ft_ingest: { last24h: 0, prev72h: 0 } }).filter(s => s.stalled);
    expect(pageText(two)).toMatch(/^2 pipeline hand-offs stalled/);
  });
});

describe('window counts', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('buckets by age', () => {
    expect(windowOf('2026-11-10T00:00:00Z', now)).toBe('last24h');
    expect(windowOf('2026-11-08T00:00:00Z', now)).toBe('prev72h');
    expect(windowOf('2026-11-01T00:00:00Z', now)).toBeNull();
  });
  it('folds ocr lanes into GPU drafts and agy corrections', () => {
    const w = ocrStageWindows([
      { lane: 'lightonocr', window: 'prev72h', pages: 440 }, { lane: 'agy-flash-ocr', window: 'last24h', pages: 9 },
      { lane: 'claude-opus-ocr', window: 'last24h', pages: 100 },
    ]);
    expect(w.gpu_draft).toEqual({ last24h: 0, prev72h: 440 });
    expect(w.armc_correct).toEqual({ last24h: 9, prev72h: 0 });
  });
  it('builds per-day counts and the stall verdict end to end for the 2026-11-09 shape', () => {
    const c = handoffCounts({
      ocrRows: [], ocrWin: [], translatedRows: [], bookRows: [], now,
      ft: [{ ingested: new Date('2026-11-08T10:00:00Z'), searched: new Date('2026-11-08T09:00:00Z') }],
    });
    expect(c.per_day).toHaveLength(7);
    expect(c.per_day.at(-3)).toMatchObject({ day: '2026-11-08', ft_ingest: 1, ft_search: 1 });
    expect(c.windows.ft_ingest).toEqual({ last24h: 0, prev72h: 1 });
    expect(evaluateStalls(c.windows).find(s => s.edge === 'ft_search->ft_ingest')!.stalled).toBe(true);
  });
});
