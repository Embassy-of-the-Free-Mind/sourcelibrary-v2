// PRIOR ART: none — looked in scripts/eval/INDEX.md, scripts/local-corpus/ and scripts/eval/lib/: no per-name attribution harvester over the translation mirror. Moved here from a session scratchpad for #7065; it reads the laptop-only corpus mirror (~/sl-corpus), so on a box use fetch-originals.mjs on its output.
// Usage: node term-harvest.mjs <out.json> <fts-prefix> <name-regex>
// e.g. node term-harvest.mjs archyt.json archyt "archytas"
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
const require = createRequire('/Users/dereklomas/sourcelibrary-atlas/scripts/local-corpus/x.js');
const Database = require('better-sqlite3');
// <note> is kept when it opens with a printed-footnote marker ("1.", "*", "(a)"): those are the book's own notes.
const FOOT=/<note\b[^>]*>(?!\s*(?:\d{1,3}[.)]?|[*†‡§¶]|\([a-z0-9]\))\s)[\s\S]*?<\/note>/gi;
const APP=/<(meta|gloss|vocab|summary|keywords|warning|header|page-num|page-type|language|sig|context|script|columns)\b[^>]*>[\s\S]*?<\/\1>/gi;
const stripApparatus=(s)=>{let prev;do{prev=s;s=s.replace(FOOT,' ').replace(APP,' ');}while(s!==prev);return s.replace(/<\/?[a-z][a-z-]*[^>]*>/gi,' ');};
const [OUT, PREFIX, NAME] = process.argv.slice(2);
const C = process.env.HOME + '/sl-corpus';
const db = new Database(C + '/corpus.sqlite', { readonly: true });
const cat = new Map();
for (const l of fs.readFileSync(C + '/catalog.jsonl', 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); cat.set(r.id, { t: r.display_title || r.english_title || r.title, a: r.author, y: r.year, pub: r.published, lang: r.language, v: r.visible, pc: r.pages_count, w: r.work_id }); }
const hits = db.prepare(`SELECT p.book_id b, p.p p, p.type type FROM pages_en JOIN pages p ON p.rowid=pages_en.rowid WHERE pages_en MATCH ?`).all(PREFIX + '*');
const byBook = new Map(); for (const h of hits) { if (!byBook.has(h.b)) byBook.set(h.b, []); byBook.get(h.b).push(h); }
const QUOTE = new RegExp(`\\b(${NAME})\\b[^.;:]{0,40}?\\b(said|says|saying|saith|taught|teaches|held|holds|thought|believed|maintained|affirmed|declared|asserted|wrote|writes|written|calls|called|defined|defines|named|argued|argues|demonstrated|shows|showed|proved)\\b|(according to|in the words of|fragment of|book of|books of|treatise of|opinion of|doctrine of|as) (the )?(\\w+ )?(${NAME})`, 'i');
const SENT = new RegExp(`[^.!?]*?${PREFIX}[^.!?]*[.!?]?`, 'i');
const SKIP = new Set(['index', 'toc', 'errata', 'title-page', 'blank']);
const out = [];
for (const [b, hs] of byBook) {
  const meta = cat.get(b) || {}; const want = new Map(hs.map((h) => [h.p, h.type]));
  const f = path.join(C, 'books', b + '.jsonl'); if (!fs.existsSync(f)) continue;
  const passages = [];
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    if (!want.has(r.p) || SKIP.has(want.get(r.p))) continue;
    const tr = stripApparatus(r.tr || '').replace(/[#*|]+/g, ' ').replace(/\s+/g, ' ');
    const m = tr.match(SENT); if (!m) continue;
    // keep a wider window than the list page: 600 chars around the name, to judge what is attributed
    const i = tr.toLowerCase().indexOf(PREFIX);
    const ctx = tr.slice(Math.max(0, i - 300), i + 500);
    passages.push({ p: r.p, s: m[0].trim().slice(0, 500), ctx, q: QUOTE.test(m[0]), quoted: /["“«][^"”»]{20,}["”»]/.test(ctx) });
  }
  if (passages.length) out.push({ id: b, ...meta, passages });
}
fs.writeFileSync(OUT, JSON.stringify(out));
const pub = out.filter((b) => b.v);
console.log(PREFIX, 'books', out.length, 'public', pub.length, 'pages', out.reduce((a, b) => a + b.passages.length, 0), 'attrib-pages', out.reduce((a, b) => a + b.passages.filter((p) => p.q).length, 0));
