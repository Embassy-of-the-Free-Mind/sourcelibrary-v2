#!/usr/bin/env node
// PRIOR ART: ./pairs.mjs and ./oc-pairs.mjs (the #5924 Step C / C2 / C3 packets: per page the image and the texts under
//   neutral labels, the order from a seeded Mulberry32 draw per page, keys kept in the job scratch) — they pair two arms;
//   Step T (#7568) shows all three arms to one reader, so this draws one of the 6 orders of L/C/R per page.
// w-packets.mjs — LANG7568=<lang>. C's served text: correct.mjs's correction where the outcome is `corrected`, else the
//   stored lite text (servedC). R: the cli-ocr.mjs read ($JOB_SCRATCH/<lang>/R/<page_id>.txt; empty if it failed).
//   Writes $JOB_SCRATCH/<lang>/agents/T-in-<book>.json, $JOB_SCRATCH/<lang>/packets/ and keys/t-key.json.
import fs from 'node:fs'; import path from 'node:path';
import { LANGS } from './w-draw.mjs';
const L = process.env.LANG7568, S = path.join(process.env.JOB_SCRATCH, L), HERE = path.dirname(new URL(import.meta.url).pathname);
const R = path.join(HERE, 'results-7568', L);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const lite = (slug) => fs.readFileSync(path.join(S, 'draw', `${slug}.lite.txt`), 'utf8');
export function servedC(pageId, liteText) {
  const f = path.join(S, 'set/reads', `${pageId}.meta.json`);
  if (!fs.existsSync(f)) return { outcome: 'not-run', text: liteText };
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { outcome: m.outcome, reason: m.reason, text: m.outcome === 'corrected' ? fs.readFileSync(path.join(S, 'set/reads', `${pageId}.txt`), 'utf8') : liteText };
}
export function readR(pageId) {
  const f = path.join(S, 'R', `${pageId}.txt`);
  const meta = fs.existsSync(path.join(S, 'R', `${pageId}.meta.json`)) ? JSON.parse(fs.readFileSync(path.join(S, 'R', `${pageId}.meta.json`), 'utf8')) : null;
  return { text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', meta };
}
export const PERMS = ['LCR', 'LRC', 'CLR', 'CRL', 'RLC', 'RCL'];   // the arm shown as X, Y, Z
const NOTE = { zh: 'Chinese', de: 'German', el: 'Greek', sa: 'Sanskrit', ar: 'Arabic' };
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const sample = JSON.parse(fs.readFileSync(path.join(R, 'sample.json'), 'utf8'));
  const rnd = mulberry32(LANGS[L].seed + 1), key = {};
  const task = fs.readFileSync(path.join(HERE, 'T-TASK.md'), 'utf8');
  // The bullet and its indented continuation lines (#7568 wave 1 packets carried only the first line; readers also had T-TASK.md).
  const tl = task.split('\n'), at = tl.findIndex(l => l.startsWith(`- **${L}**`));
  const lang_note = at < 0 ? '' : [tl[at], ...tl.slice(at + 1).filter((l, k, a) => a.slice(0, k + 1).every(x => /^\s+\S/.test(x)))].map(s => s.trim()).join(' ').replace(/^- \*\*\w+\*\* — /, '');
  for (const d of ['agents', 'packets', 'keys', 'crops']) fs.mkdirSync(path.join(S, d), { recursive: true });
  let n = 0;
  sample.books.forEach((b, i) => {
    const pages = b.pages.map(p => {
      const l = lite(p.slug), t = { L: l, C: servedC(p.page_id, l).text, R: readR(p.page_id).text };
      const perm = PERMS[Math.floor(rnd() * 6)]; key[p.slug] = perm; n++;
      const files = {};
      ['X', 'Y', 'Z'].forEach((lab, k) => { files[lab] = path.join(S, 'packets', `${p.slug}.${lab}.txt`); fs.writeFileSync(files[lab], t[perm[k]]); });
      return { slug: p.slug, page_number: p.page_number, img: path.join(S, 'draw', `${p.slug}.jpg`), full_img: path.join(S, 'draw', `${p.slug}.full.jpg`), ...files };
    });
    fs.writeFileSync(path.join(S, 'agents', `T-in-${i}.json`), JSON.stringify({ book_id: b.book_id, title: b.title, language: NOTE[L], lang_note, pages }, null, 1));
  });
  fs.writeFileSync(path.join(S, 'keys', 't-key.json'), JSON.stringify(key));
  console.log(JSON.stringify({ lang: L, books: sample.books.length, pages: n }));
}
