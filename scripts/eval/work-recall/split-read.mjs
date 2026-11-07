#!/usr/bin/env node
// PRIOR ART: overmerge-audit.mjs `readlist` writes a route-blind second-read packet of LIVE books only, for a rate;
// a split needs every carrier (hidden books too), their aliases and sources, and a row that names which books move
// where. It is reused here for the judged verdicts and the cluster frame (#8293). Read-only: nothing here writes Mongo.
//
//   node --env-file=.env.production.local split-read.mjs packet <live-books.jsonl> S0 S OUT [--chunks 6]
//        S0 = the #8291 frame dir, S = the #8293 census dir. Read list = census verdicts different work / container /
//        unsure, + every `local:n::` cluster, + Tesla clusters, + the #8291 different-work rows (overmerge-confirmed).
//   node --env-file=… split-read.mjs pages <book_id> [from] [to]    # OCR text, trimmed, for the record-cannot-decide case
//   node --env-file=… split-read.mjs image <book_id> <page> <dir>   # fetch a page image to look at it
//   node --env-file=… split-read.mjs works <author_id|/regex/>      # existing work_ids of an author, a move target
//   node --env-file=… split-read.mjs check <reviewed.jsonl> OUT/clusters.json   # every row names real books and a real target
import fs from 'fs';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';

const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const PROJ = { _id: 0, id: 1, title: 1, author: 1, author_id: 1, published: 1, year: 1, language: 1, pages_count: 1, visible: 1, work_id: 1, work_id_source: 1, work_id_aliases: 1, work_slug: 1, work_title: 1 };
const db = async () => { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return { c, d: c.db(process.env.MONGODB_DB || 'bookstore') }; };
const line = b => `${b.visible ? '' : '[HIDDEN] '}"${(b.title || '').replace(/\s+/g, ' ').slice(0, 240)}" | ${b.author || ''} | ${b.published ?? b.year ?? '?'} | ${b.language || '?'} | ${b.pages_count}pp | ${b.id} | src=${b.work_id_source || '?'}${b.work_id_aliases?.length ? ` | aliases=${b.work_id_aliases.slice(0, 4).join(',')}${b.work_id_aliases.length > 4 ? '…' : ''}` : ''}`;

async function packet(booksF, S0, S, OUT, chunks) {
  fs.mkdirSync(OUT, { recursive: true });
  const live = readJsonl(booksF), byWork = new Map();
  for (const b of live) if (b.work_id) { if (!byWork.has(b.work_id)) byWork.set(b.work_id, []); byWork.get(b.work_id).push(b); }
  const allC = new Map(readJsonl(`${S0}/all-clusters.jsonl`).map(c => [c.id, c]));
  const list = new Map(); // work_id -> {why:[...], judge}
  const add = (id, why, judge) => { if (!list.has(id)) list.set(id, { id, route: allC.get(id)?.route ?? null, why: [], judge: judge || null }); list.get(id).why.push(why); if (judge && !list.get(id).judge) list.get(id).judge = judge; };
  for (const r of readJsonl(`${S}/judged.jsonl`)) if (r.kind === 'real' && ['contains_different_work', 'contains_container', 'unsure'].includes(r.verdict))
    add(r.key.slice(5), 'census', { verdict: r.verdict, why: r.why, odd: r.odd });
  for (const [id, bs] of byWork) if (bs.length > 1 && id.startsWith('local:n::')) add(id, 'empty-author-key');
  for (const [id, bs] of byWork) if (bs.length > 1 && bs.some(b => /\btesla\b/i.test(b.author || ''))) add(id, 'tesla');
  const here = new URL('.', import.meta.url).pathname;
  for (const r of readJsonl(`${here}overmerge-confirmed-8291.jsonl`)) if (r.kind === 'different_work') add(r.work_id, `8291-confirmed (${r.route}): ${r.note}`, { verdict: r.judge, why: r.note });
  const ids = [...list.keys()];
  const { c, d } = await db();
  const carriers = new Map();
  for (let i = 0; i < ids.length; i += 500) for (const b of await d.collection('books').find({ work_id: { $in: ids.slice(i, i + 500) } }, { projection: PROJ }).toArray()) {
    if (!carriers.has(b.work_id)) carriers.set(b.work_id, []); carriers.get(b.work_id).push(b);
  }
  await c.close();
  const rows = ids.map(id => ({ ...list.get(id), books: (carriers.get(id) || []).sort((a, b) => (b.visible - a.visible) || String(a.title).localeCompare(String(b.title))) }));
  fs.writeFileSync(`${OUT}/clusters.json`, JSON.stringify(rows));
  // chunks balanced by book count, in id order so a chunk keeps an author's clusters together
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const total = rows.reduce((s, r) => s + r.books.length, 0), per = Math.ceil(total / chunks);
  let k = 0, acc = 0, out = [[]];
  for (const r of rows) { if (acc >= per && k < chunks - 1) { k++; acc = 0; out.push([]); } out[k].push(r); acc += r.books.length; }
  out.forEach((rs, i) => fs.writeFileSync(`${OUT}/chunk-${i + 1}.md`, rs.map(r => `\n## ${r.id}  (${r.books.length} books${r.books.some(b => !b.visible) ? `, ${r.books.filter(b => !b.visible).length} hidden` : ''}; on list for: ${r.why.join(' + ')})${r.judge ? `\njudge: ${r.judge.verdict} — ${r.judge.why || ''}${r.judge.odd?.length ? ` | odd: ${r.judge.odd.map(o => o.slice(0, 80)).join(' ; ')}` : ''}` : ''}\n${r.books.map(b => '  ' + line(b)).join('\n')}`).join('\n') + '\n'));
  const why = {}; for (const r of rows) for (const w of r.why) { const k2 = w.split(' ')[0]; why[k2] = (why[k2] || 0) + 1; }
  console.log(`read list: ${rows.length} clusters, ${total} books (${rows.reduce((s, r) => s + r.books.filter(b => !b.visible).length, 0)} hidden); reasons`, why, `; chunks ${out.map(o => o.length).join('/')}`);
}

