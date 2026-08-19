/**
 * The TS-side translation door (src/lib/translate-write.ts, issue #3749) —
 * guard tests mirroring tests/unit/translate-edge-cases.test.ts's guard suite
 * for the .mjs door, plus a parity assertion importing BOTH doors.
 *
 * Negative control: the human-edit tests assert updateOne is NOT called,
 * which cannot pass if the guard is deleted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stub DB behind getDb() ─────────────────────────────────────────────────
// Both translate-write.ts and page-revisions.ts (createRevision) resolve
// their db through '@/lib/mongodb' getDb — one mock covers guard read,
// revision snapshot, and final write.
const state = vi.hoisted(() => ({
  pageDoc: null as Record<string, unknown> | null,
  updates: [] as Array<[unknown, unknown]>,
  revisions: [] as unknown[],
  findFilters: [] as unknown[],
  findResults: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => makeDb()),
}));

function makeDb() {
  return {
    collection(name: string) {
      return {
        findOne: async () => state.pageDoc,
        find: (filter: unknown) => {
          state.findFilters.push(filter);
          return { toArray: async () => state.findResults };
        },
        updateOne: async (filter: unknown, update: unknown) => {
          if (name === 'pages') state.updates.push([filter, update]);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        insertOne: async (doc: unknown) => {
          if (name === 'page_revisions') state.revisions.push(doc);
          return { insertedId: 'rev1' };
        },
        // The .mjs door's revision helper uses insertMany
        insertMany: async (docs: unknown[]) => {
          if (name === 'page_revisions') state.revisions.push(...docs);
          return {};
        },
      };
    },
  };
}

import {
  writePageTranslation,
  isHumanEditedTranslation,
  isHumanEditedField,
  findHumanEditedPageIds,
} from '@/lib/translate-write';
import {
  writePageTranslation as writePageTranslationMjs,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';

function setPage(translation: Record<string, unknown> | null) {
  state.pageDoc = translation === null
    ? { id: 'p1', book_id: 'b1' }
    : { id: 'p1', book_id: 'b1', translation };
}

beforeEach(() => {
  state.pageDoc = null;
  state.updates = [];
  state.revisions = [];
  state.findFilters = [];
  state.findResults = [];
});

const writeArgs = {
  pageId: 'p1',
  text: 'New AI translation.',
  model: 'gemini-3.1-flash-lite',
  promptRef: { id: 'x', name: 'Standard Translation', version: 12, content_hash: 'abc123' },
};

describe('writePageTranslation (TS door) human-edit guard', () => {
  it('refuses to overwrite a manual translation (negative control: no updateOne)', async () => {
    setPage({ data: 'HAND-CORRECTED TEXT', source: 'manual' });
    const r = await writePageTranslation(writeArgs);
    expect(r.written).toBe(false);
    expect(r.protected).toBe(true);
    expect(r.text).toBe('HAND-CORRECTED TEXT'); // returns human text for continuity
    expect(state.updates.length).toBe(0);
    expect(state.revisions.length).toBe(0);
  });

  it('refuses when edited_by is set even if source is ai', async () => {
    setPage({ data: 'EDITED', source: 'ai', edited_by: 'derek' });
    const r = await writePageTranslation(writeArgs);
    expect(r.written).toBe(false);
    expect(r.protected).toBe(true);
    expect(state.updates.length).toBe(0);
  });

  it('overwriteHuman: true bypasses the guard AND still writes a revision first', async () => {
    setPage({ data: 'HAND', source: 'manual' });
    const r = await writePageTranslation({ ...writeArgs, overwriteHuman: true });
    expect(r.written).toBe(true);
    expect(state.updates.length).toBe(1);
    expect(state.revisions.length).toBe(1); // the human text is preserved as a revision
    expect((state.revisions[0] as { data: string }).data).toBe('HAND');
  });

  it('writes normally over AI text, with provenance stamped', async () => {
    setPage({ data: 'old ai', source: 'ai' });
    const r = await writePageTranslation(writeArgs);
    expect(r.written).toBe(true);
    expect(r.text).toBe('New AI translation.');
    expect(state.updates.length).toBe(1);
    expect(state.revisions.length).toBe(1);
    const [, update] = state.updates[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    const t = set.translation as Record<string, unknown>;
    expect(t.data).toBe('New AI translation.');
    expect(t.source).toBe('ai');
    expect(t.model).toBe('gemini-3.1-flash-lite');
    // Provenance (#3749 promise 3)
    expect(t.prompt_version).toBe('12');
    expect(t.prompt_id).toBe('x');
    expect(t.prompt_hash).toBe('abc123');
    expect(t.prompt_name).toBe('Standard Translation');
    expect(typeof t.content_hash).toBe('string');
  });

  it('writes normally on first translation (no existing → no revision)', async () => {
    setPage(null);
    const r = await writePageTranslation(writeArgs);
    expect(r.written).toBe(true);
    expect(state.updates.length).toBe(1);
    expect(state.revisions.length).toBe(0); // nothing to snapshot
  });

  it('extraTranslationFields and extraSet ride along in the same write', async () => {
    setPage(null);
    await writePageTranslation({
      ...writeArgs,
      extraTranslationFields: { batch_job_id: 'job9' },
      extraSet: { detected_terms: ['azoth'] },
    });
    const [, update] = state.updates[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect((set.translation as Record<string, unknown>).batch_job_id).toBe('job9');
    expect(set.detected_terms).toEqual(['azoth']);
  });
});

describe('isHumanEditedTranslation predicate', () => {
  it('matches the door: manual OR edited_by; ai/empty pass', () => {
    expect(isHumanEditedTranslation({ source: 'manual' })).toBe(true);
    expect(isHumanEditedTranslation({ source: 'ai', edited_by: 'derek' })).toBe(true);
    expect(isHumanEditedTranslation({ source: 'ai' })).toBe(false);
    expect(isHumanEditedTranslation({ source: 'batch_api' })).toBe(false);
    expect(isHumanEditedTranslation(null)).toBe(false);
    expect(isHumanEditedTranslation(undefined)).toBe(false);
    // works for ocr subdocuments too (same convention, /api/pages/[id])
    expect(isHumanEditedField({ source: 'manual', data: 'ocr text' })).toBe(true);
  });
});

describe('findHumanEditedPageIds (bulk guard for collectors)', () => {
  it('returns the protected id set and queries by manual-or-edited_by', async () => {
    state.findResults = [{ id: 'p2' }, { id: 'p5' }];
    const db = makeDb();
    const ids = await findHumanEditedPageIds(db as never, ['p1', 'p2', 'p5'], 'translation');
    expect(ids).toEqual(new Set(['p2', 'p5']));
    const filter = state.findFilters[0] as Record<string, unknown>;
    expect(filter.id).toEqual({ $in: ['p1', 'p2', 'p5'] });
    expect(filter.$or).toEqual([
      { 'translation.source': 'manual' },
      { 'translation.edited_by': { $exists: true, $nin: [null, ''] } },
    ]);
  });

  it('empty input short-circuits without a query', async () => {
    const db = makeDb();
    const ids = await findHumanEditedPageIds(db as never, [], 'ocr');
    expect(ids.size).toBe(0);
    expect(state.findFilters.length).toBe(0);
  });
});

// ── Parity: the TS door and the .mjs door make the same refusal decision ──
describe('TS/.mjs door parity', () => {
  const mjsArgs = {
    page: { id: 'p1', book_id: 'b1' },
    book: { language: 'latin' },
    text: 'New AI translation.',
    promptRef: { id: 'x', name: 'Standard Translation', version: 12 },
  };

  it('both doors refuse the same manual fixture', async () => {
    setPage({ data: 'HAND', source: 'manual' });
    const ts = await writePageTranslation(writeArgs);
    const mjs = await writePageTranslationMjs(makeDb(), mjsArgs);
    expect(ts.written).toBe(false);
    expect(mjs.written).toBe(false);
    expect(ts.protected).toBe(true);
    expect(mjs.protected).toBe(true);
    expect(state.updates.length).toBe(0); // neither door touched pages
  });

  it('both doors refuse the same edited_by fixture', async () => {
    setPage({ data: 'EDITED', source: 'batch_api', edited_by: 'derek' });
    const ts = await writePageTranslation(writeArgs);
    const mjs = await writePageTranslationMjs(makeDb(), mjsArgs);
    expect(ts.written).toBe(false);
    expect(mjs.written).toBe(false);
  });

  it('both doors write over plain AI text', async () => {
    setPage({ data: 'old ai', source: 'ai' });
    const ts = await writePageTranslation(writeArgs);
    expect(ts.written).toBe(true);
    setPage({ data: 'old ai', source: 'ai' });
    const mjs = await writePageTranslationMjs(makeDb(), mjsArgs);
    expect(mjs.written).toBe(true);
  });
});
