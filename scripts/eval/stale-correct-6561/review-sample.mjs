#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-review-6561/sample.mjs (PR #6744: the table gate's request builder, the duplicated-row
// controls and the image fetch; copied here because that PR is not merged and its input is the staging collection of
// table pages, not run.mjs out.jsonl files) and scripts/eval/paddle-table-pilot-6388/review-prompt-pilot.txt (the
// review prompt, unchanged, as review-brief.md requires).
//
// #6561 item 1, pilot gate: Gemini review requests for the 100 Opus-corrected pilot pages, plus 5 planted controls
// (one printed row duplicated directly after itself) on corrected pages from other books (the supplement), mixed in.
// Files only. Usage (cwd = review dir): node review-sample.mjs <pilot dir> <supp dir>
// Writes gate-req.jsonl (run-cli-arm.py rows), gate-sample.json, gate-controls.json, img/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT = fs.readFileSync(path.join(HERE, '../paddle-table-pilot-6388/review-prompt-pilot.txt'), 'utf8');
const [, , PILOT, SUPP] = process.argv;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const h = (s) => crypto.createHash('sha256').update('6561-stale:' + s).digest('hex');
const han = (s) => (s.match(/\p{Script=Han}/gu) || []).length;
const hanOnly = (s) => (s.match(/\p{Script=Han}/gu) || []).join('');
const reviewPrompt = (text) => PROMPT.replace('{{TEXT}}', text) + '\n\nThe page image is attached:';

async function fetchImage(url, dir) {
  const f = path.join(dir, crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + (path.extname(new URL(url).pathname) || '.jpg'));
  if (!fs.existsSync(f)) {
    for (let i = 0; ; i++) {
      try { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); fs.writeFileSync(f + '.part', Buffer.from(await r.arrayBuffer())); fs.renameSync(f + '.part', f); break; }
      catch (e) { if (i >= 2) throw e; await new Promise((x) => setTimeout(x, 2000)); }
    }
  }
  const b = fs.readFileSync(f);
  return { file: path.resolve(f), bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
}

const okOf = (dir) => new Map(readJsonl(path.join(dir, 'out.jsonl')).filter((r) => r.outcome === 'ok').map((r) => [r.page_id, r]));
const pilotPages = readJsonl(path.join(PILOT, 'pages.jsonl')), pilotOk = okOf(PILOT);
const suppPages = readJsonl(path.join(SUPP, 'pages.jsonl')), suppOk = okOf(SUPP);
fs.mkdirSync('img', { recursive: true });

const rows = [], meta = [], notCorrected = [];
for (const [i, p] of pilotPages.entries()) {
  const o = pilotOk.get(p.pid);
  if (!o) { notCorrected.push(p.pid); continue; }
  const im = await fetchImage(p.image_url, 'img');
  const uid = `s${String(i + 1).padStart(3, '0')}`;
  rows.push({ uid, image: im.file, prompt: reviewPrompt(o.text) });
  meta.push({ uid, page_id: p.pid, book_id: p.bid, page_number: p.pn, title: p.title, layout: o.layout, stale_cer: p.cer, image_url: p.image_url, image_bytes: im.bytes, image_sha256: im.sha256, han: han(o.text), corrected_sha: o.corrected_sha });
}
// Controls: supplement pages (books not in the pilot) in hash order with >= 3 body rows; the middle row of >= 4 Han
// that the text prints only once is duplicated directly after itself.
const rowsOf = (t) => t.split('\n').map((l, k) => [l, k]).filter(([l]) => han(l) >= 3 && !/^\s*</.test(l));
const controls = [];
for (const p of [...suppPages].sort((a, b) => (h(a.pid) < h(b.pid) ? -1 : 1))) {
  if (controls.length >= 5) break;
  const o = suppOk.get(p.pid); if (!o || rowsOf(o.text).length < 3) continue;
  const lines = o.text.split('\n'), body = rowsOf(o.text);
  const cand = body.filter(([l]) => han(l) >= 4 && lines.filter((x) => x === l).length === 1);
  const pool = cand.length ? cand : body;
  const [row, k] = pool[Math.floor(pool.length / 2)];
  const text = [...lines.slice(0, k + 1), row, ...lines.slice(k + 1)].join('\n');
  const im = await fetchImage(p.image_url, 'img');
  const uid = `s${String(101 + controls.length).padStart(3, '0')}`;
  rows.push({ uid, image: im.file, prompt: reviewPrompt(text) });
  controls.push({ uid, page_id: p.pid, book_id: p.bid, page_number: p.pn, image_url: p.image_url, duplicated_row: row, row_line: k, inserted_at_line: k + 1, row_han: hanOnly(row) });
}
rows.sort((a, b) => (h('o' + a.uid) < h('o' + b.uid) ? -1 : 1));
fs.writeFileSync('gate-req.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync('gate-sample.json', JSON.stringify(meta, null, 1));
fs.writeFileSync('gate-controls.json', JSON.stringify(controls, null, 1));
console.log(`sample ${meta.length} corrected pilot pages (${notCorrected.length} not corrected: ${notCorrected.join(' ')}); controls ${controls.length}`);
