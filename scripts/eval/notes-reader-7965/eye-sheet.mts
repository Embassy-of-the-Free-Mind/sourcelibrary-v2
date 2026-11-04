// PRIOR ART: scripts/eval/notes-layer-5942/pilot-checks.mts builds a spot-check sheet of raw/clean text; this one
// builds the #7965 by-eye packet: per page the scan (downloaded), and what the reader shows from the LAYER with notes
// off and on, plus today's render where they differ. Read-only, $0.
//   node --env-file=<main>/.env.production.local node_modules/.bin/tsx scripts/eval/notes-reader-7965/eye-sheet.mts \
//     --gate $JOB_SCRATCH/final.jsonl --n 40 --out $JOB_SCRATCH/eye
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getPageImageUrl } from '@/lib/page-image-url';
import { layerMarkup, getTranslationText } from '../../lib/translation-text.mjs';
import * as RB from '@/components/reader-v2/ReaderV2Bits';
const { ReaderProse } = ((RB as any).ReaderProse ? RB : (RB as any).default) as typeof RB;
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const GATE = arg('--gate')!, N = Number(arg('--n') || 40), OUT = arg('--out')!;
fs.mkdirSync(OUT, { recursive: true });
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rows = fs.readFileSync(GATE, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.on);
// 30 pages whose visible text differs, most serious class first (words before spacing), then 10 seeded random pages
// whose text is identical, so the by-eye read also covers what most readers get.
const RANK: Record<string, number> = { other: 0, 'layer-shows-model-words': 0, 'today-shows-model-words': 1, punctuation: 2, spacing: 3, 'whitespace-only': 4 };
const rank = (r: any) => Math.min(...['on', 'off'].map((k) => RANK[r[k].cls] ?? 9));
const differs = (r: any) => rank(r) < 9;
const picked = rows.filter(differs).sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1)).slice(0, N - 10);
const rest = rows.filter((r) => !differs(r)).sort((a, b) => (a.id < b.id ? -1 : 1));
const rand = mulberry32(7965);
for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
const sel = [...picked.slice(0, N), ...rest].slice(0, N);
const c = new MongoClient(process.env.MONGODB_URI!, { appName: 'notes-reader-eye-7965' }); await c.connect();
const db = c.db('bookstore');
const visible = (h: string) => h.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|li|h\d|div|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
const settings = (g: boolean): any => ({ theme: 'light', textScale: 1, lineWidth: 'comfortable', typeface: 'serif', lineHeight: 1.6, glosses: g, translationLang: 'en' });
const index: any[] = [];
let k = 0;
for (const r of sel) {
  k++;
  const p: any = await db.collection('pages').findOne({ id: r.id }, { projection: { _id: 0 } });
  const book: any = await db.collection('books').findOne({ id: p.book_id }, { projection: { _id: 0, id: 1, slug: 1, title: 1, language: 1 } });
  const doc: any = await db.collection('page_annotations').findOne({ page_id: r.id, data_hash: p.translation.text_from.data_hash }, { sort: { created_at: -1 } });
  const markup = layerMarkup(getTranslationText(p), doc.annotations)!;
  const rend = (data: string, g: boolean) => visible(renderToStaticMarkup(React.createElement(ReaderProse, { page: { ...p, translation: { ...p.translation, data } }, book, kind: 'translation', settings: settings(g), baseSize: 18.5 } as any)));
  const url = getPageImageUrl(p, 'display');
  const img = `${OUT}/${String(k).padStart(2, '0')}-${r.id}.jpg`;
  let got = false;
  if (url) {
    const abs = url.startsWith('http') ? url : `https://sourcelibrary.org${url}`;
    const headers: Record<string, string> = abs.includes('sourcelibrary.org') ? { Authorization: `Bearer ${fs.readFileSync('/root/.sl-internal-key', 'utf8').trim()}` } : {};
    try { const res = await fetch(abs, { headers }); if (res.ok) { fs.writeFileSync(img, Buffer.from(await res.arrayBuffer())); got = true; } } catch { /* listed below */ }
  }
  const cap = (s: string, n = 3500) => (s.length > n ? s.slice(0, n) + `\n… [${s.length - n} more chars]` : s);
  let md = `# ${k}. ${book?.title} — p. ${p.page_number}\n\nhttps://sourcelibrary.org/book/${book?.slug || p.book_id}/page/${p.id}\nlanguage ${book?.language} · prompt v${p.translation.prompt_version} · doc ${doc.source} · ${doc.annotations.length} annotations · gate: on=${r.on.cls}, off=${r.off.cls}\nimage: ${got ? img : 'NOT DOWNLOADED ' + url}\n\n`;
  md += `## LAYER, notes OFF (what a reader sees)\n\n${cap(rend(markup, false))}\n\n## LAYER, notes ON\n\n${cap(rend(markup, true))}\n\n`;
  md += `## Annotations (commentary) in the layer\n\n${doc.annotations.filter((a: any) => a.kind === 'commentary').slice(0, 40).map((a: any, i: number) => `${i + 1}. [${a.type}] after “${(a.exact ?? '').slice(-60)}”: ${(a.body ?? '').slice(0, 200)}`).join('\n') || 'none'}\n\n`;
  for (const g of ['on', 'off']) if (r[g].diff) md += `## Visible diff, notes ${g.toUpperCase()} ([-today only-] {+layer only+})\n\n${r[g].diff.slice(0, 20).map((d: any) => (d.op === '+' ? `{+${d.v.trim().slice(0, 300)}+}` : `[-${d.v.trim().slice(0, 300)}-]`)).join('\n')}\n\n`;
  fs.writeFileSync(`${OUT}/${String(k).padStart(2, '0')}-${r.id}.md`, md);
  index.push({ k, id: r.id, title: book?.title, language: book?.language, page_number: p.page_number, on: r.on.cls, off: r.off.cls, image: got, url: `https://sourcelibrary.org/book/${book?.slug || p.book_id}/page/${p.id}` });
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));
console.log(`${index.length} sheets, ${index.filter((x) => x.image).length} images, ${picked.length} differing pages in the gate`);
await c.close();
