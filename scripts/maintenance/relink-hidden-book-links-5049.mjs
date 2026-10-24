#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/authored-links-hidden-books.mjs (#5049, PR #6680) finds the links and
 * names the visible keeper (`duplicate_of`); it never writes. This consumes its --json report.
 * scripts/maintenance/check-blog-links.mjs checks HTTP status only. No existing script rewrites a
 * /book/ link, and none maps a page of one scan to the same page of another.
 *
 * relink-hidden-book-links-5049 — point authored links at a hidden duplicate to its visible keeper.
 *
 * A link with a page anchor (`?page=N`, `/page/<pageId>`) cites one leaf, and two scans of the same
 * edition do not share page numbers. The leaf is mapped by its transcription: the keeper page whose
 * OCR shares the most letter trigrams with the hidden page (Dice). A map is accepted only when the
 * best score is ≥ MIN_DICE and beats the runner-up by ≥ MIN_MARGIN; otherwise the link is left as it
 * is and listed. A link without an anchor is relinked to the keeper's slug.
 *
 * Writes:
 *   files        (--apply-files) the source files under src/, rewritten in place, for a PR
 *   collections  (--apply) `mentioned_books[].book_id` (an entry whose keeper is already listed is
 *                removed instead) and `/book/` links inside `expanded_description`; the prior values
 *                go to sweep_log first (sweep `relink-hidden-5049`, one row per collection and field,
 *                book_id = the hidden book, `detail.before`).
 * Undo (collections): --undo [--apply] restores each field from its sweep_log row. Files: git revert.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/authored-links-hidden-books.mjs --json > report.json
 *   node --env-file=.env.production.local scripts/maintenance/relink-hidden-book-links-5049.mjs --report report.json [--apply-files] [--apply]
 */
import fs from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const arg = (f) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : null; };
const SWEEP = 'relink-hidden-5049';
export const MIN_DICE = 0.5;
export const MIN_MARGIN = 0.15;

/**
 * Keepers that are not the same work, read 2026-10-15 (#5049): `duplicate_of` points at another record.
 *   Bacchus (1598) → "Bacchus, Detail" (1593): a different Caravaggio painting.
 *   Herculanensium Voluminum quae supersunt Tomus I (1793) → the Collectio Altera, a different series.
 */
export const EXCLUDE = new Set(['69e750c1e9fa5d38dc77d50a', '6a3eb51f52a609ebd566b34a']);

