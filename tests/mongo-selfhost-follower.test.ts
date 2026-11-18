// PRIOR ART: none — git grep "change stream" over tests/ finds no test of event handling; scripts/workers/mirror-changelog.mjs has none.
import { describe, expect, it } from 'vitest';
import { BSON } from 'mongodb';
import {
  decodeLine, planSteps, ddlAction, syncDecision, keyOf, lagSummary, completeLines, duplicateKeyFilter, ignoredCollection,
} from '../infrastructure/mongo-selfhost/follower/lib.mjs';

const { EJSON, ObjectId } = BSON;
const oid = (h: string) => new ObjectId(h.padStart(24, '0'));
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const k = (id: unknown) => EJSON.serialize({ v: id }, { relaxed: false }).v;
const ev = (t: number, op: string, c: string, id?: unknown, extra: Record<string, unknown> = {}) =>
  decodeLine(line({ ts: [t, 1], op, c, ...(id === undefined ? {} : { k: k(id) }), ...extra }));

describe('decodeLine', () => {
  it('keeps the _id type (ObjectId, string, number, nested)', () => {
    for (const id of [oid('ab'), 'book-1', 42, { a: 1, b: 'x' }]) {
      const e = decodeLine(line({ ts: [100, 2], op: 'update', c: 'pages', k: k(id), tok: 'x' }));
      expect(keyOf(e.id)).toBe(keyOf(id));
      expect(e.t).toBe(100);
      expect(e.i).toBe(2);
    }
  });
  it('reads lines written by the first recorder, whose _id was serialized without a wrapper', () => {
    const id = oid('cd');
    const e = decodeLine(line({ ts: [1, 1], op: 'insert', c: 'books', k: EJSON.serialize(id, { relaxed: false }) }));
    expect(e.id instanceof ObjectId).toBe(true);
    expect((e.id as InstanceType<typeof ObjectId>).toHexString()).toBe(id.toHexString());
  });
});

describe('planSteps', () => {
  it('folds data events per collection and dedupes ids, so replaying twice is the same work', () => {
    const a = oid('1'); const b = oid('2');
    const once = [ev(10, 'insert', 'pages', a), ev(11, 'update', 'pages', a), ev(12, 'delete', 'pages', b), ev(13, 'update', 'books', 'x')];
    const steps = planSteps([...once, ...once]);
    expect(steps.map((s: any) => [s.kind, s.coll, s.ids.length])).toEqual([['sync', 'pages', 2], ['sync', 'books', 1]]);
    expect((steps[0] as any).maxT).toBe(12);
  });

  it('treats every DDL event as a barrier, keeping order', () => {
    const steps = planSteps([
      ev(1, 'update', 'a', 1),
      ev(2, 'createIndexes', 'a', undefined, { od: { indexes: [{ v: 2, key: { x: 1 }, name: 'x_1' }] } }),
      ev(3, 'update', 'a', 2),
      ev(4, 'drop', 'a'),
      ev(5, 'insert', 'a', 3),
    ]);
    expect(steps.map((s: any) => (s.kind === 'sync' ? `sync:${s.ids.length}` : s.event.op))).toEqual(['sync:1', 'createIndexes', 'sync:1', 'drop', 'sync:1']);
  });

  it('skips system collections', () => {
    expect(planSteps([ev(1, 'insert', 'system.views', 'v')])).toEqual([]);
    expect(ignoredCollection('system.js')).toBe(true);
    expect(ignoredCollection('pages')).toBe(false);
  });

  it('carries synthetic resync events from a gap repair like data events', () => {
    const steps = planSteps([ev(1, 'resync', 'pages', oid('9'))]);
    expect(steps).toHaveLength(1);
    expect((steps[0] as any).kind).toBe('sync');
  });
});

