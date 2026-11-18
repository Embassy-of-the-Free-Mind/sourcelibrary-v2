// PRIOR ART: tests/mongo-selfhost-follower.test.ts tests the follower's event planning; this covers the restore
// test's own oplog replay (infrastructure/mongo-selfhost/backup/oplog-replay.mjs, #346).
import { describe, expect, it } from 'vitest';
import { clean, commandAction, flatten, parseTs, skipNs, tsWindow } from '../infrastructure/mongo-selfhost/backup/oplog-replay.mjs';

describe('oplog-replay', () => {
  it('flattens a transaction into its operations, in order, nested ones included', () => {
    const t = {
      op: 'c', ns: 'admin.$cmd',
      o: { applyOps: [{ op: 'i', ns: 'bookstore.a', o: { _id: 1 } }, { op: 'c', ns: 'admin.$cmd', o: { applyOps: [{ op: 'd', ns: 'bookstore.b', o: { _id: 2 } }] } }] },
    };
    expect(flatten(t).map((x: { op: string; ns: string }) => `${x.op}:${x.ns}`)).toEqual(['i:bookstore.a', 'd:bookstore.b']);
    expect(flatten({ op: 'u', ns: 'bookstore.a', o: {}, o2: { _id: 1 } })).toHaveLength(1);
  });

  it('keeps only the fields applyOps takes, and drops the old collection UUID', () => {
    const e = { op: 'u', ns: 'bookstore.a', o: { $v: 2, diff: {} }, o2: { _id: 1 }, ui: 'old', lsid: {}, txnNumber: 3, ts: 1, t: 1, wall: 0 };
    expect(clean(e)).toEqual({ op: 'u', ns: 'bookstore.a', o: { $v: 2, diff: {} }, o2: { _id: 1 } });
    expect(clean({ op: 'i', ns: 'bookstore.a', o: { _id: 1 } })).not.toHaveProperty('o2');
  });

  it('turns a two-phase index build into one createIndexes at the commit', () => {
    expect(commandAction({ o: { startIndexBuild: 'c', indexes: [] } })).toBe('skip');
    expect(commandAction({ o: { abortIndexBuild: 'c' } })).toBe('skip');
    expect(commandAction({ o: { commitIndexBuild: 'c', indexes: [{ key: { x: 1 }, name: 'x_1' }] } })).toBe('createIndexes');
    expect(commandAction({ o: { create: 'c' } })).toBe('applyOps');
    expect(commandAction({ o: { drop: 'c' } })).toBe('applyOps');
  });

  it('leaves alone the named namespaces and the system ones', () => {
    const names = new Set(['bookstore.presence']);
    expect(skipNs('bookstore.presence', names)).toBe(true);
    expect(skipNs('admin.system.users', names)).toBe(true);
    expect(skipNs('config.transactions', names)).toBe(true);
    expect(skipNs('bookstore.system.views', names)).toBe(true);
    expect(skipNs('', names)).toBe(true);
    expect(skipNs('bookstore.pages', names)).toBe(false);
  });
  it('replays only AFTER_TS < ts <= UNTIL_TS, so dump oplog and PBM slices join without overlap', () => {
    const after = parseTs('1794870000:5'), until = parseTs('1794880000');
    expect(tsWindow([1794870000, 5], after, until)).toBe('before');
    expect(tsWindow([1794870000, 6], after, until)).toBe('in');
    expect(tsWindow([1794880000, 0], after, until)).toBe('in');
    expect(tsWindow([1794880000, 1], after, until)).toBe('past');
    expect(tsWindow([1, 1], null, null)).toBe('in');
    // a bson Timestamp exposes t and i
    expect(tsWindow({ t: 1794880001, i: 0 }, after, until)).toBe('past');
    expect(() => parseTs('soon')).toThrow();
  });
});
