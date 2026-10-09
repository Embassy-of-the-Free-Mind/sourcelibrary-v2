#!/usr/bin/env node
// PRIOR ART: scripts/workers/mineru-ocr-worker.mjs `sanitize()` + `readPageFootnotes()` — copied (the
// worker does not export them and runs Mongo on import), so the eval arm's text is the text the lane writes.
// collect-mineru.mjs <mineru out dir> <arm dir> — one <slug>.txt per page: sanitised markdown + footnotes.
import fs from 'fs';
import path from 'path';

const [OUT, ARM] = process.argv.slice(2);
function sanitize(md) {
  let t = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/`{1,3}/g, '');
  t = t.replace(/[ \t]+/g, ' ').replace(/ *\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
const pick = (base, suffix) => [path.join(OUT, base, 'ocr', `${base}${suffix}`), path.join(OUT, base, 'auto', `${base}${suffix}`)].find(p => fs.existsSync(p));
function footnotes(base) {
  const f = pick(base, '_middle.json');
  if (!f) return [];
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const blocks = (d?.pdf_info?.[0]?.discarded_blocks || []).filter(b => b?.type === 'page_footnote');
  blocks.sort((a, b) => (a.bbox?.[1] ?? 0) - (b.bbox?.[1] ?? 0));
  return blocks.map(b => (b.lines || []).map(l => (l.spans || []).map(s => s.content || '').join(' ')).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}
fs.mkdirSync(ARM, { recursive: true });
let n = 0;
for (const base of fs.readdirSync(OUT)) {
  const md = pick(base, '.md');
  const body = md ? sanitize(fs.readFileSync(md, 'utf8')) : '';
  const notes = footnotes(base).map(sanitize).filter(Boolean);
  fs.writeFileSync(path.join(ARM, `${base}.txt`), notes.length ? `${body}\n\n${notes.join('\n')}` : body);
  n++;
}
console.log(`collected ${n} MinerU pages into ${ARM}`);