describe('ddlAction', () => {
  it('creates collections with their options, tolerating one that already exists', () => {
    const a = ddlAction(ev(1, 'create', 'new_coll', undefined, { od: { idIndex: { v: 2, key: { _id: 1 }, name: '_id_' } } }));
    expect(a).toMatchObject({ type: 'command', command: { create: 'new_coll' }, ignore: [48] });
    const view = ddlAction(ev(1, 'create', 'v1', undefined, { od: { viewOn: 'books', pipeline: [] } }));
    expect((view as any).command).toEqual({ create: 'v1', viewOn: 'books', pipeline: [] });
  });

  it('mirrors index creation including TTL options, and index drops by name', () => {
    const c = ddlAction(ev(1, 'createIndexes', 'cron_runs', undefined, { od: { indexes: [{ v: 2, key: { at: 1 }, name: 'at_1', expireAfterSeconds: 2592000 }] } }));
    expect((c as any).command).toEqual({ createIndexes: 'cron_runs', indexes: [{ key: { at: 1 }, name: 'at_1', expireAfterSeconds: 2592000 }] });
    const d = ddlAction(ev(1, 'dropIndexes', 'cron_runs', undefined, { od: { indexes: [{ v: 2, key: { at: 1 }, name: 'at_1' }] } }));
    expect((d as any).command).toEqual({ dropIndexes: 'cron_runs', index: ['at_1'] });
  });

  it('applies a TTL change (modify) as collMod', () => {
    const m = ddlAction(ev(1, 'modify', 'uptime_checks', undefined, { od: { index: { name: 'at_1', expireAfterSeconds: 60 }, stateBeforeChange: { index: { name: 'at_1', expireAfterSeconds: 30 } } } }));
    expect((m as any).command).toEqual({ collMod: 'uptime_checks', index: { name: 'at_1', expireAfterSeconds: 60 } });
  });

  it('renames inside the database and retargets waiting ids; refuses a rename out of it', () => {
    const r = ddlAction(ev(1, 'rename', 'old', undefined, { od: { to: { db: 'bookstore', coll: 'new' }, dropTarget: false } }));
    expect(r).toMatchObject({ type: 'command', admin: true, command: { renameCollection: 'bookstore.old', to: 'bookstore.new', dropTarget: false }, retarget: { from: 'old', to: 'new' } });
    expect(ddlAction(ev(1, 'rename', 'old', undefined, { od: { to: { db: 'other', coll: 'x' } } })).type).toBe('stop');
  });

  it('pages and stops on what it must not guess at, and pages on search index changes', () => {
    expect(ddlAction(ev(1, 'dropDatabase', null as any)).type).toBe('stop');
    expect(ddlAction(ev(1, 'invalidate', null as any)).type).toBe('stop');
    expect(ddlAction(ev(1, 'somethingNew', 'x')).type).toBe('stop');
    expect(ddlAction(ev(1, 'createSearchIndexes', 'books')).type).toBe('alarm');
    expect(ddlAction(ev(1, 'shardCollection', 'books')).type).toBe('alarm');
  });
});

describe('syncDecision', () => {
  const a = oid('a'); const b = oid('b'); const c = oid('c');
  it('replaces what Atlas has and deletes what it no longer has', () => {
    const d = syncDecision([a, b, c], [{ _id: a, x: 1 }, { _id: c, x: 3 }], true);
    expect(d.replace.map((x: any) => x.x)).toEqual([1, 3]);
    expect(d.delete.map((x: any) => x.toHexString())).toEqual([b.toHexString()]);
    expect(d.deferred).toEqual([]);
  });
  it('does not delete when the whole collection is gone on Atlas: that waits for its drop or rename', () => {
    const d = syncDecision([a, b], [], false);
    expect(d.delete).toEqual([]);
    expect(d.deferred).toHaveLength(2);
  });
  it('matches ids by type: the string "1" is not the number 1', () => {
    const d = syncDecision(['1', 1], [{ _id: 1 }], true);
    expect(d.replace).toHaveLength(1);
    expect(d.delete).toEqual(['1']);
  });
});

describe('helpers', () => {
  it('only consumes complete lines', () => {
    expect(completeLines('a\nb\npart')).toEqual({ lines: ['a', 'b'], consumed: 4 });
    expect(completeLines('part')).toEqual({ lines: [], consumed: 0 });
  });
  it('summarises lag', () => {
    expect(lagSummary([5, 1, 3, 2, 4])).toEqual({ n: 5, p50: 3, p95: 5, max: 5 });
    expect(lagSummary([])).toBeNull();
  });
  it('finds the local holder of a duplicate key from the index named in the error', () => {
    const specs = [{ name: '_id_', key: { _id: 1 } }, { name: 'slug_1_lang_1', key: { slug: 1, 'meta.lang': 1 }, unique: true }];
    const msg = 'E11000 duplicate key error collection: bookstore.x index: slug_1_lang_1 dup key: { slug: "a", meta.lang: "la" }';
    expect(duplicateKeyFilter(msg, specs, { _id: 1, slug: 'a', meta: { lang: 'la' } })).toEqual({ slug: 'a', 'meta.lang': 'la' });
    expect(duplicateKeyFilter('E11000 something else', specs, {})).toBeNull();
  });
});
