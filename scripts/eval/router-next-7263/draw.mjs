#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs drawRouterTests — its sample.json shape, one page per book,
// interior / >= 300 chars / not handwritten page rule and Paddle lane holds are reused. It does not fit as is: it walks
// books in a uniform seeded order over a frame that is not the router cell's census (latin-flash3 is any 3 Flash page of
// a visible Latin book; zh-dice keys Paddle on ocr.source and books the Paddle lane logged). This draws from the cell's
// own pages-waiting census (scripts/eval/estimator/chain/volumes-by-draft.mjs buckets) with books weighted by reads.
/**
 * Router test-next on WAITING pages (#7263, job router-next-7263). One page per book, books drawn without replacement
 * with probability proportional to read_count + 1 (allocate_v2.py's weight; Efraimidis-Spirakis keys, seeded), from
 * the cell's census frame:
 *   latin-lite    Latin books (visible, pages_count > 0, pages_ocr > 0); page ocr.model /flash-lite/
 *   latin-flash3  the same books; page ocr.model /^gemini-3-flash/ (the census bucket order: flash-lite matched first)
 *   zh-dice       Chinese books; page ocr.model /paddle/i, not ocr.pipeline paddle-zh-guarded-2026-10, ocr.qa_screen.dice < 0.90
 * Page rule (judge.mjs's): page_number > 0, interior, not translation_withheld, not a skip page type, OCR >= 300 chars
 * and not handwritten (Chinese: >= 40 Han; the Siku copy is a manuscript), not unreadable. Left out: books under a pipeline hold or status held (the
 * Paddle lane's OCR-only holds allowed, as judge.mjs zh-dice), unsplit spread books (#7605), and the wrong-leaf book
 * 69bd9d05 (#7611). Script type (Derek, 2026-10-28): the page must be PRINT in the Latin cells, MANUSCRIPT in zh-dice (the Siku
 * Wenyuange copy), by script-type.mjs (page field, tag, book majority). Writes DIR/sample.json in judge.mjs's router-test shape, the agy route only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/router-next-7263/draw.mjs --out=DIR [--n=34] [--n-zh=36]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { contentHash } from '../../lib/write-provenance.mjs';
import { SKIP_TRANSLATION_PAGE_TYPES } from '../../lib/translate-core.mjs';
import { isInterior, bodyText, foldHan } from '../ground-truth-5935/lib.mjs';
import { classifyPages } from './script-type.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out'));
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const unit = (s) => (parseInt(h(s).slice(0, 13), 16) + 0.5) / 2 ** 52;
const EXCLUDE = /^69bd9d05/;
const LANE_HOLDS = /^(paddle-zh-(5600|6388)-ocr-only|gpu-backlog-5660)$/;
const CELLS = {
  'latin-lite': { lang: 'Latin', n: Number(arg('n') || 34), model: /flash-lite/, draft: 'lite', route: 'agy-flash-low', cor: { by: 'agy', model: 'gemini-3.8-flash-low', fresh: true }, hand: 'print', router: ['latin-lite', 'agy-flash-low-read'] },
  'latin-flash3': { lang: 'Latin', n: Number(arg('n') || 34), model: /^gemini-3-flash/, not: /flash-lite/, draft: '3flash', route: '3flash>agy-flash-low', cor: { by: 'agy', model: 'gemini-3.8-flash-low' }, hand: 'print', router: ['latin-flash3', '3flash>agy-flash-low'] },
  'zh-dice': { lang: 'Chinese', n: Number(arg('n-zh') || 36), model: /paddle/i, draft: 'paddle', route: 'paddle>agy-flash-high', cor: { by: 'agy', model: 'gemini-3.8-flash-high' }, kanripo: true, hand: 'manuscript', router: ['zh-paddle-dice-lt090', 'paddle>agy-flash-high'] },
};
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, translation_withheld: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.pipeline': 1, 'ocr.unreadable': 1, 'ocr.qa_screen': 1 };
const cells = fs.existsSync(path.join(OUT, 'sample.json')) && arg('cells') ? JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8')).cells : {};
for (const [name, t] of Object.entries(CELLS).filter(([k]) => !arg('cells') || arg('cells').split(',').includes(k))) {
  const books = await db.collection('books').find({ language: t.lang, visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } },
    { projection: { _id: 0, id: 1, read_count: 1, pages_count: 1, pipeline_auto: 1, needs_splitting: 1, split_completed: 1 } }).toArray();
  const salt = `rn-7263-${name}`;
  const order = books.map((b) => ({ b, key: -Math.log(unit(salt + b.id)) / ((b.read_count || 0) + 1) })).sort((x, y) => x.key - y.key).map((x) => x.b);
  const pages = [], tally = { frame_books: books.length, books_walked: 0, held: 0, unsplit: 0, excluded: 0, no_waiting_page: 0 };
  for (const b of order) {
    if (pages.length >= t.n) break;
    tally.books_walked++;
    const hold = b.pipeline_auto?.hold;
    if (EXCLUDE.test(b.id)) { tally.excluded++; continue; }
    if ((hold || b.pipeline_auto?.status === 'held') && !(t.kanripo && hold && LANE_HOLDS.test(hold.reason))) { tally.held++; continue; }
    if (b.needs_splitting && !b.split_completed) { tally.unsplit++; continue; }
    const q = { book_id: b.id, page_number: { $gt: 0 }, 'ocr.model': t.model };
    if (t.kanripo) Object.assign(q, { 'ocr.pipeline': { $ne: 'paddle-zh-guarded-2026-10' }, 'ocr.qa_screen.dice': { $lt: 0.9 } });
    const ps = (await db.collection('pages').find(q, { projection: PROJ }).toArray()).filter((p) => !(t.not?.test(p.ocr.model))
      && !p.translation_withheld && !SKIP_TRANSLATION_PAGE_TYPES.includes(p.page_type) && isInterior(p.page_number, b.pages_count)
      && typeof p.ocr.data === 'string' && !p.ocr.unreadable
      // the Siku pages are the Wenyuange MANUSCRIPT copy (<script>handwritten): judge.mjs zh-dice has no handwritten rule
      && (t.kanripo ? typeof p.ocr.qa_screen?.dice === 'number' && [...foldHan(bodyText(p.ocr.data))].length >= 40 : p.ocr.data.length >= 300 && !/<script>\s*handwritten/i.test(p.ocr.data)));
    if (!ps.length) { tally.no_waiting_page++; continue; }
    const p = ps.sort((x, y) => h(salt + x.id).localeCompare(h(salt + y.id)))[0];
    // script-type split (Derek, inbox 2026-10-28 11:54Z): Latin cells draw PRINT pages, the Siku cell its manuscripts
    const st = (await classifyPages(db, [p.id])).get(p.id);
    if (st.cls !== t.hand) { tally[`not_${t.hand}`] = (tally[`not_${t.hand}`] || 0) + 1; continue; }
    pages.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, draft_model: p.ocr.model, draft_sha: contentHash(p.ocr.data), book_reads: b.read_count || 0,
      waiting_in_book: ps.length, script: st.cls, script_basis: st.basis, ...(t.kanripo ? { qa_dice: p.ocr.qa_screen.dice, qa_pb: p.ocr.qa_screen.pb ?? null } : {}) });
  }
  const served = { [t.route]: t.cor.fresh ? `this run's fresh read of the image, waiting page (${t.cor.by} ${t.cor.model})` : `this run's correction of the stored draft, waiting page (${t.cor.by} ${t.cor.model})` };
  cells[name] = { task: 'ocr', lang: t.lang, paired: true, kind: 'router-test', draft_route: t.draft, routes: [t.route], correctors: { [t.route]: t.cor }, kanripo: !!t.kanripo, served, router_cell: t.router[0], router_route: t.router[1], pages,
    frame: { ...tally, hand: t.hand, salt, weight: 'read_count + 1, without replacement (Efraimidis-Spirakis)', rule: `census bucket ${t.model}${t.kanripo ? ', not the guarded apply, dice < 0.90, >= 40 Han' : ', >= 300 chars'}; interior, not withheld or a skip type${t.kanripo ? '' : ', not handwritten'}; held / unsplit / 69bd9d05 left out` } };
  console.log(`${name}: ${pages.length} pages in ${new Set(pages.map((p) => p.book_id)).size} books; reads median ${pages.map((p) => p.book_reads).sort((a, b) => a - b)[pages.length >> 1]}; ${JSON.stringify(tally)}`);
}
await c.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify({ drawn_at: new Date().toISOString(), router_tests: true, job: 'router-next-7263', cells }, null, 1));
