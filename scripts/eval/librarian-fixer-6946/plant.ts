/**
 * Librarian citation fixer (#6946) — planted-error controls: seeded positives the fixer must catch
 * (measurement-instruments.md: a judge or screen is validated on seeded positives, not on agreement).
 *
 * From replay answers outside the dev set, seeded by a fixed string so a rerun plants the same errors:
 *  - 40 answers with at least two page links BOTH pre-fix judges call `cited`;
 *  - in each, one such link moved to an ADJACENT page of the same book (±1 or ±2, the page must exist);
 *  - in 20 of them, a second such link moved to a page of ANOTHER book read in that turn.
 * The planted link is rewritten the way a real wrong link reads (citation-fixer's own move: URL, label, and
 * for another book the title link), and the planted page plus its ±1 neighbours are loaded into the turn's
 * pages, as the gauge loads a cited page — so the fixer is not handed "page not loaded".
 * The ORIGINAL page stays among the pages (it was read that turn), so the right answer is on the table.
 *
 * Writes <out>/planted-items.jsonl.gz (items, before = the original labels with the planted links marked)
 * and <out>/planted.json (key, link id, kind, from, to).
 *
 * PRIOR ART: none for planting in this harness — scripts/eval/librarian-citations-6946/ measured on natural
 * errors only; the move itself reuses fixerEdits (src/lib/embassy/citation-fixer.ts).
 *
 * Usage: npx tsx --env-file=/root/sourcelibrary/.env.production.local scripts/eval/librarian-fixer-6946/plant.ts \
 *          --items=<items.jsonl.gz> --out=<dir> [--exclude=<regex of dev keys>]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { findPageLinks } from '@/lib/embassy/citation-pages';
import { fixerEdits, type LinkOutcome } from '@/lib/embassy/citation-fixer';
import { applyGroundingEdits } from '@/lib/embassy/citation-fixes';
import { loadSupportPages } from '@/lib/embassy/librarian';
import type { GroundingPage } from '@/lib/embassy/grounding';
import type { Item } from './build-items';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const readMaybeGz = (f: string) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8');
const OUT = arg('out')!;
const EXCLUDE = arg('exclude') ? new RegExp(arg('exclude')!) : null;
const N_ANSWERS = 40;
const N_OTHER = 20;

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1e9) / 1e9; };
}

async function main() {
  const rand = rng('librarian-fixer-6946-planted');
  const items: Item[] = readMaybeGz(arg('items')!).split('\n').filter(Boolean).map(l => JSON.parse(l));
  const pool = items.filter(it => it.before && !(EXCLUDE?.test(it.key)))
    .filter(it => it.before!.filter(l => l.label === 'cited' && l.j.every(x => x === 'cited')).length >= 2);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

  const outItems: Item[] = [];
  const planted: Array<{ key: string; id: string; kind: 'adjacent' | 'other_book'; from: { slug: string; page: number }; to: { slug: string; page: number } }> = [];
  let others = 0;
  for (const it of pool) {
    if (outItems.length >= N_ANSWERS) break;
    const links = findPageLinks(it.text);
    const cited = it.before!.map((l, k) => ({ l, k })).filter(({ l }) => l.label === 'cited' && l.j.every(x => x === 'cited'));
    const order = [...cited].sort(() => rand() - 0.5);
    const pageOf = (k: number) => it.pages.find(p => p.page === links[k].page && p.bookSlug === links[k].slug);

    // Adjacent: the first cited link (seeded order) whose ±1/±2 page exists in Mongo.
    let adj: { k: number; to: GroundingPage } | null = null;
    for (const { k } of order) {
      const own = pageOf(k);
      if (!own) continue;
      for (const d of [[1, -1, 2, -2], [-1, 1, -2, 2]][Math.floor(rand() * 2)]) {
        const target = own.page + d;
        if (target < 1) continue;
        const [p] = await loadSupportPages([`${own.bookId}:${target}`], it.lang);
        if (p && p.text.trim().length > 200) { adj = { k, to: p }; break; }
      }
      if (adj) break;
    }
    if (!adj) continue;

    // Another book: a second cited link, moved to a page of another book read that turn.
    let oth: { k: number; to: GroundingPage } | null = null;
    if (others < N_OTHER) {
      for (const { k } of order) {
        if (k === adj.k) continue;
        const own = pageOf(k);
        if (!own) continue;
        const cands = it.pages.filter(p => p.bookId !== own.bookId && p.page >= 1 && p.text.trim().length > 200);
        if (cands.length === 0) continue;
        oth = { k, to: cands[Math.floor(rand() * cands.length)] };
        break;
      }
    }

    const moves = [adj, ...(oth ? [oth] : [])];
    const outcomes = moves.map(m => ({ id: `L${m.k + 1}`, link: links[m.k], action: 'move', outcome: 'move', to: m.to })) as LinkOutcome[];
    const text = applyGroundingEdits(it.text, fixerEdits(it.text, outcomes, it.lang));
    if (findPageLinks(text).length !== links.length) throw new Error(`${it.key}: planting changed the link count`);
    // The planted page and its neighbours, loaded as the gauge loads a cited page.
    const have = new Set(it.pages.map(p => `${p.bookId}:${p.page}`));
    const want = moves.flatMap(m => [m.to.page - 1, m.to.page, m.to.page + 1].filter(n => n >= 1).map(n => `${m.to.bookId}:${n}`)).filter(k => !have.has(k));
    const extra = want.length ? await loadSupportPages(want, it.lang) : [];
    const key = `planted:${it.key}`;
    outItems.push({ ...it, key, text, pages: [...it.pages, ...extra], before: it.before!.map((l, k) => (moves.some(m => m.k === k) ? { ...l, label: 'planted', j: ['planted'] } : l)) });
    planted.push({ key, id: `L${adj.k + 1}`, kind: 'adjacent', from: { slug: links[adj.k].slug, page: links[adj.k].page }, to: { slug: adj.to.bookSlug, page: adj.to.page } });
    if (oth) {
      others++;
      planted.push({ key, id: `L${oth.k + 1}`, kind: 'other_book', from: { slug: links[oth.k].slug, page: links[oth.k].page }, to: { slug: oth.to.bookSlug, page: oth.to.page } });
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'planted-items.jsonl.gz'), zlib.gzipSync(outItems.map(i => JSON.stringify(i)).join('\n') + '\n'));
  fs.writeFileSync(path.join(OUT, 'planted.json'), JSON.stringify(planted, null, 1));
  console.log(`${outItems.length} answers, ${planted.filter(p => p.kind === 'adjacent').length} adjacent + ${planted.filter(p => p.kind === 'other_book').length} other-book planted (pool ${pool.length})`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
