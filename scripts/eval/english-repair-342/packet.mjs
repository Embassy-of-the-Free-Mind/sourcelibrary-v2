#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs packet() — the packet and key format this writes (packet.json
// items { id, task, lang, image_file, text, source }, key.json rows { id, judged_as, cell, route, kind, page_id,
// book_id }), so judge.mjs `judge` and paired-arm.mjs `check`/`score` run on it unchanged. Its packet() is wired to its
// named cells and reads texts from Mongo; this one reads the four arms of the English-repair test from disk.
/**
 * Build the blind judge packet for the English repair test (#342).
 *   node scripts/eval/english-repair-342/packet.mjs --set=$JOB_SCRATCH/set --out=$JOB_SCRATCH/judge
 * cells = the page's audit group (en_only | both | clean); routes = stored (A) | retranslate (B) | guided (C) | blind (D).
 * Every arm text has <summary>/<keywords> removed (an index field, not the page). One wrong_page control and one
 * repeat per cell x arm. ids are hashes: the judge sees no arm name. Arms not yet run are left out; ids are stable,
 * so the packet can be rebuilt as arms finish and judge.mjs skips what it has judged.
 * Also writes arm-status.json: calls made and texts returned per arm (a route's score can hide its refusals).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const SET = arg('set'), OUT = arg('out'); fs.mkdirSync(OUT, { recursive: true });
const h = (s) => createHash('sha256').update(`english-repair-342:${s}`).digest('hex');
const body = (t) => String(t || '').replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(/<keywords>[\s\S]*?<\/keywords>/g, '').trim();
const J = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const set = fs.readFileSync(path.join(SET, 'set.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
export const ROUTES = { A: 'stored', B: 'retranslate', C: 'guided', D: 'blind' };

const status = {};
const st = (arm, k) => { status[arm] ??= { pages: set.length, calls: 0, returned: 0, failed: 0, chatter: 0, not_run: 0 }; status[arm][k]++; };
/** The text an arm returned for a page, or null (with the reason counted). */
function armText(r, arm) {
  if (arm === 'A') { st('A', 'returned'); return body(r.translation); }
  if (arm === 'B') {
    const m = J(path.join(SET, 'armB', `${r.page_id}.meta.json`));
    if (!m) { st('B', 'not_run'); return null; }
    status.B.calls += m.calls ?? 1;
    const t = fs.existsSync(path.join(SET, 'armB', `${r.page_id}.txt`)) ? fs.readFileSync(path.join(SET, 'armB', `${r.page_id}.txt`), 'utf8') : null;
    if (!t || m.error_class || m.exit) { st('B', 'failed'); return null; }
    st('B', 'returned'); return body(t);
  }
  const o = J(path.join(SET, `arm${arm}`, `${r.page_id}.json`));
  if (!o) { st(arm, 'not_run'); return null; }
  status[arm].calls += o.calls ?? 1;
  if (o.cls || !o.text) { st(arm, 'failed'); return null; }
  if (o.problem || cliChatterReason(o.text)) { st(arm, 'chatter'); return null; }
  st(arm, 'returned'); return body(o.text);
}
for (const a of Object.keys(ROUTES)) status[a] = { pages: set.length, calls: 0, returned: 0, failed: 0, chatter: 0, not_run: 0 };

const items = [], key = [];
const add = (kind, r, arm, text, imgRow = r) => {
  const id = h(`${kind}:${r.page_id}:${arm}:${imgRow.page_id}`).slice(0, 16);
  items.push({ id, task: 'translation', lang: imgRow.language || 'non-English', image_file: imgRow.image, text, source: body(imgRow.ocr) });
  key.push({ id, judged_as: id, cell: r.group, route: ROUTES[arm], kind, page_id: r.page_id, book_id: r.book_id, ...(kind === 'wrong_page' ? { image_page_id: imgRow.page_id } : {}) });
};
const texts = new Map();
for (const r of set) for (const arm of Object.keys(ROUTES)) { const t = armText(r, arm); if (t) { texts.set(`${r.page_id}:${arm}`, t); add('item', r, arm, t); } }
// Controls: per cell x arm, one wrong_page (this page's text, another book's image and transcription) and one repeat.
for (const g of ['en_only', 'both', 'clean']) {
  const rows = set.filter((r) => r.group === g).sort((a, b) => h(`ctl:${a.page_id}`).localeCompare(h(`ctl:${b.page_id}`)));
  Object.keys(ROUTES).forEach((arm, i) => {
    const withText = rows.filter((r) => texts.has(`${r.page_id}:${arm}`));
    if (withText.length < 3) return;
    const p = withText[i % withText.length];
    const q = rows.find((x) => x.book_id !== p.book_id && x.language !== p.language) || rows.find((x) => x.book_id !== p.book_id);
    add('wrong_page', p, arm, texts.get(`${p.page_id}:${arm}`), q);
    const rp = withText[(i + 7) % withText.length];
    add('repeat', rp, arm, texts.get(`${rp.page_id}:${arm}`));
  });
}
// Page-major order (the four arms of a page together, arm order seeded), controls spread through: a run stopped by a
// limit leaves complete pages, not complete arms.
const rank = (it, k) => `${h(`order:${k.kind === 'item' ? k.page_id : k.id}`)}:${h(`arm:${k.id}`)}`;
const kOf = new Map(key.map((k) => [k.id, k]));
items.sort((a, b) => rank(a, kOf.get(a.id)).localeCompare(rank(b, kOf.get(b.id))));
fs.writeFileSync(path.join(OUT, 'packet.json'), JSON.stringify({ items }));
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 0));
fs.writeFileSync(path.join(OUT, 'arm-status.json'), JSON.stringify(status, null, 1));
const tally = {}; for (const k of key) { const t = `${k.cell}/${k.route}/${k.kind}`; tally[t] = (tally[t] ?? 0) + 1; }
console.log(`packet: ${items.length} judge items`); console.log(JSON.stringify(status)); console.log(tally);
