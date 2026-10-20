import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * #6113, end to end through POST /api/import/iiif: the book the route inserts takes
 * its author and published from the manifest when the candidate has none, and is
 * unchanged when the candidate has them. Fixture: real BSB v2 manifest bsb11021950.
 */
const manifest = JSON.parse(readFileSync(path.join(__dirname, '../fixtures/iiif-bsb11021950-v2.json'), 'utf8'));
const inserted: Record<string, unknown>[] = [];
const gateInputs: Record<string, unknown>[] = [];

vi.mock('@/lib/auth-helpers', () => ({
  withCuratorAuth: (h: (req: unknown, session: unknown) => Promise<Response>) =>
    (req: unknown) => h(req, { user: { email: 'test@example.org' } }),
}));
vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      findOne: async () => null,
      insertOne: async (doc: Record<string, unknown>) => { if (name === 'books') inserted.push(doc); },
      insertMany: async () => {},
    }),
  })),
}));
vi.mock('@/lib/acquisition-guard', () => ({
  acquisitionGate: async (_db: unknown, cand: Record<string, unknown>) => { gateInputs.push(cand); return { ok: true, fingerprints: [] }; },
  confirmClaims: async () => {},
}));
vi.mock('@/lib/slugify', () => ({ generateUniqueBookSlug: async () => 'slug' }));
vi.mock('@/lib/indexnow', () => ({ notifyBookImport: async () => {} }));
vi.mock('@/lib/iiif-manifest-store', () => ({ storeImportedManifest: async () => {} }));

const { POST } = await import('@/app/api/import/iiif/route');

async function importWith(fields: Record<string, unknown>) {
  const req = new Request('http://localhost/api/import/iiif', {
    method: 'POST',
    body: JSON.stringify({
      manifest_url: 'https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb11021950/manifest',
      manifest_data: manifest,
      title: 'Liuzu da shi fa bao tan jing',
      ...fields,
    }),
  });
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(req);
  return { status: res.status, book: inserted.at(-1), gate: gateInputs.at(-1) };
}

beforeEach(() => { inserted.length = 0; gateInputs.length = 0; });

describe('IIIF import author/published fallback (#6113)', () => {
  it('fills an Unknown author and empty published from By and Date', async () => {
    const { status, book, gate } = await importWith({ author: 'Unknown' });
    expect(status).toBe(200);
    expect(book?.author).toBe('Huineng ; Fahai bian');
    expect(book?.published).toBe('[1695]');
    expect(book?.year).toBe(1695);
    expect(book?.place_published).toBe('Guangzhou');
    expect(book?.publisher).toBe('Hai tong si');
    // The dedup gate sees the same author the book is created with.
    expect(gate?.author).toBe('Huineng ; Fahai bian');
  });

  it('accepts a candidate with no author field at all', async () => {
    const { status, book } = await importWith({});
    expect(status).toBe(200);
    expect(book?.author).toBe('Huineng ; Fahai bian');
  });

  it('changes nothing for a candidate that carries author and published', async () => {
    const { book } = await importWith({ author: 'Huineng', published: '1695' });
    expect(book?.author).toBe('Huineng');
    expect(book?.published).toBe('1695');
  });

  it('still refuses when neither candidate nor manifest names an author', async () => {
    const bare = { ...manifest, metadata: [] };
    const req = new Request('http://localhost/api/import/iiif', {
      method: 'POST',
      body: JSON.stringify({ manifest_url: 'https://example.org/m.json', manifest_data: bare, title: 'x' }),
    });
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(req);
    expect(res.status).toBe(400);
  });
});
