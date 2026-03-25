import { describe, it, expect, beforeEach } from 'vitest';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { getTestDb, cleanDb } from '../setup';

describe('generateUniqueBookSlug (with DB)', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('returns base slug when no collision', async () => {
    const db = getTestDb();
    const slug = await generateUniqueBookSlug(db, 'Atalanta Fugiens', 'Michael Maier');
    expect(slug).toBe('atalanta-fugiens-maier');
  });

  it('appends -2 on first collision', async () => {
    const db = getTestDb();
    await db.collection('books').insertOne({ slug: 'atalanta-fugiens-maier', title: 'existing' });

    const slug = await generateUniqueBookSlug(db, 'Atalanta Fugiens', 'Michael Maier');
    expect(slug).toBe('atalanta-fugiens-maier-2');
  });

  it('appends -3 when -2 is also taken', async () => {
    const db = getTestDb();
    await db.collection('books').insertOne({ slug: 'atalanta-fugiens-maier', title: 'existing' });
    await db.collection('books').insertOne({ slug: 'atalanta-fugiens-maier-2', title: 'existing2' });

    const slug = await generateUniqueBookSlug(db, 'Atalanta Fugiens', 'Michael Maier');
    expect(slug).toBe('atalanta-fugiens-maier-3');
  });
});
