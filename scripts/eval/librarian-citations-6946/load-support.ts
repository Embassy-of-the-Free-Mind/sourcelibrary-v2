/**
 * Librarian citations (#6946) — replay support for the recorded #6904 answers.
 *
 * PRIOR ART: src/lib/embassy/librarian.ts loadGroundingSupport (the production
 * support set this rebuilds: cited pages, pages read, image pages, cited ±1);
 * scripts/eval/librarian-speed-6904/build-packets.ts (the judge packets of the
 * same answers — translation only, no original, no images). The recorded rows
 * keep the source cards but not the tool results, so two inputs are rebuilt
 * from Mongo here: the support pages (translation + original, as production
 * reads them) and the image records behind every embedded image URL.
 *
 * Known gap against production: the neighbour pages that search hands over
 * with a passage (`retrievedPages`) were not recorded, so they are missing
 * unless the answer cites them or they are ±1 of a cited page.
 *
 * Usage:
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/eval/librarian-citations-6946/load-support.ts --in=<main.jsonl.gz> --out=<support.json.gz> [--arms=B]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { getDb } from '@/lib/mongodb';
import { supportCitations, type GroundingImage, type GroundingPage } from '@/lib/embassy/grounding';
import { findEmbeddedImageUrls } from '@/lib/embassy/citation-fixes';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const inFile = arg('in')!;
const outFile = arg('out')!;
const arms = (arg('arms', 'B') as string).split(',');

type Row = {
  id: string; q: string; arm: string; lang: string; raw: string; final: string; lastTextMs?: number;
  sources: Array<{ book_id: string; bookSlug?: string; bookTitle: string; bookAuthor?: string; pageNumber?: number }>;
};

async function main() {
  const rows: Row[] = zlib.gunzipSync(fs.readFileSync(inFile)).toString('utf8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).filter((r: Row & { error?: string }) => !r.error && arms.includes(r.arm));
  const db = await getDb();
  const out: Record<string, { pages: GroundingPage[]; images: GroundingImage[]; retrieved: string[] }> = {};

  for (const r of rows) {
    const cited = supportCitations(r.raw, []);
    const slugs = [...new Set(cited.map(c => c.slug))];
    const slugToId = new Map<string, string>();
    for (const s of r.sources) if (s.bookSlug) slugToId.set(s.bookSlug, s.book_id);
    if (slugs.length) {
      for (const b of await db.collection('books').find({ $or: [{ slug: { $in: slugs } }, { slug_aliases: { $in: slugs } }, { id: { $in: slugs } }] })
        .project({ id: 1, slug: 1, slug_aliases: 1 }).toArray()) {
        for (const k of [b.slug, b.id, ...(Array.isArray(b.slug_aliases) ? b.slug_aliases : [])]) if (typeof k === 'string') slugToId.set(k, b.id);
      }
    }

    // Images: the gallery row (search_images) or the artwork record (search_artworks).
    const urls = [...new Set(findEmbeddedImageUrls(r.raw))];
    const images: GroundingImage[] = [];
    if (urls.length) {
      const gal = await db.collection('gallery_images').find({ image_url: { $in: urls } })
        .project({ image_url: 1, book_id: 1, book_slug: 1, book_title: 1, book_author: 1, page_number: 1, type: 1, museum_description: 1, description: 1 }).toArray();
      for (const g of gal) {
        images.push({
          url: g.image_url, bookId: g.book_id, bookSlug: g.book_slug || undefined, bookTitle: g.book_title || 'Unknown',
          bookAuthor: g.book_author, page: g.page_number, type: g.type,
          description: String(g.museum_description || g.description || '').slice(0, 300),
        });
      }
      const rest = urls.filter(u => !images.some(i => i.url === u));
      if (rest.length) {
        const arts = await db.collection('books').find({ $or: [{ image_display: { $in: rest } }, { thumbnail: { $in: rest } }, { image_thumb: { $in: rest } }] })
          .project({ id: 1, title: 1, display_title: 1, author: 1, summary_text: 1, image_display: 1, thumbnail: 1, image_thumb: 1 }).toArray();
        for (const a of arts) {
          const url = rest.find(u => [a.image_display, a.thumbnail, a.image_thumb].includes(u))!;
          images.push({
            url, bookTitle: [a.display_title, a.title].filter(Boolean).join(' / ') || 'Untitled', bookAuthor: a.author || undefined,
            description: String(a.summary_text ?? '').split('\n').filter((l: string) => l.trim() && !/^[A-Z][a-z]+:/.test(l)).slice(1, 3).join(' ') || undefined,
          });
        }
      }
    }

    const retrieved = r.sources.filter(s => s.pageNumber).map(s => `${s.book_id}:${s.pageNumber}`);
    const keys = new Set<string>();
    const citedIds = cited.map(c => ({ id: slugToId.get(c.slug), page: c.page })).filter((c): c is { id: string; page: number } => !!c.id);
    for (const c of citedIds) keys.add(`${c.id}:${c.page}`);
    for (const k of retrieved) keys.add(k);
    for (const img of images) if (img.bookId && img.page) keys.add(`${img.bookId}:${img.page}`);
    for (const c of citedIds) for (const n of [c.page - 1, c.page + 1]) if (n >= 1) keys.add(`${c.id}:${n}`);
    const byBook = new Map<string, number[]>();
    for (const key of [...keys].slice(0, 150)) {
      const at = key.lastIndexOf(':');
      byBook.set(key.slice(0, at), [...(byBook.get(key.slice(0, at)) ?? []), Number(key.slice(at + 1))]);
    }
    const localField = r.lang === 'en' ? null : `translations.${r.lang}.data`;
    const [pages, books] = byBook.size ? await Promise.all([
      db.collection('pages').find({ $or: [...byBook].map(([book_id, ps]) => ({ book_id, page_number: { $in: ps } })) })
        .project({ book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1, ...(localField ? { [localField]: 1 } : {}) }).toArray(),
      db.collection('books').find({ id: { $in: [...byBook.keys()] } }).project({ id: 1, slug: 1, slug_aliases: 1, title: 1, display_title: 1 }).toArray(),
    ]) : [[], []];
    const meta = new Map(books.map(b => [b.id as string, b]));
    for (const img of images) {
      const b = img.bookId ? meta.get(img.bookId) : undefined;
      if (b) {
        img.bookAliases = [img.bookSlug, ...(Array.isArray(b.slug_aliases) ? b.slug_aliases : [])].filter((x): x is string => typeof x === 'string' && !!x);
        img.bookSlug = b.slug || img.bookSlug;
      }
    }
    out[`${r.id}:${r.arm}`] = {
      retrieved,
      images,
      pages: pages.map(p => {
        const b = meta.get(p.book_id);
        const local = localField ? (p.translations as Record<string, { data?: string }> | undefined)?.[r.lang]?.data : undefined;
        return {
          bookId: p.book_id, bookSlug: b?.slug || p.book_id, bookTitle: b?.display_title || b?.title || '', page: p.page_number,
          text: [p.translation?.data, p.ocr?.data, local].filter((t): t is string => typeof t === 'string').join('\n'),
          parts: [p.translation?.data, p.ocr?.data, local].map(t => (typeof t === 'string' ? t : '')),
        };
      }),
    };
    console.log(`${r.id}:${r.arm}\tpages=${out[`${r.id}:${r.arm}`].pages.length}\timages=${images.length}/${urls.length}`);
  }
  fs.writeFileSync(outFile, zlib.gzipSync(JSON.stringify(out)));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
