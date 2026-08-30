import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import { acquisitionGate, classifyEvidence, SKIP_COLLECTION, CLAIM_COLLECTION } from '@/lib/acquisition-guard';
import type { DedupMatch } from '@/lib/dedup';

/**
 * What this pins, and why each is a real incident rather than a hypothetical:
 *
 * 1. A skip is RECORDED. It used to evaporate into a script's stdout, so a
 *    false positive — a book we declined but do not actually hold — was
 *    indistinguishable from a book that was never offered.
 * 2. The weak-evidence case is FLAGGED. 81% of edition-key-only decisions in
 *    `dedup_shadow_decisions` had no publication year on at least one side,
 *    i.e. they rest on normalized title + surname alone. That is weaker than
 *    "same author, same title, same year" and is the case a human should see.
 * 3. The gate is ATOMIC. 80 of the 139 same-fingerprint groups in `books` have
 *    every member created within 5 seconds: parallel importers each passed a
 *    check-then-insert before any of them inserted. A claim that loses is a
 *    skip, not a second copy.
 * 4. It fails OPEN on infrastructure trouble and CLOSED on a real collision.
 *    An unreachable claim collection must not stop acquisition.
 */

type Doc = Record<string, unknown>;

/** Fake Mongo: `books` answers dedup queries from `existing`; the claim and
 *  skip collections behave enough like the real thing to exercise the gate. */
function makeDb(opts: { existing?: Doc[]; heldClaims?: string[]; claimsBroken?: boolean } = {}) {
  const existing = opts.existing ?? [];
  const claims = new Map<string, Doc>();
  for (const fp of opts.heldClaims ?? []) claims.set(fp, { _id: fp, at: new Date() });
  const skips: Doc[] = [];

  const collection = (name: string) => {
    if (name === CLAIM_COLLECTION) {
      return {
        insertOne: async (doc: Doc) => {
          if (opts.claimsBroken) throw Object.assign(new Error('no primary'), { code: 189 });
          const id = doc._id as string;
          if (claims.has(id)) throw Object.assign(new Error('dup key'), { code: 11000 });
          claims.set(id, doc);
          return { acknowledged: true };
        },
        // Only an unconfirmed AND stale claim is reclaimable; the fixtures are fresh.
        findOneAndUpdate: async () => null,
        updateMany: async () => ({ acknowledged: true }),
      };
    }
    if (name === SKIP_COLLECTION) {
      return { insertOne: async (doc: Doc) => { skips.push(doc); return { acknowledged: true }; } };
    }
    return {
      findOne: async () => null,
      find: () => ({ limit: () => ({ toArray: async () => (name === 'books' ? existing : []) }) }),
      insertOne: async () => ({ acknowledged: true }),
    };
  };
  return { db: { collection } as unknown as Db, skips, claims };
}

const CTX = { importer: 'test:suite' };

describe('classifyEvidence', () => {
  const m = (t: DedupMatch['matchType'], year: number | null = null): DedupMatch =>
    ({ matchedBookId: 'x', matchedTitle: 't', matchType: t, confidence: 'high', matchedYear: year });

  it('calls an identifier match exact', () => {
    expect(classifyEvidence(1600, [m('source_fingerprint')])).toBe('exact');
    expect(classifyEvidence(null, [m('iiif_manifest')])).toBe('exact');
  });

  it('separates a year-on-both-sides edition match from a year-missing one', () => {
    expect(classifyEvidence(1600, [m('edition_key', 1600)])).toBe('edition_key_full');
    expect(classifyEvidence(null, [m('edition_key', 1600)])).toBe('edition_key_no_year');
    expect(classifyEvidence(1600, [m('edition_key', null)])).toBe('edition_key_no_year');
  });
});

describe('acquisitionGate', () => {
  const CANDIDATE = { title: 'Summa Astensis', author: 'Astesanus de Ast', year: 1730 };

  it('declines a duplicate AND writes a reviewable row', async () => {
    const { db, skips } = makeDb({ existing: [{ id: 'b1730', title: 'Summa Astensis', edition_key: 'summa astensis|ast|1730|v', year: 1730 }] });
    const gate = await acquisitionGate(db, CANDIDATE, CTX, { shadowLog: false });

    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('duplicate');
    expect(skips).toHaveLength(1);
    expect(skips[0].importer).toBe('test:suite');
    expect(skips[0].matched_book_id).toBe('b1730');
    expect(skips[0].evidence).toBe('edition_key_full');
    expect(skips[0].year_missing_one_side).toBe(false);
    // The candidate's own identity has to be legible from the row, or the
    // reviewer cannot tell what we declined to acquire.
    expect((skips[0].candidate as Doc).title).toBe('Summa Astensis');
  });

  it('flags the weak-evidence case — no year on one side', async () => {
    const { db, skips } = makeDb({ existing: [{ id: 'bNoYear', title: 'Summa Astensis', edition_key: 'summa astensis|ast||v' }] });
    const gate = await acquisitionGate(db, CANDIDATE, CTX, { shadowLog: false });
    expect(gate.ok).toBe(false);
    expect(skips[0].evidence).toBe('edition_key_no_year');
    expect(skips[0].year_missing_one_side).toBe(true);
  });

  it('lets a clear candidate through and claims its fingerprints', async () => {
    const { db, skips, claims } = makeDb();
    const gate = await acquisitionGate(db, { ...CANDIDATE, ia_identifier: 'summaastensis00aste' }, CTX, { shadowLog: false });
    expect(gate.ok).toBe(true);
    expect(skips).toHaveLength(0);
    expect(claims.has('ia:summaastensis00aste')).toBe(true);
  });

  it('loses the race rather than inserting a second copy', async () => {
    // Another importer already holds the fingerprint — the exact shape of the
    // 80 millisecond-apart duplicate groups measured in `books`.
    const { db, skips } = makeDb({ heldClaims: ['ia:summaastensis00aste'] });
    const gate = await acquisitionGate(db, { ...CANDIDATE, ia_identifier: 'summaastensis00aste' }, CTX, { shadowLog: false });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('claimed');
    expect(skips[0].evidence).toBe('claim_race');
  });

  it('fails OPEN when the claim store is unreachable', async () => {
    // A broken claim collection is an infrastructure problem, not evidence of a
    // duplicate. Failing closed here would silently halt all acquisition.
    const { db } = makeDb({ claimsBroken: true });
    const gate = await acquisitionGate(db, { ...CANDIDATE, ia_identifier: 'summaastensis00aste' }, CTX, { shadowLog: false });
    expect(gate.ok).toBe(true);
  });

  it('allowDuplicate proceeds but still records the decision', async () => {
    const { db, skips } = makeDb({ existing: [{ id: 'b1730', title: 'Summa Astensis', edition_key: 'summa astensis|ast|1730|v', year: 1730 }] });
    const gate = await acquisitionGate(db, CANDIDATE, CTX, { shadowLog: false, allowDuplicate: true });
    expect(gate.ok).toBe(true);
    expect(skips).toHaveLength(1);
    expect(skips[0].allowed_duplicate).toBe(true);
  });
});
