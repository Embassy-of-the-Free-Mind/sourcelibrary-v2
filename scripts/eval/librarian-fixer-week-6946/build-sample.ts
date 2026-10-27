/**
 * One-week review of the citation fixer's dry run (#6946): draw the stratified link sample that the Gemini
 * cross-label (label-gemini.mjs) and the by-reading check both use.
 *
 * Reads `librarian_citation_fixes` (the dry-run worker's rows), `embassy_messages` (the answer text), `books` and
 * `pages`. Writes nothing to Mongo. Output: one JSON line per sampled link, with the claim in context (the
 * answer's paragraph, the link marked ⟦THIS LINK⟧), the whole linked page and, for a move, the whole target page.
 *
 * Strata by the fixer's validated outcome: keep (`keep`), move (`move`), drop (`drop` + `drop_unverified`).
 * Left out: caption / not_loaded / no_verdict / keep_span_short, which the fixer leaves as written.
 *
 * PRIOR ART: scripts/eval/librarian-fixer-6946/build-items.ts (builds the replay's judge items from the eval's
 * recorded tool results, not from the live dry-run rows) and scripts/workers/librarian-citation-fixer.ts (the page
 * set; reused here through the same loadSupportPages / readablePages calls).
 *
 * Usage: npx tsx --env-file=/root/sourcelibrary/.env.production.local scripts/eval/librarian-fixer-week-6946/build-sample.ts \
 *          --out=$JOB_SCRATCH/sample.jsonl [--keep=37 --move=26 --drop=37 --seed=6946]
 */
import fs from 'node:fs';
import { getDb } from '@/lib/mongodb';
import { findPageLinks } from '@/lib/embassy/citation-pages';
import { readablePages } from '@/lib/embassy/citation-fixer';
import { loadSupportPages, resolveBookIds } from '@/lib/embassy/librarian';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const OUT = arg('out')!;
const N = { keep: Number(arg('keep', '37')), move: Number(arg('move', '26')), drop: Number(arg('drop', '37')) };
let seed = Number(arg('seed', '6946'));
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const stratum = (o: string) => o === 'keep' ? 'keep' : o === 'move' ? 'move' : o === 'drop' || o === 'drop_unverified' ? 'drop' : null;

/** The paragraph holding the link; the one before too when this one is only a citation line. */
function context(text: string, start: number, end: number): string {
  const ps = text.lastIndexOf('\n\n', start);
  const pe = text.indexOf('\n\n', end);
  let s = ps === -1 ? 0 : ps + 2;
  const e = pe === -1 ? text.length : pe;
  const own = text.slice(s, e).replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/[—*_\s,.]/g, '');
  if (own.length < 60 && s > 0) { const pp = text.lastIndexOf('\n\n', s - 3); s = pp === -1 ? 0 : pp + 2; }
  return `${text.slice(s, end)} ⟦THIS LINK⟧${text.slice(end, e)}`;
}

async function main() {
  const db = await getDb();
  const rows = await db.collection('librarian_citation_fixes').find({ status: { $in: ['proposed', 'no_change'] } }).sort({ messageId: 1 }).toArray();
  const pool: Record<string, Array<{ row: (typeof rows)[number]; o: Record<string, unknown> & { id: string; outcome: string } }>> = { keep: [], move: [], drop: [] };
  for (const row of rows) for (const o of row.outcomes ?? []) { const s = stratum(o.outcome); if (s) pool[s].push({ row, o }); }
  const picked = (Object.keys(N) as Array<keyof typeof N>).flatMap(s => shuffle([...pool[s]]).slice(0, N[s]).map(x => ({ ...x, stratum: s })));
  const lines: string[] = [];
  for (const { row, o, stratum: s } of picked) {
    const m = await db.collection('embassy_messages').findOne({ _id: row.messageId }, { projection: { content: 1, sources: 1 } });
    const text = String(m?.content ?? '');
    const links = findPageLinks(text);
    const link = links[Number(o.id.slice(1)) - 1];
    if (!link || link.url !== o.url) { console.error('link mismatch', String(row.messageId), o.id); continue; }
    const toSlug = typeof o.to === 'string' ? o.to.slice(0, o.to.lastIndexOf(':')) : null;
    const toPage = typeof o.to === 'string' ? Number(o.to.slice(o.to.lastIndexOf(':') + 1)) : null;
    const ids = await resolveBookIds([...new Set([link.slug, ...(toSlug ? [toSlug] : [])])], []);
    const keys = [`${ids.get(link.slug)}:${link.page}`, ...(toSlug ? [`${ids.get(toSlug)}:${toPage}`] : [])];
    const pages = readablePages(await loadSupportPages(keys, row.lang === 'es' ? 'es' : 'en'));
    const find = (slug: string, page: number) => pages.find(p => p.page === page && (p.bookSlug === slug || p.bookId === ids.get(slug)));
    const linked = find(link.slug, link.page);
    const target = toSlug ? find(toSlug, toPage!) : null;
    lines.push(JSON.stringify({
      key: `${row.messageId}:${o.id}`, stratum: s, outcome: o.outcome, action: o.action, lang: row.lang,
      messageAt: row.messageAt, url: o.url, label: link.label, fixer_span: o.span ?? null, fixer_claim: o.claim ?? null, to: o.to ?? null,
      context: context(text, link.start, link.end),
      linked: linked ? { ref: `${linked.bookSlug}:${linked.page}`, title: linked.bookTitle, parts: linked.parts } : null,
      target: target ? { ref: `${target.bookSlug}:${target.page}`, title: target.bookTitle, parts: target.parts } : null,
    }));
  }
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ pool: Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, v.length])), written: lines.length, out: OUT }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