async function pages(id, from = 1, to = 6) {
  const { c, d } = await db();
  const ps = await d.collection('pages').find({ book_id: id, page_number: { $gte: +from, $lte: +to } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  for (const p of ps) console.log(`--- p${p.page_number}\n${String(p.ocr?.data || '(no OCR)').replace(/<\/?(lang|page-type|sig|meta|header)[^>]*>[^\n]*\n?/g, '').slice(0, 1500)}`);
  if (!ps.length) console.log('(no pages in range)');
  await c.close();
}

async function image(id, n, dir) {
  const { c, d } = await db();
  const p = await d.collection('pages').findOne({ book_id: id, page_number: +n }, { projection: { cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1, photo: 1 } });
  await c.close();
  const url = p && getPageSource(p); if (!url) { console.log('no image'); return; }
  const r = await fetch(url); if (!r.ok) { console.log(`fetch ${r.status} ${url}`); return; }
  fs.mkdirSync(dir, { recursive: true }); const f = `${dir}/${id}-p${n}.jpg`; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); console.log(f);
}

async function works(q) {
  const { c, d } = await db();
  const filt = q.startsWith('/') ? { title: { $regex: q.slice(1, q.lastIndexOf('/')), $options: 'i' } } : { author_id: q };
  const rs = await d.collection('books').aggregate([{ $match: filt }, { $group: { _id: '$work_id', n: { $sum: 1 }, vis: { $sum: { $cond: ['$visible', 1, 0] } }, t: { $first: '$work_title' }, ex: { $first: '$title' } } }, { $sort: { n: -1 } }, { $limit: 80 }]).toArray();
  for (const r of rs) console.log(`${r._id} | ${r.n} books (${r.vis} visible) | work_title: ${(r.t || '').slice(0, 80)} | e.g. ${(r.ex || '').slice(0, 100)}`);
  await c.close();
}

// A reviewed row: {work_id, label, bar, evidence, moves:[{books:[ids], to:'new'|<work_id>, title, why}], note}
async function check(revF, clustersF) {
  const rows = readJsonl(revF), cl = new Map(JSON.parse(fs.readFileSync(clustersF, 'utf8')).map(r => [r.id, r]));
  const LABELS = new Set(['different_work', 'container', 'volume_or_part', 'same', 'undecided']), EV = new Set(['record', 'ocr', 'image']);
  const errs = [], targets = new Set(), seen = new Set();
  for (const r of rows) {
    const e = m => errs.push(`${r.work_id}: ${m}`), C = cl.get(r.work_id);
    if (seen.has(r.work_id)) e('duplicate row'); seen.add(r.work_id);
    if (!C) { e('not on the read list'); continue; }
    if (!LABELS.has(r.label)) e(`label ${r.label}`);
    if (!EV.has(r.evidence)) e(`evidence ${r.evidence}`);
    if (r.label === 'different_work') {
      if (!r.moves?.length) e('different_work with no moves');
      const ids = new Set(C.books.map(b => b.id)), moved = new Set();
      for (const m of r.moves || []) {
        if (!m.books?.length) e('empty move');
        for (const b of m.books || []) { if (!ids.has(b)) e(`book ${b} not in cluster`); if (moved.has(b)) e(`book ${b} moved twice`); moved.add(b); }
        if (m.to !== 'new') { if (m.to === r.work_id) e('move to its own id'); targets.add(m.to); } else if (!m.title) e('new work without a title');
      }
      if (moved.size >= ids.size) e('every book moves: name the half that keeps the id');
    } else if (r.moves?.length) e(`${r.label} with moves`);
  }
  for (const id of cl.keys()) if (!seen.has(id)) errs.push(`${id}: not reviewed`);
  if (targets.size) {
    const { c, d } = await db();
    const live = new Set((await d.collection('books').distinct('work_id', { work_id: { $in: [...targets] } })));
    await c.close();
    for (const t of targets) if (!live.has(t)) errs.push(`target ${t} is carried by no book`);
  }
  const t = {}; for (const r of rows) t[r.label] = (t[r.label] || 0) + 1;
  console.log(`${rows.length} rows`, t, `existing targets ${targets.size}`);
  console.log(errs.length ? `ERRORS ${errs.length}\n${errs.slice(0, 80).join('\n')}` : 'ok');
  process.exitCode = errs.length ? 1 : 0;
}

const [,, cmd, a, b, c2, d2] = process.argv;
const opt = (k, dflt) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : dflt; };
if (cmd === 'packet') await packet(a, b, c2, d2, +opt('chunks', 6));
else if (cmd === 'pages') await pages(a, b, c2);
else if (cmd === 'image') await image(a, b, c2);
else if (cmd === 'works') await works(a);
else if (cmd === 'check') await check(a, b);
else { console.error('usage: see the header'); process.exit(2); }
