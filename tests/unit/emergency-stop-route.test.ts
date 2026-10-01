import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/admin/emergency-stop (#5492). Before #5492 it accepted any `paused_phases` array,
 * so `['ocr']` returned success and paused nothing; it never reached the batch translation
 * runs; and `?resume=true` could only clear every pause at once. These pin: unknown keys are a
 * 400 that lists the valid ones; a full stop sets every key (a scope bypasses the global flag,
 * never a key) and parks open runs; resume can target one key.
 */
type Doc = Record<string, any>;
let control: Doc | null;
const calls: Array<{ coll: string; op: string; args: unknown[] }> = [];

vi.mock('@/lib/auth-helpers', () => ({
  withAdminAuth: (h: (req: unknown, session: unknown) => Promise<Response>) =>
    (req: unknown) => h(req, { user: { id: 'admin', role: 'superadmin' } }),
}));
vi.mock('@/lib/sqs-client', () => ({ purgeAIQueues: vi.fn(async () => ({ purged: [], errors: [] })) }));
vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (coll: string) => {
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ coll, op, args }); return Promise.resolve(op === 'countDocuments' ? 3 : { modifiedCount: 2, matchedCount: 2 }); };
      return {
        findOne: async () => control,
        countDocuments: rec('countDocuments'),
        updateMany: rec('updateMany'),
        updateOne: rec('updateOne'),
        insertOne: rec('insertOne'),
      };
    },
  })),
}));

const { POST } = await import('@/app/api/admin/emergency-stop/route');
const post = (query = '', body?: unknown) =>
  (POST as unknown as (r: NextRequest) => Promise<Response>)(new NextRequest(`https://x.test/api/admin/emergency-stop${query}`, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  }));
const controlWrite = () => calls.find((c) => c.coll === 'system_config' && c.op === 'updateOne');
const runWrites = () => calls.filter((c) => c.coll === 'translate_batch_runs' && c.op === 'updateMany');

beforeEach(() => { calls.length = 0; control = null; });

describe('emergency-stop validates the keys it is given', () => {
  it.each([[['image']], [['ocr', 'chapters']], [[10]], [['']], [[]], ['ocr']])('rejects %j with a 400 listing the valid keys, and writes nothing', async (pp) => {
    const res = await post('', { paused_phases: pp });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.valid_keys).toEqual(['archive', 'ocr', 'translate', 'enrich', 'images', 'embeddings']);
    expect(calls.filter((c) => c.op !== 'countDocuments')).toEqual([]);
  });

  it('a targeted stop adds canonical keys (aliases resolved) and does not set the global flag', async () => {
    const res = await post('', { paused_phases: ['translation', 8] });
    expect(res.status).toBe(200);
    const [, update] = controlWrite()!.args as [Doc, Doc];
    expect(update.$addToSet.paused_phases.$each).toEqual(['translate', 'images']);
    expect(update.$set.paused).toBeUndefined();
    expect(runWrites()).toHaveLength(1); // translate is among them → runs parked
  });

  it('a targeted stop without translate leaves the batch runs alone', async () => {
    await post('', { paused_phases: ['ocr'] });
    expect(runWrites()).toHaveLength(0);
  });
});

describe('a full stop reaches every lane', () => {
  it('sets the global flag AND every key, and parks only the runs about to submit', async () => {
    const res = await post();
    const j = await res.json();
    expect(j.translate_batch_runs_parked).toBe(3);
    const [, update] = controlWrite()!.args as [Doc, Doc];
    expect(update.$set.paused).toBe(true);
    expect(update.$set.paused_phases).toEqual(['archive', 'ocr', 'translate', 'enrich', 'images', 'embeddings']);
    const [filter, pipeline] = runWrites()[0].args as [Doc, Doc[]];
    // Never a run already at Gemini: its collection is free and must continue (#5496 review).
    expect(filter.phase.$in).toEqual(['round_ready', 'round_submitting']);
    expect(filter.phase.$nin).toBeUndefined();
    for (const atGemini of ['round_submitted', 'translate_submitted', 'repair_submitted', 'ready_to_write']) {
      expect(filter.phase.$in).not.toContain(atGemini);
    }
    expect(pipeline[0].$set.phase).toBe('parked');
    expect(pipeline[0].$set.emergency_stop.prior_phase).toBe('$phase');
  });

  it('a dry run writes nothing', async () => {
    await post('?dry_run=true');
    expect(calls.filter((c) => c.op !== 'countDocuments')).toEqual([]);
  });
});

describe('resume', () => {
  it('?resume=true clears every pause and restores the parked runs', async () => {
    control = { paused: true, paused_phases: ['archive', 'ocr', 'translate', 'enrich', 'images', 'embeddings'] };
    const j = await (await post('?resume=true')).json();
    expect(j).toMatchObject({ key: 'all', paused: false, paused_phases: [] });
    expect(runWrites()).toHaveLength(1);
    expect((runWrites()[0].args[0] as Doc)['emergency_stop.by']).toBe('emergency-stop');
  });

  it('?resume=true&key=translate after a full stop resumes translate only', async () => {
    control = { paused: true, paused_phases: ['archive', 'ocr', 'translate', 'enrich', 'images', 'embeddings', 1.97] };
    const j = await (await post('?resume=true&key=translate')).json();
    expect(j.paused).toBe(false);
    expect(j.paused_phases).toEqual(['archive', 'ocr', 'enrich', 'images', 'embeddings', 1.97]);
    expect(runWrites()).toHaveLength(1);
  });

  it('a global-only pause becomes every key but the resumed one (and the flag is cleared)', async () => {
    control = { paused: true, paused_phases: [] };
    const j = await (await post('?resume=true&key=ocr')).json();
    expect(j.paused_phases).toEqual(['archive', 'translate', 'enrich', 'images', 'embeddings']);
    expect(runWrites()).toHaveLength(0);
  });

  it('accepts a legacy alias for the key, and removes every spelling of it', async () => {
    control = { paused: false, paused_phases: ['translation', 4, 'ocr'] };
    const j = await (await post('?resume=true&key=translation')).json();
    expect(j.key).toBe('translate');
    expect(j.paused_phases).toEqual(['ocr']);
  });

  it('rejects an unknown key with a 400 and writes nothing', async () => {
    const res = await post('?resume=true&key=image');
    expect(res.status).toBe(400);
    expect((await res.json()).valid_keys).toContain('images');
    expect(calls).toEqual([]);
  });
});
