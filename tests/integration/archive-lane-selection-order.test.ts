/**
 * Selection order inside an archive lane (#5448 step 5): live books, then tier A, then the rest,
 * each tier in rotation order, and no book drawn twice.
 *
 * PRIOR ART: tests/unit/archive-miss.test.ts pins ROTATION_SORT on its own; nothing pinned which
 * books a lane reaches FIRST, which is what decided that a reader-facing book could wait behind a
 * hidden wave.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getTestDb, cleanDb } from '../setup';
import { laneSelectionTiers } from '../../scripts/catalog-coverage/archive-lanes.mjs';
import { ROTATION_SORT, notCoolingDown, cooldownUntil } from '../../scripts/lib/archive-miss.mjs';

const TIER_A = 'acquisition-wave-2026-10b';
const t = (min: number) => new Date(Date.UTC(2026, 9, 25, 0, min));

const BOOKS = [
  { id: 'rest-old', visible: false, acquisition_campaign: 'acquisition-wave-2026-10', archive_metadata: { last_attempt_at: t(1) } },
  { id: 'tierA-new', visible: false, acquisition_campaign: TIER_A, archive_metadata: { last_attempt_at: t(30) } },
  { id: 'live-new', visible: true, archive_metadata: { last_attempt_at: t(50) } },
  { id: 'rest-untried', visible: false },
  { id: 'tierA-old', visible: false, acquisition_campaign: TIER_A, archive_metadata: { last_attempt_at: t(2) } },
  { id: 'live-tierA', visible: true, acquisition_campaign: TIER_A, archive_metadata: { last_attempt_at: t(3) } },
  { id: 'live-untried', visible: true },
  { id: 'no-visible-field', acquisition_campaign: 'x' },
].map(b => ({ ...b, 'image_source': { provider: 'sbb' }, pages_count: 10 }));

async function drawAll(batch: number) {
  const out: string[] = [];
  for (const tier of laneSelectionTiers({ tierACampaign: TIER_A })) {
    const want = batch - out.length;
    if (want <= 0) break;
    const got = await getTestDb().collection('books')
      .find({ 'image_source.provider': { $in: ['sbb'] }, ...tier.filter }).sort(ROTATION_SORT).limit(want).toArray();
    out.push(...got.map(b => b.id));
  }
  return out;
}

describe('archive lane selection order (#5448 step 5)', () => {
  beforeEach(async () => { await cleanDb(); await getTestDb().collection('books').insertMany(BOOKS.map(b => ({ ...b }))); });

  it('live first, then tier A, then the rest; rotation order inside each tier', async () => {
    expect(await drawAll(100)).toEqual([
      'live-untried', 'live-tierA', 'live-new',
      'tierA-old', 'tierA-new',
      'rest-untried', 'no-visible-field', 'rest-old', // untried ties keep insertion order
    ]);
  });

  it('a small batch is filled from the top tiers only', async () => {
    expect(await drawAll(4)).toEqual(['live-untried', 'live-tierA', 'live-new', 'tierA-old']);
  });

  it('the tiers partition the lane: every book exactly once', async () => {
    const ids = await drawAll(100);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(BOOKS.length);
  });

  it('archive-acquired draws lane mode through these tiers, in this order', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/catalog-coverage/archive-acquired.ts'), 'utf8');
    expect(src).toContain('laneSelectionTiers({ tierACampaign: TIER_A_CAMPAIGN })');
    expect(src).toMatch(/for \(const tier of selectionTiers\(\)\) \{[\s\S]{0,400}\{ \.\.\.bookModeFilter, \.\.\.tier\.filter \}[\s\S]{0,120}\.sort\(ROTATION_SORT\)/);
  });
});

describe('a book the last run could not advance sits out the draw for a day (lane-gallica, 2026-10-27)', () => {
  const NOW = new Date(Date.UTC(2026, 9, 27, 21, 0));
  const draw = async () => (await getTestDb().collection('books')
    .find({ 'image_source.provider': 'gallica', ...notCoolingDown(NOW) }).sort(ROTATION_SORT).toArray()).map(b => b.id);
  beforeEach(async () => {
    await cleanDb();
    await getTestDb().collection('books').insertMany([
      { id: 'dead-cooling', archive_metadata: { last_attempt_at: t(1), cooldown_until: cooldownUntil(new Date(NOW.getTime() - 3600e3)) } },
      { id: 'dead-expired', archive_metadata: { last_attempt_at: t(2), cooldown_until: new Date(NOW.getTime() - 60e3) } },
      { id: 'never-cooled', archive_metadata: { last_attempt_at: t(3) } },
      { id: 'untried' },
    ].map(b => ({ ...b, image_source: { provider: 'gallica' }, pages_count: 10, visible: true })));
  });

  it('a cooling book is not drawn; an expired cooldown and books without one are', async () => {
    expect(await draw()).toEqual(['untried', 'dead-expired', 'never-cooled']);
  });

  it('negative control: without the filter the cooling book heads the draw again', async () => {
    const ids = (await getTestDb().collection('books').find({ 'image_source.provider': 'gallica' }).sort(ROTATION_SORT).toArray()).map(b => b.id);
    expect(ids).toContain('dead-cooling');
  });

  it('archive-acquired applies the filter to every book-mode draw except a named --book', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/catalog-coverage/archive-acquired.ts'), 'utf8');
    expect(src).toContain('...(BOOK_IDS ? {} : notCoolingDown()),');
    expect(src).toMatch(/'archive_metadata\.cooldown_until': cooldownUntil\(\)/);
  });
});
