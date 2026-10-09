// PRIOR ART: scripts/eval/translation-vs-reference/gallery.mjs prints source, reference and candidate side by side for
// a judged run; it has no notion of an annotation or an anchor. This prints one page's split for reading by eye.
/** #5942 phase 2(c): print 40 seeded pages of the draw as text with each annotation marked at its place, for reading by eye. */
/**
 *   node node_modules/.bin/tsx scripts/eval/notes-layer/by-eye-sheet.mts [--from 0 --to 10]
 *
 * 30 pages with at least one annotation and 10 without, seed 5942. Each annotation is shown where it sits as
 * ⟦type → "anchor phrase" ×occurrences: body⟧; page-level blocks are listed after the text.
 */
import fs from 'node:fs';
import { parseTranslationLayers } from '@/lib/translation-layers';
import { makeRng } from '../lib/paired-stats.mjs';

const DIR = new URL('../results/notes-layer-2026-10/parser/', import.meta.url).pathname;
const args = process.argv.slice(2); const opt = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const pages = fs.readFileSync(`${DIR}work/pages.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rng = makeRng(5942);
const shuffled = pages.map((p: any) => ({ p, layers: parseTranslationLayers(p.data, { promptVersion: p.prompt_version }) }));
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const sample = [...shuffled.filter((x) => x.layers.annotations.length).slice(0, 30), ...shuffled.filter((x) => !x.layers.annotations.length).slice(0, 10)];
fs.writeFileSync(`${DIR}by-eye-sample.json`, JSON.stringify(sample.map((x, n) => ({ n: n + 1, book_id: x.p.book_id, page_number: x.p.page_number, annotations: x.layers.annotations.length })), null, 1));
sample.slice(opt('from', 0), opt('to', 40)).forEach((x, k) => {
  const { p, layers } = x; let out = ''; let pos = 0;
  for (const a of layers.annotations) {
    out += layers.text.slice(pos, a.layout.at) + `⟦${a.type} → ${a.anchor.phrase == null ? 'ALONE' : JSON.stringify(a.anchor.phrase)}×${a.anchor.occurrences}${a.layout.term !== undefined ? ' (glossary)' : ''}: ${a.body.slice(0, 110)}${a.body.length > 110 ? '…' : ''}⟧`;
    pos = a.layout.at;
  }
  out += layers.text.slice(pos);
  console.log(`\n===== ${opt('from', 0) + k + 1}. ${p.book_id} p.${p.page_number} v${p.prompt_version} ${p.language} type=${p.page_type} ann=${layers.annotations.length}`);
  console.log(out.trim());
  for (const b of layers.pageLevel) console.log(`  [${b.kind}] ${b.body.slice(0, 160)}`);
});
