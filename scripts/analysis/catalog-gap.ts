/**
 * catalog-gap — cross-reference an external book catalogue (CSV) against the
 * Source Library, reporting which works we HOLD, which need a human REVIEW, and
 * which are MISSING. Built to replace ad-hoc Jaccard matching.
 *
 * Two-stage matcher:
 *   1. Production dedup (`checkDuplicate`) — exact normalized title+author /
 *      fingerprint. High precision → definitive HELD.
 *   2. IDF-weighted, author-gated title cosine over the whole corpus for
 *      everything dedup didn't catch (paraphrased titles, works bound inside
 *      collections). Emits three confidence BANDS, not a binary — the middle
 *      band is a review queue, which is where the old matcher silently erred.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/analysis/catalog-gap.ts \
 *     --csv=/path/to/catalogue.csv --title=title --author=author [--year=order_date] \
 *     [--out=/tmp/gap.csv] [--review=0.45] [--hold=0.68]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { getDb } from '../../src/lib/mongodb';
import { normalizeTitle, normalizeAuthor, checkDuplicate } from '../../src/lib/dedup';

// ---- args ----
const arg = (n: string, d?: string) =>
  process.argv.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const CSV = arg('csv'); const TITLE_COL = arg('title', 'title')!; const AUTHOR_COL = arg('author', 'author')!;
const OUT = arg('out'); const HOLD = parseFloat(arg('hold', '0.68')!); const REVIEW = parseFloat(arg('review', '0.45')!);
if (!CSV) { console.error('--csv=PATH required'); process.exit(1); }

// ---- minimal CSV parser (quoted fields, embedded commas/newlines) ----
function parseCsv(text: string): Record<string,string>[] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  const h = rows.shift()!;
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k,j) => [k, r[j] ?? ''])));
}

const STOP = new Set('the a an of and or de la le und in on to for with its et des du von van dem der das ein no d l vol volume i ii iii iv v part nouvelle edition'.split(' '));
const toks = (s: string) => normalizeTitle(s).split(' ').filter(w => w.length > 2 && !STOP.has(w));
const surname = (a: string) => { // "Last, First" -> last ; "First Last" -> last word
  const n = normalizeAuthor(a || ''); if (!n) return '';
  const raw = (a || '').includes(',') ? a.split(',')[0] : n;
  const w = normalizeAuthor(raw).split(' ').filter(Boolean); return w[w.length - 1] || '';
};
const yearOf = (s?: string) => { const m = (s || '').match(/\b(1[4-9]\d\d|20[0-2]\d)\b/); return m ? +m[1] : undefined; };

(async () => {
  const rows = parseCsv(readFileSync(CSV, 'utf8'));
  // dedupe catalogue rows by normalized title
  const uniq = new Map<string, Record<string,string>>();
  for (const r of rows) { const k = normalizeTitle(r[TITLE_COL] || ''); if (k && !uniq.has(k)) uniq.set(k, r); }
  const cat = [...uniq.values()];

  const db = await getDb();
  const books = await db.collection('books').find({},
    { projection: { id:1, title:1, display_title:1, author:1, published:1, year:1, visible:1, pages_count:1, work_id:1 } }).toArray();

  // IDF over title-token document frequency
  const df = new Map<string, number>();
  const bTok = books.map(b => { const t = [...new Set(toks([b.title, b.display_title].filter(Boolean).join(' ')))];
    for (const w of t) df.set(w, (df.get(w) || 0) + 1); return t; });
  const N = books.length; const idf = (w: string) => Math.log((N + 1) / ((df.get(w) || 0) + 1)) + 1;
  function cos(a: string[], b: string[]): number {
    if (!a.length || !b.length) return 0; const bs = new Set(b);
    let dot = 0, na = 0, nb = 0;
    for (const w of new Set(a)) { const wt = idf(w); na += wt*wt; if (bs.has(w)) dot += wt*wt; }
    for (const w of new Set(b)) { const wt = idf(w); nb += wt*wt; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }
  // index books by author surname for gating
  const bSur = books.map(b => surname(b.author || ''));

  const out: any[] = [];
  for (const r of cat) {
    const title = r[TITLE_COL] || '', author = r[AUTHOR_COL] || '';
    // Stage 1: production dedup (definitive)
    const dd = await checkDuplicate(db, { title, author, year: yearOf(r[arg('year','') || '']) });
    if (dd.isDuplicate) { const m = dd.matches[0];
      const mb = books.find(b => b.id === m.matchedBookId);
      out.push({ status: 'HELD', score: 1, title, author, match: m.matchedTitle, id: m.matchedBookId, via: `dedup:${m.matchType}`, visible: m.matchedVisible, work_id: mb?.work_id || '' }); continue; }
    // Stage 2: IDF cosine + author gate
    const ct = toks(title), csur = surname(author);
    let best = 0, bi = -1;
    for (let i = 0; i < books.length; i++) {
      let s = cos(ct, bTok[i]);
      if (csur && bSur[i]) s *= (csur === bSur[i] ? 1 : 0.6); // author gate: penalise surname mismatch
      if (s > best) { best = s; bi = i; }
    }
    const b = bi >= 0 ? books[bi] : null;
    const status = best >= HOLD ? 'HELD' : best >= REVIEW ? 'REVIEW' : 'MISSING';
    out.push({ status, score: +best.toFixed(2), title, author,
      match: b?.title || '', id: b?.id || '', via: 'idf-cosine', visible: b?.visible, work_id: b?.work_id || '' });
  }

  const by = (s: string) => out.filter(o => o.status === s);
  const withWork = out.filter(o => (o.status === 'HELD' || o.status === 'REVIEW') && o.work_id).length;
  const heldReview = by('HELD').length + by('REVIEW').length;
  console.log(`Catalogue: ${cat.length} unique works  |  HELD ${by('HELD').length}  REVIEW ${by('REVIEW').length}  MISSING ${by('MISSING').length}`);
  console.log(`Work-identity: ${withWork}/${heldReview} matched library books carry a work_id (the rest match by title only — run the #2318 resolver to lift coverage)\n`);
  for (const band of ['MISSING','REVIEW','HELD'] as const) {
    console.log(`=== ${band} ===`);
    for (const o of by(band).sort((a,b)=>b.score-a.score))
      console.log(`  [${o.score}] "${o.title.slice(0,46)}" — ${(o.author||'?').slice(0,22)}` +
        (band !== 'MISSING' ? `  ->  ${(o.match||'').slice(0,42)} (${o.via}${o.visible===false?', hidden':''}) ${o.id}` : ''));
    console.log('');
  }
  if (OUT) {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv = ['status,score,catalog_title,catalog_author,match_title,match_id,via,match_visible,work_id',
      ...out.map(o => [o.status,o.score,o.title,o.author,o.match,o.id,o.via,o.visible,o.work_id].map(esc).join(','))].join('\n');
    writeFileSync(OUT, csv); console.log(`Wrote ${OUT}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
