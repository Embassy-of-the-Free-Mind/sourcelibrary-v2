/**
 * Health-probe alerting guards (2026-07-31 false "sign-in is broken" page).
 *
 * A single dropped Atlas TLS handshake at 00:00:01 UTC made /api/health/auth
 * report `database: error` and email "[CRITICAL] Source Library sign-in is
 * broken". Sign-in was fine — an account was created two minutes later, and
 * 2,013 of the preceding 2,016 probes were clean. Two things had failed:
 * the retry ran back-to-back with no delay, and one failed probe was treated as
 * proof of an outage.
 *
 * These tests drive the real functions against a stubbed Db and assert on
 * behaviour — what gets slept, what gets written, and whether a page is
 * authorised. Reverting to instant retries, or to paging on the first failure,
 * fails here.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Db } from 'mongodb';
import {
  retryWithBackoff,
  recordFailureStreaks,
  clearFailureStreaks,
} from '../../src/lib/health-alerting';

/** Minimal in-memory stand-in for the one collection these helpers touch. */
function stubDb(seed: Record<string, any> = {}) {
  const docs = new Map<string, any>(Object.entries(seed));
  const db = {
    collection: (name: string) => {
      if (name !== 'system_config') throw new Error(`unexpected collection ${name}`);
      return {
        findOne: async (filter: any) => docs.get(filter._id) ?? null,
        updateOne: async (filter: any, update: any, options: any = {}) => {
          const existing = docs.get(filter._id);
          // Honour the `streaks: { $exists: true }` guard used by the clear path.
          if (filter.streaks?.$exists && !existing?.streaks) return { matchedCount: 0 };
          if (!existing && !options.upsert) return { matchedCount: 0 };
          docs.set(filter._id, { ...(existing ?? { _id: filter._id }), ...update.$set });
          return { matchedCount: 1 };
        },
      };
    },
  } as unknown as Db;
  return { db, docs };
}

/** A Db whose every operation throws — stands in for "Atlas is unreachable". */
function brokenDb() {
  return {
    collection: () => ({
      findOne: async () => { throw new Error('Client network socket disconnected'); },
      updateOne: async () => { throw new Error('Client network socket disconnected'); },
    }),
  } as unknown as Db;
}

describe('retryWithBackoff', () => {
  it('waits between attempts instead of retrying instantly', async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => { slept.push(ms); };
    let calls = 0;

    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error('Client network socket disconnected');
        return 'recovered';
      },
      { sleep }
    );

    expect(result).toBe('recovered');
    expect(calls).toBe(3);
    // The whole point: real delays, and growing ones. A fault lasting a second
    // or two defeated the old back-to-back retry.
    expect(slept.length).toBe(2);
    expect(slept.every(ms => ms > 0)).toBe(true);
    expect(slept[1]).toBeGreaterThan(slept[0]);
  });

  it('forces a reconnect before each retry and reports the attempt number', async () => {
    const attempts: number[] = [];
    const reconnects: number[] = [];
    await retryWithBackoff(
      async attempt => {
        attempts.push(attempt);
        if (attempt === 0) throw new Error('boom');
        return 'ok';
      },
      { sleep: async () => {}, onRetry: n => { reconnects.push(n); } }
    );
    expect(attempts).toEqual([0, 1]);
    expect(reconnects).toEqual([1]);
  });

  it('rethrows the last error when every attempt fails', async () => {
    await expect(
      retryWithBackoff(
        async attempt => { throw new Error(`fail-${attempt}`); },
        { sleep: async () => {} }
      )
    ).rejects.toThrow('fail-2');
  });
});

describe('recordFailureStreaks', () => {
  it('does NOT authorise a page on the first failed probe', async () => {
    const { db } = stubDb();
    const decision = await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);

    // This is the 2026-07-31 incident: one blip, no email.
    expect(decision.confirmed).toEqual([]);
    expect(decision.streaks.database).toBe(1);
    expect(decision.storeUnavailable).toBe(false);
  });

  it('authorises a page once the same check fails on consecutive probes', async () => {
    const { db } = stubDb();
    await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);
    const second = await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);

    expect(second.confirmed).toEqual(['database']);
    expect(second.streaks.database).toBe(2);
  });

  it('never lets two UNRELATED single blips add up to a page', async () => {
    const { db } = stubDb();
    await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);
    const second = await recordFailureStreaks(db, 'auth_alert_state', ['email'], 2);

    expect(second.confirmed).toEqual([]);
    expect(second.streaks.email).toBe(1);
    // The database recovered on this probe, so its streak must reset.
    expect(second.streaks.database).toBe(0);
  });

  it('confirms only the checks that actually met the threshold', async () => {
    const { db } = stubDb();
    await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);
    const second = await recordFailureStreaks(db, 'auth_alert_state', ['database', 'email'], 2);

    expect(second.confirmed).toEqual(['database']);
    expect(second.streaks).toMatchObject({ database: 2, email: 1 });
  });

  it('fails OPEN when the streak store is unreachable — a real outage still pages', async () => {
    for (const db of [null, brokenDb()]) {
      const decision = await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);
      expect(decision.confirmed).toEqual(['database']);
      expect(decision.storeUnavailable).toBe(true);
    }
  });

  it('persists the streak so the next probe can read it', async () => {
    const { db, docs } = stubDb();
    await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);
    expect(docs.get('auth_alert_state').streaks).toEqual({ database: 1 });
    expect(docs.get('auth_alert_state').last_failing_checks).toEqual(['database']);
  });
});

describe('clearFailureStreaks', () => {
  it('resets streaks after a clean probe, so a later blip starts from zero', async () => {
    const { db, docs } = stubDb();
    await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);
    await clearFailureStreaks(db, 'auth_alert_state');
    expect(docs.get('auth_alert_state').streaks).toEqual({});

    const afterRecovery = await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2);
    expect(afterRecovery.confirmed).toEqual([]);
    expect(afterRecovery.streaks.database).toBe(1);
  });

  it('is a no-op when no failure has ever been recorded', async () => {
    const { db, docs } = stubDb();
    await clearFailureStreaks(db, 'auth_alert_state');
    expect(docs.has('auth_alert_state')).toBe(false);
  });

  it('swallows store errors rather than breaking a healthy probe', async () => {
    await expect(clearFailureStreaks(brokenDb(), 'auth_alert_state')).resolves.toBeUndefined();
  });
});

describe('alert threshold wiring', () => {
  it('pages within ~20 minutes of a real outage at a 10-minute probe cadence', async () => {
    // Guards the tradeoff itself: the threshold buys blip-immunity, but must not
    // silence a genuine outage for long. Two probes 10 min apart = 20 min.
    const { db } = stubDb();
    const probeIntervalMin = 10;
    let probes = 0;
    let confirmed: string[] = [];
    while (confirmed.length === 0 && probes < 10) {
      probes++;
      confirmed = (await recordFailureStreaks(db, 'auth_alert_state', ['database'], 2)).confirmed;
    }
    expect(probes * probeIntervalMin).toBeLessThanOrEqual(20);
  });
});