const trigrams = (s) => {
  const t = String(s || '').replace(/<[^>]+>/g, ' ').toLowerCase().replace(/[^\p{L}]+/gu, ' ').slice(0, 4000);
  const m = new Map();
  for (let i = 0; i + 3 <= t.length; i++) { const g = t.slice(i, i + 3); m.set(g, (m.get(g) || 0) + 1); }
  return m;
};
export function dice(a, b) {
  let inter = 0, na = 0, nb = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  for (const [g, v] of a) inter += Math.min(v, b.get(g) || 0);
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books'), pages = db.collection('pages'), cols = db.collection('collections');
try {
  if (has('undo')) {
    const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'relinked' }).sort({ timestamp: -1 }).toArray();
    console.log(`${rows.length} collection fields to restore — ${has('apply') ? 'APPLY' : 'dry run'}`);
    if (has('apply')) for (const r of rows) await cols.updateOne({ slug: r.detail.collection }, { $set: { [r.detail.field]: r.detail.before } });
    process.exit(0);
  }
  const report = JSON.parse(fs.readFileSync(arg('report'), 'utf8'));
  const resolveBook = async (ref) => {
    const or = [{ slug: ref }, { id: ref }];
    if (/^[0-9a-f]{24}$/i.test(ref)) or.push({ _id: new ObjectId(ref) });
    return (await books.findOne({ $or: or }, { projection: { id: 1, slug: 1, title: 1 } })) || books.findOne({ slug_aliases: ref }, { projection: { id: 1, slug: 1, title: 1 } });
  };
  const keeperPages = new Map();
  const loadKeeper = async (id) => {
    if (!keeperPages.has(id)) keeperPages.set(id, (await pages.find({ book_id: id }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).toArray()).map((p) => ({ id: p.id || String(p._id), n: p.page_number, g: trigrams(p.ocr?.data) })));
    return keeperPages.get(id);
  };
  /** Map one hidden page (by number or id) to the keeper page; null when no clear match. */
  const mapPage = async (hiddenId, keeperId, by) => {
    const q = by.n != null ? { book_id: hiddenId, page_number: by.n } : { $or: [{ id: by.id }, ...(/^[0-9a-f]{24}$/i.test(by.id) ? [{ _id: new ObjectId(by.id) }] : [])] };
    const hp = await pages.findOne(q, { projection: { page_number: 1, 'ocr.data': 1, book_id: 1 } });
    if (!hp?.ocr?.data) return { ok: false, why: hp ? 'hidden page has no transcription' : 'hidden page not found' };
    const g = trigrams(hp.ocr.data);
    const scored = (await loadKeeper(keeperId)).map((k) => ({ k, s: dice(g, k.g) })).sort((a, b) => b.s - a.s);
    const [best, second] = scored;
    const margin = best.s - (second?.s || 0);
    if (best.s < MIN_DICE || margin < MIN_MARGIN) return { ok: false, why: `no clear match (best ${best.s.toFixed(2)} p.${best.k.n}, margin ${margin.toFixed(2)})`, from: hp.page_number };
    return { ok: true, from: hp.page_number, to: best.k, score: best.s, margin };
  };

  const plan = [];      // { ref, hidden, keeper, where }
  const skipped = [];
  for (const h of report.hidden) {
    if (!h.visible_keeper) continue;
    const hidden = await resolveBook(h.ref);
    if (EXCLUDE.has(hidden.id)) { skipped.push({ ref: h.ref, why: 'keeper is not the same work', where: h.where }); continue; }
    const keeper = await books.findOne({ $or: [{ slug: h.visible_keeper }, { id: h.visible_keeper }], visible: true }, { projection: { id: 1, slug: 1 } });
    plan.push({ ref: h.ref, hidden, keeper, where: h.where });
  }

  // Rewrites every /book/<ref>[anchor] in a text. Returns { text, changes, left }.
  const LINK = (ref) => new RegExp(`/book/${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/page/([0-9a-z-]+)|\\?page=(\\d+))?(?![\\w-])`, 'gi');
  const rewrite = async (text, p) => {
    const changes = [], left = [];
    let out = '', last = 0;
    for (const m of text.matchAll(LINK(p.ref))) {
      let to = `/book/${p.keeper.slug || p.keeper.id}`;
      if (m[1] || m[2]) {
        const r = await mapPage(p.hidden.id, p.keeper.id, m[1] ? { id: m[1] } : { n: Number(m[2]) });
        if (!r.ok) { left.push({ link: m[0], why: r.why }); continue; }
        to += m[1] ? `/page/${r.to.id}` : `?page=${r.to.n}`;
        changes.push({ from: m[0], to, page: `${r.from}→${r.to.n}`, dice: +r.score.toFixed(2), margin: +r.margin.toFixed(2) });
      } else changes.push({ from: m[0], to });
      out += text.slice(last, m.index) + to; last = m.index + m[0].length;
    }
    return { text: out + text.slice(last), changes, left };
  };

  const log = { files: [], collections: [], left: [], skipped };
  for (const p of plan) {
    for (const w of p.where) {
      if (!w.startsWith('collections:')) {
        const before = fs.readFileSync(w, 'utf8');
        const r = await rewrite(before, p);
        log.left.push(...r.left.map((x) => ({ where: w, ...x })));
        if (r.changes.length) { log.files.push({ file: w, changes: r.changes }); if (has('apply-files')) fs.writeFileSync(w, r.text); }
        continue;
      }
      const [slug, field] = w.slice('collections:'.length).split('.');
      const doc = await cols.findOne({ slug }, { projection: { [field]: 1 } });
      if (field === 'mentioned_books') {
        const list = doc.mentioned_books || [];
        const hit = (e) => [p.ref, p.hidden.id, String(p.hidden._id)].includes(e.book_id);
        if (!list.some(hit)) continue;
        const keeperListed = list.some((e) => e.book_id === p.keeper.id);
        const after = keeperListed ? list.filter((e) => !hit(e)) : list.map((e) => (hit(e) ? { ...e, book_id: p.keeper.id } : e));
        log.collections.push({ slug, field, hidden: p.hidden.id, keeper: p.keeper.id, action: keeperListed ? 'removed (keeper already listed)' : 'relinked' });
        if (has('apply')) {
          await recordSweepAction(db, { sweep: SWEEP, book_id: p.hidden.id, action: 'relinked', detail: { collection: slug, field, before: list, keeper: p.keeper.id } });
          await cols.updateOne({ slug, mentioned_books: list }, { $set: { mentioned_books: after } });
        }
      } else if (field === 'expanded_description') {
        const before = doc.expanded_description;
        const r = await rewrite(before, p);
        log.left.push(...r.left.map((x) => ({ where: w, ...x })));
        if (!r.changes.length) continue;
        log.collections.push({ slug, field, hidden: p.hidden.id, keeper: p.keeper.id, action: 'relinked', changes: r.changes });
        if (has('apply')) {
          await recordSweepAction(db, { sweep: SWEEP, book_id: p.hidden.id, action: 'relinked', detail: { collection: slug, field, before, keeper: p.keeper.id } });
          await cols.updateOne({ slug, expanded_description: before }, { $set: { expanded_description: r.text } });
        }
      }
    }
  }
  console.log(JSON.stringify(log, null, 1));
  console.error(`files ${log.files.reduce((a, f) => a + f.changes.length, 0)} links in ${log.files.length} files; collections ${log.collections.length} fields; left ${log.left.length}; skipped ${skipped.length} — files ${has('apply-files') ? 'WRITTEN' : 'dry'}, collections ${has('apply') ? 'WRITTEN' : 'dry'}`);
} finally {
  await client.close();
}
