#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/embed-granularity/build-gold.mjs — it builds gold.json and
 * runs the verbatim-quote gate against the PILOT POOL's copy of each page. Nothing
 * re-checks a quote against the page as it is stored today, resolves the book's slug
 * and title for a reader, or says whose words the English is. This script does those
 * three things and writes the data file the /ideas route renders (#6173).
 *
 * gold.json → src/data/idea-pages.json
 *
 * A passage is KEPT only when all of these hold today:
 *   - its book is live (visible, not hidden, has pages). Partner books are kept: the
 *     main site serves them, and /ideas is refused on partner hosts (tenant-global-paths.ts);
 *   - its page is not flagged unreadable, withheld or stale (`derived-metadata-lane.md`:
 *     a quote is derived from page text, and goes wrong when the text does);
 *   - its quote is a verbatim substring of the page's composed text
 *     (`pageEmbeddingInput`, the text the gold readers read), whitespace folded.
 * Everything dropped is printed with its reason. An idea left with fewer than three
 * traditions is dropped whole.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-granularity/build-idea-pages.mjs          # write
 *   node --env-file=.env.production.local scripts/eval/embed-granularity/build-idea-pages.mjs --check  # re-verify the written file, exit 1 on drift
 */
import fs from 'node:fs';
import { withMongo } from '../../lib/mongo.mjs';
import { pageEmbeddingInput } from '../../lib/page-embedding-text.mjs';
import { translationStaleness } from '../../lib/stale-translation.mjs';

const GOLD = new URL('./gold.json', import.meta.url);
const OUT = new URL('../../../src/data/idea-pages.json', import.meta.url);
const CHECK = process.argv.includes('--check');
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const slugify = (q) => q.split(/[:;]/)[0].toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Whose words the quoted English is. Mirrors `isUnreviewedMachineTranslation` (src/lib/text-provenance.ts). */
function quoteSource(page, hasTranslation) {
  if (!hasTranslation) return 'original';
  const tr = page.translation || {};
  if (tr.edited_by || tr.edited_at) return 'edited';
  if (!tr.model || /-corpus$/.test(tr.model) || tr.source === 'corpus') return 'published';
  return tr.source == null || tr.source === 'ai' || tr.source === 'batch_api' ? 'machine' : 'published';
}

await withMongo(async (db) => {
  const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  const bookIds = [...new Set(gold.queries.flatMap((q) => q.passages.map((p) => p.book_id)))];
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } })
    .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, visible: 1, hidden: 1, pages_count: 1 }).toArray()).map((b) => [b.id, b]));
  const ideas = []; const drops = [];
  for (const q of gold.queries) {
    const passages = [];
    for (const p of q.passages) {
      const drop = (why) => drops.push(`${q.qid} ${p.book_id} p${p.page_number}: ${why}`);
      const b = books.get(p.book_id);
      if (!b || b.visible !== true || b.hidden === true || !(b.pages_count > 0)) { drop('book not live'); continue; }
      const page = await db.collection('pages').findOne({ book_id: p.book_id, page_number: p.page_number },
        { projection: { id: 1, page_number: 1, translation: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1, 'ocr.pipeline': 1, translation_withheld: 1, translation_stale: 1 } });
      if (!page) { drop('no page'); continue; }
      if (page.ocr?.unreadable || page.translation_withheld || page.translation_stale || translationStaleness(page).stale) { drop('page unreadable, withheld or stale'); continue; }
      const composed = pageEmbeddingInput(page);
      if (!composed || !norm(composed.text).includes(norm(p.quote))) { drop('quote not on the page as stored today'); continue; }
      passages.push({
        tradition: p.tradition, quote: norm(p.quote), page_number: p.page_number,
        book_slug: b.slug || b.id, book_title: b.display_title || b.title || '', book_author: b.author || '', book_year: b.year ?? null,
        book_language: b.language || '', source: quoteSource(page, composed.hasTranslation),
      });
    }
    const traditions = [...new Set(passages.map((p) => p.tradition))];
    if (traditions.length < 3) { drops.push(`${q.qid}: only ${traditions.length} traditions left — idea dropped`); continue; }
    ideas.push({ id: q.qid, slug: slugify(q.query), title: q.query, passages });
  }
  const slugs = new Set(ideas.map((i) => i.slug));
  if (slugs.size !== ideas.length) throw new Error('two ideas share a slug');
  const body = { source: 'scripts/eval/embed-granularity/gold.json', issue: 6173, ideas };
  for (const d of drops) console.log('DROP', d);
  const n = ideas.reduce((s, i) => s + i.passages.length, 0);
  const bySource = {};
  for (const i of ideas) for (const p of i.passages) bySource[p.source] = (bySource[p.source] || 0) + 1;
  console.log(`${ideas.length} ideas, ${n} passages kept, ${drops.length} dropped; quote source: ${JSON.stringify(bySource)}`);
  if (CHECK) {
    const on = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const same = JSON.stringify(on.ideas) === JSON.stringify(ideas);
    console.log(same ? 'CHECK ok: the written file matches the stores' : 'CHECK FAILED: src/data/idea-pages.json no longer matches the stores; rebuild and re-read the diff');
    process.exitCode = same ? 0 : 1;
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify({ ...body, verified_on: new Date().toISOString().slice(0, 10) }, null, 1) + '\n');
}, { timeoutMs: 600000 });
