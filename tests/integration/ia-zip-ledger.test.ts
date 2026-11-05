/**
 * IA item zips for the manifest archiver (#5448, inbox note 2026-10-25 23:19): a canvas takes a zip
 * member only when the mapping is proven for the whole book; anything else archives page by page.
 *
 * PRIOR ART: tests/unit/ia-access-leaves*.test.ts pin scandata parsing and the positional refusal for
 * archive-bulk's page-doc path (#3368); nothing pinned a canvas → member mapping for a manifest ledger.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import type { Db } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import { planZipMapping, memberFromPhoto, iaIdFromManifest } from '../../scripts/lib/ia-zip-ledger.mjs';
import { archiveFromManifest } from '../../scripts/lib/manifest-archive.mjs';
import { openLedger } from '../../scripts/lib/manifest-ledger.mjs';
import { initialPagesState } from '../../scripts/lib/lazy-pages.mjs';
import { makeBookDoc } from '../../scripts/lib/book-docs.mjs';

const ID = 'magnalia1680';
const v3 = (n: number) => `https://iiif.archive.org/image/iiif/3/${ID}%2F${ID}_jp2.zip%2F${ID}_jp2%2F${ID}_${String(n).padStart(4, '0')}.jp2/full/max/0/default.jpg`;
const pageN = (n: number) => `https://archive.org/download/${ID}/page/n${n}/full/full/0/default.jpg`;

describe('planZipMapping', () => {
  it('reads the member a v3 canvas URL names', () => {
    expect(memberFromPhoto(v3(4))).toBe(`${ID}_jp2/${ID}_0004.jp2`);
    expect(memberFromPhoto(pageN(4))).toBeNull();
    expect(iaIdFromManifest(`https://iiif.archive.org/iiif/3/${ID}/manifest.json`)).toBe(ID);
  });
  it('exact route: every canvas names its member, ordinals rising (a Color Card leaf 0 is simply never named)', () => {
    const r = planZipMapping([v3(1), v3(2), '', v3(3)]);
    expect(r.route).toBe('exact');
  });
  it('refuses members out of order, and a mixed manifest', () => {
    expect(planZipMapping([v3(2), v3(1)]).route).toBeNull();
    expect(planZipMapping([v3(1), pageN(1)]).reason).toMatch(/mixed/);
  });
  it('scandata route: count must equal canvases, leaves rising, /page/nN must be the position', () => {
    expect(planZipMapping([pageN(0), pageN(1)], [1, 2]).route).toBe('scandata');   // leaf 0 = Color Card, excluded
    expect(planZipMapping([pageN(0), pageN(1)], [1, 2, 3]).reason).toMatch(/3 access leaves for 2 canvases/);
    expect(planZipMapping([pageN(0), pageN(1)], [2, 1]).route).toBeNull();
    expect(planZipMapping([pageN(0), pageN(2)], [1, 2]).reason).toMatch(/n2, not n1/);
    expect(planZipMapping([pageN(0), pageN(1)], null).reason).toMatch(/no parseable scandata/);
  });
});

const jpeg = (w: number) => sharp({ create: { width: w, height: 40, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
const BOOK = 'ia-lazy-book';
const MANIFEST = `https://iiif.archive.org/iiif/3/${ID}/manifest.json`;
const manifest = (photos: string[]) => ({ '@context': 'http://iiif.io/api/presentation/2/context.json', sequences: [{ canvases: photos.map((u, i) => ({ '@id': `c${i}`, images: u ? [{ resource: { '@id': u } }] : [] })) }] });
function store() { const o = new Map<string, Buffer>(); return { o, put: async (k: string, b: Buffer) => { o.set(k, b); return { url: `https://img.example.org/${k}` }; } }; }

describe('archiveFromManifest with an IA item zip', () => {
  let db: Db;
  beforeEach(async () => {
    await cleanDb(); db = getTestDb();
    await db.collection('books').insertOne(makeBookDoc({ id: BOOK, slug: BOOK, title: 'IA lazy', language: 'Latin', visible: false, hidden: true,
      image_source: { provider: 'internet_archive', iiif_manifest: MANIFEST }, pages_count: 3, pages_state: initialPagesState() }));
  });

  it('a proven zip archives every page in one request, recording the JP2 size as native; no IIIF page GET', async () => {
    const s = store();
    const iiifCalls: string[] = [];
    let closed = false;
    const openZip = async () => ({
      route: 'exact', bytes: 123,
      fileFor: (p: number) => `/zip/${ID}_${String(p).padStart(4, '0')}.jp2`,
      decode: async (f: string) => { const w = 100 + Number(f.match(/(\d+)\.jp2$/)![1]); return { buffer: await jpeg(w), width: w, height: 40 }; },
      close: async () => { closed = true; },
    });
    const r = await archiveFromManifest(db, BOOK, { put: s.put, openZip, fetchManifest: async () => manifest([v3(1), v3(2), v3(3)]), download: async (u: string) => { iiifCalls.push(u); return jpeg(9); } });
    expect(r.status).toBe('complete');
    expect(r.zip).toEqual({ route: 'exact', bytes: 123, pages: 3 });
    expect(r.requested).toBe(1);
    expect(iiifCalls).toHaveLength(0);
    expect(closed).toBe(true);
    const book = await db.collection('books').findOne({ id: BOOK });
    const view = openLedger(book!.archive_metadata.manifest_ledger);
    for (const p of [1, 2, 3]) expect(view.dimsOf(p)).toEqual({ width: 100 + p, height: 40, nativeWidth: 100 + p, nativeHeight: 40 });
    expect(await db.collection('pages').countDocuments({ book_id: BOOK })).toBe(0);
  });

  it('a refused zip falls back to per-page IIIF and says why', async () => {
    const s = store();
    const iiifCalls: string[] = [];
    const openZip = async ({ onRefuse }: any) => { onRefuse('scandata has 4 access leaves for 3 canvases'); return null; };
    const r = await archiveFromManifest(db, BOOK, { put: s.put, openZip, fetchManifest: async () => manifest([v3(1), v3(2), v3(3)]), download: async (u: string) => { iiifCalls.push(u); return jpeg(50); } });
    expect(r.zip).toEqual({ refused: 'scandata has 4 access leaves for 3 canvases' });
    expect(iiifCalls).toHaveLength(3);
    expect(r.status).toBe('complete');
  });

  it('a page the zip cannot decode is fetched page by page; the rest come from the zip', async () => {
    const s = store();
    const iiifCalls: string[] = [];
    const openZip = async () => ({
      route: 'exact', bytes: 1, fileFor: (p: number) => `/zip/${p}.jp2`,
      decode: async (f: string) => { if (f.endsWith('/2.jp2')) throw new Error('opj_decompress failed'); return { buffer: await jpeg(70), width: 70, height: 40 }; },
      close: async () => {},
    });
    const r = await archiveFromManifest(db, BOOK, { put: s.put, openZip, fetchManifest: async () => manifest([v3(1), v3(2), v3(3)]), download: async (u: string) => { iiifCalls.push(u); return jpeg(60); } });
    expect(r.zip.pages).toBe(2);
    expect(iiifCalls).toHaveLength(1);
    expect(iiifCalls[0]).toContain('_0002.jp2');
    expect(r.status).toBe('complete');
  });

  it('never opens a zip for a non-IA host', async () => {
    await db.collection('books').updateOne({ id: BOOK }, { $set: { 'image_source.iiif_manifest': 'https://iiif.example.org/m.json' } });
    let opened = false;
    await archiveFromManifest(db, BOOK, { put: store().put, openZip: async () => { opened = true; return null; }, fetchManifest: async () => manifest(['https://img.example.org/1.jpg']), download: async () => jpeg(10) });
    expect(opened).toBe(false);
  });
});
