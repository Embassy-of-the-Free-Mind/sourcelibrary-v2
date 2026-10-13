#!/usr/bin/env node
// PRIOR ART: scripts/eval/second-reader/ (#6338: draw.mjs, PLANTERS, run-readers.sh, cli-requests / cli-assemble, the
// frozen briefs; its scorer answers "does a second reader find more", with Krippendorff's alpha on severity, not kappa
// per kind) and scripts/audit/convergent-audit-weekly.mjs (two readers each week, agreement on "serious" only, no
// planted pages). Reused unchanged: the packet shape, the sealed Opus path, the CLI Gemini path, the planters.
/**
 * Cross-family reliability of the page review (#6203 validation run): Opus and Gemini read the SAME 30 pages plus 3
 * planted controls, and name a KIND for every error (KIND-ADDENDUM.md). Reports Cohen's kappa per kind and each
 * reader's recall on the controls. $0: both readers run on subscriptions (claude -p; agy).
 *
 *   node --env-file=.env.production.local scripts/eval/cross-family-6203/run.mjs draw --run R [--seed 6203]
 *   EXTRA_BRIEFS="$PWD/scripts/eval/cross-family-6203/KIND-ADDENDUM.md" scripts/eval/second-reader/run-readers.sh R opus claude opus read 4
 *   node scripts/eval/second-reader/second-reader.mjs cli-requests --run R --reader gemini --addendum scripts/eval/cross-family-6203/KIND-ADDENDUM.md
 *   python3 scripts/eval/run-cli-arm.py --requests R/readers/gemini/requests.jsonl --out R/readers/gemini/cli-out.jsonl \
 *     --arm xfam6203-gemini --model <best Pro or 3.8 the CLI offers: `agy models`> --job cross-family-6203 --kind review --parallel 2 --attempts 4 --no-tool-gate
 *   node scripts/eval/second-reader/second-reader.mjs cli-assemble --run R --reader gemini
 *   node scripts/eval/cross-family-6203/run.mjs score --run R [--readers opus,gemini]
 *   node scripts/eval/cross-family-6203/run.mjs pack --run R --out scripts/eval/results/cross-family-6203/<name>
 *   node --env-file=.env.production.local scripts/eval/cross-family-6203/run.mjs restore --from <that dir> --run R2   # on another box
 *
 * THE PAGES. 15 from the sets earlier reviews read (the #5826 gate's sample and the #5914 fortnightly spot check's
 * books; one page per book), 15 from random live non-English books whose page serves English (one page per book),
 * and 3 CONTROLS: served pages from three more random books, doctored so the answer is known:
 *   neighbouring leaf   the text (both layers) of the next page under this page's image          → wrong_leaf
 *   dropped line        one middle sentence cut from the English (PLANTERS.dropped, #6338)       → omission
 *   flipped negation    one negation reversed in the English (PLANTERS.negation, #6338)          → mistranslation
 * Packets are redacted (no model, no URL) and shuffled; draw.json (the key) never enters a reader's folder.
 * Read-only on Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { structureCounts, pageImageUrl } from '../spot-check/lib.mjs';
import { validateOutput, keyOf, redactRecord, PLANTERS } from '../second-reader/lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { bootstrapItems, binaryAgreement } from '../lib/agreement-stats.mjs';
import { exposureOf, KINDS, kindLabel, formatKOfN } from '../../lib/review-vocabulary.mjs';
import { readerStatus, seriousKinds, isSeriousPage, kindAgreement, caughtControl, CONTROL_KIND } from '../../audit/convergent-audit-lib.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const R = opt('run');
if (!R) { console.error('--run DIR required (see the header)'); process.exit(2); }
const J = (...p) => path.join(R, ...p);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(x, null, 1) + '\n'); };
const ENGLISH = /^(english|middle english|old english|early modern english|en)$/i;
const EXCLUDED_TYPES = new Set(['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate']);
const eligible = (p) => p.page_number > 0 && (p.ocr?.data ?? '').length >= 200 && (p.translation?.data ?? '').trim().length >= 100 && !EXCLUDED_TYPES.has(p.page_type);
if (cmd === 'draw') {
  if (fs.existsSync(J('packets'))) throw new Error(`${J('packets')} exists: refusing to draw over a run`);
  const seed = Number(opt('seed', 6203));
  const rng = makeRng(seed);
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  fs.mkdirSync(J('images'), { recursive: true });
  const proj = { page_number: 1, page_type: 1, translation_withheld: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1, photo: 1, cropped_photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1 };
  const download = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) return null;
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      fs.writeFileSync(J(`images/${sha.slice(0, 16)}.jpg`), buf);
      return { file: `images/${sha.slice(0, 16)}.jpg`, sha256: sha };
    } catch { return null; }
  };
  const bookOf = (id) => db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, visible: 1, 'catalog_metadata.collections': 1 } });
  const pagesOf = (id) => db.collection('pages').find({ book_id: id }, { projection: proj }).sort({ page_number: 1 }).toArray();
  const makeRecord = async (b, p, all, source, text = {}) => {
    const url = pageImageUrl(p);
    const img = url ? await download(url) : null;
    if (!img) return null;
    return { source, exposure: exposureOf({ book: b, page: p }), book_id: b.id, book: b,
      structure: { ...structureCounts(all), pages_count_field: b.pages_count, pages_translated_field: b.pages_translated }, run: [p.page_number],
      pages: [{ page_number: p.page_number, page_id: String(p._id), image_url: url, image_file: img.file, image_sha256: img.sha256,
        crop: !p.split_from_spread && !p.cropped_photo && p.crop?.xStart !== undefined ? p.crop : undefined,
        ocr: text.ocr ?? p.ocr.data, ocr_engine: p.ocr?.source ?? null, ocr_model: p.ocr?.model ?? null,
        translation: text.translation ?? p.translation.data, translation_model: p.translation?.model ?? null, translation_source: p.translation?.source ?? null }] };
  };
  const records = [], used = new Set(), log = { skipped: {} };
  const skip = (why) => { log.skipped[why] = (log.skipped[why] || 0) + 1; };

  // 1. Reviewed sets: the gate's sampled pages and the fortnightly spot check's pages, one page per book.
  const gates = await db.collection('quality_gates').find({ drill: { $ne: true } }, { projection: { id: 1, 'sample_ids.book_id': 1, 'sample_ids.page_numbers': 1 } }).toArray();
  const gateSet = gates.flatMap((g) => (g.sample_ids || []).map((s) => ({ book_id: s.book_id, pages: s.page_numbers || [], source: `gate:${g.id}` })));
  const spot = await db.collection('book_checks').find({ method_id: 'fortnightly-spot-check' }, { projection: { _id: 0, book_id: 1, pages_read: 1, run_id: 1 } }).toArray();
  const spotSet = spot.map((s) => ({ book_id: s.book_id, pages: s.pages_read || [], source: `spot-check:${s.run_id}` }));
  const takeReviewed = async (set, n) => {
    let got = 0;
    for (const c of shuffle(set)) {
      if (got >= n) break;
      if (used.has(c.book_id)) continue;
      const b = await bookOf(c.book_id);
      if (!b) { skip('reviewed: book gone'); continue; }
      const all = await pagesOf(c.book_id);
      const el = all.filter((p) => c.pages.includes(p.page_number) && eligible(p));
      if (!el.length) { skip('reviewed: no eligible page among those read'); continue; }
      const rec = await makeRecord(b, el[Math.floor(rng() * el.length)], all, c.source);
      if (!rec) { skip('reviewed: image unavailable'); continue; }
      records.push(rec); used.add(c.book_id); got++;
    }
    return got;
  };
  const nGate = await takeReviewed(gateSet, 7);
  await takeReviewed(spotSet, 15 - nGate);
  // 2. Random served: live non-English books with English on the page.
  const frame = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gte: 1 } }, { projection: { _id: 0, id: 1, language: 1 } }).toArray())
    .filter((b) => b.id && b.language && !ENGLISH.test(String(b.language).trim())).map((b) => b.id).sort();
  const order = shuffle(frame);
  let cursor = 0;
  const nextServed = async () => {
    while (cursor < order.length) {
      const id = order[cursor++];
      if (used.has(id)) continue;
      const b = await bookOf(id), all = await pagesOf(id);
      const el = all.filter((p) => eligible(p) && exposureOf({ book: b, page: p }) === 'served');
      if (!el.length) { skip('random: no eligible served page'); continue; }
      used.add(id);
      return { b, all, p: el[Math.floor(rng() * el.length)] };
    }
    throw new Error('frame exhausted');
  };
  while (records.filter((r) => r.source === 'random').length < 15) {
    const { b, all, p } = await nextServed();
    const rec = await makeRecord(b, p, all, 'random');
    if (rec) records.push(rec); else skip('random: image unavailable');
  }
  // 3. Controls: three more served pages, doctored.
  const controls = [];
  for (const cls of ['wrong_leaf', 'dropped', 'negation']) {
    for (let tries = 0; tries < 40 && !controls.some((c) => c.class === cls); tries++) {
      const { b, all, p } = await nextServed();
      let text = null, key = null;
      if (cls === 'wrong_leaf') {
        const next = all.find((q) => q.page_number === p.page_number + 1 && eligible(q));
        if (next) { text = { ocr: next.ocr.data, translation: next.translation.data }; key = { text_of_page: next.page_number }; }
      } else {
        const r = PLANTERS[cls]({ translation: p.translation.data, ocr: p.ocr.data }, rng);
        if (r) { text = { translation: r.translation }; key = { span: r.span, before: r.before, after: r.after }; }
      }
      if (!text) { skip(`control ${cls}: page cannot take it`); continue; }
      const rec = await makeRecord(b, p, all, 'control', text);
      if (!rec) { skip('control: image unavailable'); continue; }
      rec.control = { class: cls, expect_kind: CONTROL_KIND[cls], ...key };
      records.push(rec); controls.push(rec.control);
    }
  }
  await client.close();
  if (controls.length !== 3) throw new Error(`only ${controls.length} of 3 controls could be planted`);
  const final = shuffle(records);
  final.forEach((r, i) => write(J('packets', `p${String(i).padStart(3, '0')}.json`), [redactRecord({ slot: 1, stratum: 'audit', tradition: null, book_id: r.book_id, book_url: `https://sourcelibrary.org/book/${r.book_id}`, book: r.book, structure: r.structure, run: r.run, pages: r.pages })]));
  write(J('draw.json'), { issue: 6203, seed, drawn_at: new Date().toISOString(), frame_books: frame.length, gate_books: gateSet.length, spot_books: spotSet.length, ...log,
    pages: final.map((r, i) => ({ packet: `p${String(i).padStart(3, '0')}`, source: r.source, exposure: r.exposure, book_id: r.book_id, page_number: r.pages[0].page_number, language: r.book?.language, ocr_model: r.pages[0].ocr_model, translation_model: r.pages[0].translation_model, ...(r.control ? { control: r.control } : {}) })) });
  const n = (f) => final.filter(f).length;
  console.log(`drew ${final.length} pages: ${n((r) => r.source.startsWith('gate'))} gate, ${n((r) => r.source.startsWith('spot'))} spot check, ${n((r) => r.source === 'random')} random served, ${n((r) => r.source === 'control')} controls; seed ${seed}; skipped ${JSON.stringify(log.skipped)}`);
}

else if (cmd === 'score') {
  const draw = read(J('draw.json'));
  const names = String(opt('readers', 'opus,gemini')).split(',');
  const packets = new Map(draw.pages.map((d) => [d.packet, read(J('packets', `${d.packet}.json`))]));
  const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };
  const by = {}, status = {};
  for (const name of names) {
    by[name] = new Map();
    for (const [pk, recs] of packets) {
      let out = null;
      try { out = read(J('readers', name, 'reviews', `${pk}.json`)); } catch { /* not read */ }
      const p = validateOutput(out, recs).pages.get(keyOf(recs[0].book_id, recs[0].pages[0].page_number));
      if (p) by[name].set(pk, p);
    }
    const base = J('readers', name);
    const uids = lines(path.join(base, 'requests.jsonl')).map(parse).filter(Boolean).map((r) => r.uid);
    status[name] = readerStatus({ uids: uids.length ? uids : [...packets.keys()], rows: lines(path.join(base, 'cli-out.jsonl')).map(parse).filter(Boolean), quotaText: lines(path.join(base, 'QUOTA.txt')).join('\n'), reviewed: [...by[name].keys()] });
  }
  const natural = draw.pages.filter((d) => !d.control), ctl = draw.pages.filter((d) => d.control);
  const sub = (m, ds) => new Map(ds.filter((d) => m.has(d.packet)).map((d) => [d.packet, m.get(d.packet)]));
  // Controls: each reader's recall.
  const controls = ctl.map((d) => ({ packet: d.packet, class: d.control.class, expect_kind: d.control.expect_kind, book_id: d.book_id, page_number: d.page_number,
    readers: Object.fromEntries(names.map((nm) => [nm, caughtControl(d.control, by[nm].get(d.packet), packets.get(d.packet)[0].pages[0].translation)])) }));
  const recall = Object.fromEntries(names.map((nm) => [nm, { detected: controls.filter((c) => c.readers[nm].detected).length, serious: controls.filter((c) => c.readers[nm].serious).length, kind_named: controls.filter((c) => c.readers[nm].kind_named).length, n: controls.length }]));
  // Each reader's own picture of the natural pages, and the pairwise agreement per kind.
  const per_reader = Object.fromEntries(names.map((nm) => { const m = sub(by[nm], natural); return [nm, { read: m.size, serious_pages: [...m.values()].filter(isSeriousPage).length, kinds: Object.fromEntries(KINDS.map((k) => [k, [...m.values()].filter((p) => seriousKinds(p).includes(k)).length])) }]; }));
  const pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = sub(by[names[i]], natural), b = sub(by[names[j]], natural);
    const ag = kindAgreement(a, b);
    const keys = [...a.keys()].filter((k) => b.has(k));
    const rng = makeRng(6203);
    const ci = keys.length >= 10 ? bootstrapItems(keys, (s) => binaryAgreement(s.map((k) => [isSeriousPage(a.get(k)), isSeriousPage(b.get(k))])).kappa, rng) : null;
    pairs.push({ a: names[i], b: names[j], agreement: ag, any_serious_kappa_ci: ci });
  }
  const report = { issue: 6203, run: path.basename(R), seed: draw.seed, drawn_at: draw.drawn_at, scored_at: new Date().toISOString(), pages: draw.pages.length, natural: natural.length, readers: names, reader_status: status, per_reader, pairs, controls, control_recall: recall };
  write(J('report.json'), report);
  const k2 = (x) => (x == null ? '—' : x.toFixed(2));
  const md = [`**Cross-family review reliability (#6203)**, run \`${report.run}\`, seed ${draw.seed}, drawn ${draw.drawn_at.slice(0, 10)}`, '',
    `${natural.length} pages (${natural.filter((d) => d.source.startsWith('gate')).length} from the #5826 gate sample, ${natural.filter((d) => d.source.startsWith('spot')).length} from the #5914 spot check, ${natural.filter((d) => d.source === 'random').length} random served; one page per book) and ${ctl.length} planted controls. Each reader read every page against its image, frozen #6338 brief plus KIND-ADDENDUM.md.`, '',
    ...names.map((nm) => `- ${nm}${status[nm].models.length ? ` (${status[nm].models.join(', ')})` : ''}: ${status[nm].ok ? `read ${status[nm].read} of ${status[nm].requested}` : status[nm].why}; a serious error on ${formatKOfN({ k: per_reader[nm].serious_pages, n: per_reader[nm].read, rate: per_reader[nm].read ? per_reader[nm].serious_pages / per_reader[nm].read : null, ci: [0, 0] }, 'pages').replace(/, 95% CI.*\)/, ')')} of the natural pages.`), ''];
  for (const p of pairs) {
    const g = p.agreement;
    md.push(`**${p.a} vs ${p.b}**, ${g.any_serious.n} natural pages both read. κ = Cohen's kappa; "—" = a reader never (or always) flagged it, so κ is not estimable.`, '',
      `| finding (serious) | ${p.a} yes | ${p.b} yes | both | raw agreement | κ |`, '|---|---|---|---|---|---|',
      ...Object.entries(g).filter(([k, x]) => ['any_serious', 'not_on_leaf'].includes(k) || x.a_yes + x.b_yes > 0).map(([k, x]) => `| ${k === 'any_serious' ? 'any serious error' : k === 'not_on_leaf' ? 'text not on the leaf (six kinds)' : kindLabel(k)} | ${x.a_yes} | ${x.b_yes} | ${x.both} | ${x.raw == null ? '—' : `${Math.round(100 * x.raw)}%`} | ${k2(x.kappa)}${k === 'any_serious' && p.any_serious_kappa_ci ? ` (95% CI ${k2(p.any_serious_kappa_ci[0])} to ${k2(p.any_serious_kappa_ci[1])}, bootstrap by page)` : ''} |`), '');
  }
  md.push('**Planted controls** (detected / called serious / right kind named):', '', `| control | expected kind | ${names.join(' | ')} |`, `|---|---|${names.map(() => '---').join('|')}|`,
    ...controls.map((c) => `| ${c.class.replace('_', ' ')} (\`${c.book_id}\` p.${c.page_number}) | ${kindLabel(c.expect_kind)} | ${names.map((nm) => { const r = c.readers[nm]; return r.missing ? 'not read' : `${r.detected ? 'yes' : 'NO'} / ${r.serious ? 'yes' : 'no'} / ${r.kind_named ? 'yes' : 'no'}`; }).join(' | ')} |`),
    '', `Control recall: ${names.map((nm) => `${nm} ${recall[nm].detected} of ${recall[nm].n}`).join(', ')}.`, '');
  fs.writeFileSync(J('report.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}
// ── pack / restore: the run as committed evidence, and back into a run dir on another box ─────────────────────
// A run dir holds 33 packet files, their images (34 MB) and a reader's transcripts. The repo keeps the key, the
// packets and each reader's reviews as three small files; `restore` rebuilds the run dir from them and fetches the
// images again, listing any whose bytes are not the ones the first reader saw.
else if (cmd === 'pack') {
  const out = opt('out');
  if (!out) throw new Error('--out DIR required');
  const zlib = await import('node:zlib');
  const draw = read(J('draw.json'));
  const gz = (f, rows) => fs.writeFileSync(path.join(out, f), zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(J('draw.json'), path.join(out, 'draw.json'));
  gz('packets.jsonl.gz', draw.pages.map((d) => ({ packet: d.packet, records: read(J('packets', `${d.packet}.json`)) })));
  for (const name of fs.existsSync(J('readers')) ? fs.readdirSync(J('readers')) : []) {
    const rows = draw.pages.filter((d) => fs.existsSync(J('readers', name, 'reviews', `${d.packet}.json`))).map((d) => ({ packet: d.packet, review: read(J('readers', name, 'reviews', `${d.packet}.json`)) }));
    if (rows.length) gz(`reviews-${name}.jsonl.gz`, rows);
    for (const f of ['cli-out.jsonl', 'QUOTA.txt', 'assemble.json']) if (fs.existsSync(J('readers', name, f))) fs.writeFileSync(path.join(out, `${name}-${f}${f.endsWith('.jsonl') ? '.gz' : ''}`), f.endsWith('.jsonl') ? zlib.gzipSync(fs.readFileSync(J('readers', name, f))) : fs.readFileSync(J('readers', name, f)));
    console.log(`${name}: ${rows.length} reviews`);
  }
  for (const f of ['report.json', 'report.md']) if (fs.existsSync(J(f))) fs.copyFileSync(J(f), path.join(out, f));
  console.log(`packed ${R} → ${out}`);
}
else if (cmd === 'restore') {
  const from = opt('from');
  if (!from) throw new Error('--from DIR required');
  if (fs.existsSync(J('packets'))) throw new Error(`${J('packets')} exists: refusing to restore over a run`);
  const zlib = await import('node:zlib');
  const rows = (f) => zlib.gunzipSync(fs.readFileSync(path.join(from, f))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  fs.mkdirSync(J('images'), { recursive: true });
  fs.copyFileSync(path.join(from, 'draw.json'), J('draw.json'));
  const packets = rows('packets.jsonl.gz');
  for (const p of packets) write(J('packets', `${p.packet}.json`), p.records);
  for (const f of fs.readdirSync(from).filter((x) => /^reviews-.*\.jsonl\.gz$/.test(x))) for (const r of rows(f)) write(J('readers', f.replace(/^reviews-|\.jsonl\.gz$/g, ''), 'reviews', `${r.packet}.json`), r.review);
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  let ok = 0; const bad = [], reencoded = [];
  for (const p of packets) {
    const rec = p.records[0], pg = rec.pages[0];
    const doc = await db.collection('pages').findOne({ book_id: rec.book_id, page_number: pg.page_number });
    const url = doc ? pageImageUrl(doc) : null;
    let buf = null;
    try { const r = url && await fetch(url, { signal: AbortSignal.timeout(60_000) }); if (r?.ok) buf = Buffer.from(await r.arrayBuffer()); } catch { /* reported below */ }
    if (!buf || buf.length < 2000) { bad.push(`${p.packet} ${rec.book_id} p.${pg.page_number}: image unavailable`); continue; }
    // Several image hosts re-encode on every request, so the bytes of the same picture differ between two fetches
    // (17 of 33 on the first restore, minutes after the draw). Such an image is used and LISTED: the two readers then
    // saw the same leaf through two encodings, which restore.json records.
    if (crypto.createHash('sha256').update(buf).digest('hex') !== pg.image_sha256) reencoded.push(p.packet);
    fs.writeFileSync(J(pg.image_file), buf); ok++;
  }
  await client.close();
  write(J('restore.json'), { restored_at: new Date().toISOString(), from, images: ok, byte_identical: ok - reencoded.length, bytes_differ: reencoded, unavailable: bad });
  console.log(`restored ${packets.length} packets, ${ok} images (${ok - reencoded.length} byte-identical to the draw, ${reencoded.length} re-encoded by their host)${bad.length ? `; NOT restored:\n  ${bad.join('\n  ')}` : ''}`);
  if (bad.length) process.exit(1);
}
else { console.error(`unknown command ${cmd}`); process.exit(2); }
