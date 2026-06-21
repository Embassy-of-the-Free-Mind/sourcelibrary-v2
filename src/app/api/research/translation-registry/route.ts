import { NextResponse } from 'next/server';
import registry from '@/app/research/translation-registry/registry-data.json';

// Server-side search/filter/paginate so the client never downloads the full
// ~1,600-work dataset — only a page of 50 at a time (cf. IndexCatalogWorksTable).
// Reads query params at request time; the data itself is a static import.

type Work = (typeof registry.works)[number];
const ALL = registry.works as Work[];
const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get('q') || '').trim().toLowerCase();
  const held = sp.get('held') || 'all';      // all | work | author | none
  const era = sp.get('era') || 'all';        // all | modern | historical | period
  const ren = sp.get('ren') === '1';
  const page = Math.max(0, parseInt(sp.get('page') || '0') || 0);

  let r = ALL;
  if (ren) r = r.filter((w) => w.tgt);
  if (held !== 'all') r = r.filter((w) => w.h === held);
  if (era === 'modern') r = r.filter((w) => w.tmax != null && w.tmax >= 1900);
  else if (era === 'historical') r = r.filter((w) => w.tmax != null && w.tmax < 1900);
  else if (era === 'period') r = r.filter((w) => w.tmin != null && w.tmin <= 1700);
  if (q) {
    r = r.filter(
      (w) =>
        w.a.toLowerCase().includes(q) ||
        w.w.toLowerCase().includes(q) ||
        (w.wl || '').toLowerCase().includes(q) ||
        w.c.some((c) => (c.tr || '').toLowerCase().includes(q)),
    );
  }

  const total = r.length;
  const works = r.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return NextResponse.json({ works, total, page, pageSize: PAGE_SIZE });
}
