#!/usr/bin/env node
// PRIOR ART: ./pilot.mjs collect + score (the plan.json + texts/ shape and the bar's counting, restated for written pages
// read back from Mongo; pilot.mjs reads a pilot set's folder). scripts/eval/router-confirm/confirm.mjs judge and
// scripts/eval/correction-pass-7818/lib.mjs wrongText (the blind Opus judge and its wrong-text rule, run unchanged).
/**
 * #7263 job zh-print-bulk-7263: the check after the first 1,000 written pages. runner.mjs calls it once (--check-at).
 *   node --env-file=... check.mjs --dir=RUNNER_DIR --out=DIR [--n=30] [--seed=7263]
 * Draws --n pages uniformly from the ledger's `written` rows (seeded), reads the text each page serves NOW from Mongo
 * (a page since rewritten by another writer is skipped and replaced), and has confirm.mjs judge it blind against the
 * image, one text a call, with 2 wrong-page controls. Writes DIR/result.json only when every drawn page has a verdict:
 * pass = at least 24/30 accepted and no control accepted (the brief's stop line). Read-only on Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { makeRng } from '../../eval/lib/paired-stats.mjs';
import { wrongText } from '../../eval/correction-pass-7818/lib.mjs';
import { MODEL_RE } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const DIR = path.resolve(arg('dir')), OUT = path.resolve(arg('out'));
const N = Number(arg('n', 30)), SEED = Number(arg('seed', 7263));
const MIN_ACCEPT = Math.ceil((24 / 30) * N);
const LANE = 'opus-correct-zh-print-7263';
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

async function plan() {
  const last = new Map(); for (const r of jsonl(path.join(DIR, 'ledger.jsonl'))) last.set(r.page_id, r);
  const written = [...last.values()].filter((r) => r.state === 'written').sort((a, b) => a.page_id.localeCompare(b.page_id));
  const rnd = makeRng(SEED);
  const order = written.map((r) => ({ r, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const titles = new Map((await db.collection('books').find({ id: { $in: [...new Set(written.map((r) => r.book_id))] } }, { projection: { id: 1, title: 1 } }).toArray()).map((b) => [b.id, b.title]));
  const selected = []; const skipped = {};
  fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true });
  for (const r of order) {
    if (selected.length >= N) break;
    const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } });
    const lane = typeof p?.ocr?.pipeline === 'string' ? p.ocr.pipeline : p?.ocr?.pipeline?.lane;
    if (!p?.ocr?.data || new RegExp(MODEL_RE).test(p.ocr.model || '') || (lane && lane !== LANE)) { skipped['rewritten since'] = (skipped['rewritten since'] ?? 0) + 1; continue; }
    const image = getPageSource(p)?.replace(/\s+/g, '');
    if (!image) { skipped['no image'] = (skipped['no image'] ?? 0) + 1; continue; }
    const key = `P-${p.id}`;
    fs.writeFileSync(path.join(OUT, 'texts', `${key}.O.txt`), p.ocr.data);
    selected.push({ key, book_id: p.book_id, title: titles.get(p.book_id) ?? '', page_id: p.id, page_number: p.page_number, image, block: [p.id], served: 'written', wave: r.wave });
  }
  await c.close();
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify({ at: new Date().toISOString(), cell: 'zh-print-bulk-7263/check', lang_name: 'Chinese', arms: [{ arm: 'O', route: 'gemini>opus@1', kind: 'correct' }], rule: { within: 0.08, wrong_text_max: 0.04 }, written: written.length, skipped, selected }, null, 1));
  return selected.length;
}

function judge() {
  const r = spawnSync('node', [path.join(ROOT, 'scripts/eval/router-confirm/confirm.mjs'), 'judge', '--cell=zh-print-bulk-7263/check', `--out=${OUT}`, '--max-calls=45', '--concurrency=2'], { encoding: 'utf8', env: process.env, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? '');
}

function score() {
  const P = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
  const vs = jsonl(path.join(OUT, 'verdicts.jsonl')).filter((v) => v.verdict);
  const abs = new Map(vs.filter((v) => v.set === 'abs').map((v) => [v.key, v.verdict]));
  const ctl = vs.filter((v) => v.set === 'wrong_page');
  const rows = P.selected.map((s) => ({ ...s, v: abs.get(s.key) }));
  if (rows.some((x) => !x.v) || ctl.length < Math.min(2, Math.floor(N / 2))) return null;
  const accepted = rows.filter((x) => x.v.accept).length, wrong = rows.filter((x) => wrongText(x.v));
  const ctlAcc = ctl.filter((v) => v.verdict.accept).length;
  const pass = accepted >= MIN_ACCEPT && ctlAcc === 0;
  const books = new Set(rows.map((x) => x.book_id)).size;
  const summary = `${accepted}/${rows.length} accepted (stop line: under ${MIN_ACCEPT}), ${wrong.length} wrong-text, controls ${ctlAcc}/${ctl.length} accepted; ${rows.length} pages drawn from the ${P.written} written, in ${books} books; blind Opus judge with the image, one text a call.`;
  const table = `| book | page | accepted | fidelity | wrong-text | judge's note |\n|---|---:|---|---:|---|---|\n${rows.map((x) => `| ${String(x.title).slice(0, 40)} | ${x.page_number} | ${x.v.accept ? 'yes' : 'no'} | ${x.v.fidelity ?? ''} | ${wrongText(x.v) ? 'yes' : ''} | ${String(x.v.reader_note ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 140)} |`).join('\n')}`;
  const res = { at: new Date().toISOString(), n: rows.length, accepted, wrong_text: wrong.length, controls: { n: ctl.length, accepted: ctlAcc }, min_accept: MIN_ACCEPT, pass, summary, table, rows: rows.map((x) => ({ page_id: x.page_id, book_id: x.book_id, page_number: x.page_number, accept: x.v.accept, fidelity: x.v.fidelity, wrong: wrongText(x.v), note: x.v.reader_note, defects: (x.v.defects || []).filter((d) => d.severity === 'wrong_text' || d.severity === 'misleads') })) };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(res, null, 1));
  return res;
}

fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(OUT, 'plan.json'))) { const n = await plan(); if (n < N) { console.error(`only ${n} of ${N} pages drawn`); process.exit(1); } }
judge();
const res = score();
if (!res) { console.error('verdicts missing: run again'); process.exit(1); }
console.log(res.summary);
