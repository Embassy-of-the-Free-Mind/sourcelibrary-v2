// PRIOR ART: scripts/eval/notes-layer-5942/pilot-checks.mts compared the parser's clean TEXT with today's notes-off
// reader (prepareNotesMarkdown, squashed). This gate compares what the READER RENDERS (ReaderProse → NotesRenderer, to
// static HTML) from today's `translation.data` and from the layer (translation.text + the newest current
// page_annotations doc, composed by layerMarkup), notes on and off — the #7965 step-1 gate.
/**
 * #7965 step 1 gate. Read-only, $0.
 *
 *   node --env-file=<main>/.env.production.local node_modules/.bin/tsx scripts/eval/notes-reader-7965/gate.mts \
 *     --n 400 --out $JOB_SCRATCH/gate [--ids <file of page ids, one per line, to re-run a draw>]
 *
 * Draw: $sample over page_annotations, one page per book, kept only when the page's translation.text is current and
 * the doc is the newest current one (the page takes the new path). Writes <out>.jsonl (one row per page, with both
 * visible texts on any diff), <out>.json (counts by class) and <out>-ids.txt (the draw).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { diffWordsWithSpace } from 'diff';
import { translationTextIsCurrent, getTranslationText, layerMarkup } from '../../lib/translation-text.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
import * as RB from '@/components/reader-v2/ReaderV2Bits';

const { ReaderProse } = ((RB as any).ReaderProse ? RB : (RB as any).default) as typeof RB;
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const N = Number(arg('--n') || 400), OUT = arg('--out')!, IDS = arg('--ids');

const client = new MongoClient(process.env.MONGODB_URI!, { appName: 'notes-reader-gate-7965' });
await client.connect();
const db = client.db('bookstore');
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, columns: 1, ocr: 1, translation: 1, translation_withheld: 1 };

async function newestDoc(p: any) {
  return db.collection('page_annotations').findOne({ page_id: p.id, data_hash: contentHash(p.translation.data) }, { sort: { created_at: -1 } });
}

let ids: string[];
if (IDS) ids = fs.readFileSync(IDS, 'utf8').trim().split('\n');
else {
  const seen = new Set<string>();
  ids = [];
  while (ids.length < N) {
    const sample = await db.collection('page_annotations').aggregate([{ $sample: { size: 3000 } }, { $project: { _id: 0, page_id: 1, book_id: 1 } }]).toArray();
    for (const d of sample) if (!seen.has(d.book_id)) { seen.add(d.book_id); ids.push(d.page_id); }
    ids = ids.slice(0, N * 2);
    if (ids.length >= N * 2 || sample.length < 3000) break;
  }
}

const settings = (glosses: boolean): any => ({ theme: 'light', textScale: 1, lineWidth: 'comfortable', typeface: 'serif', lineHeight: 1.6, glosses, translationLang: 'en' });
const visible = (h: string) => h.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|li|h\d|div|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const render = (p: any, books: Map<string, any>, data: string, glosses: boolean) => renderToStaticMarkup(React.createElement(ReaderProse, {
  page: { ...p, translation: { ...p.translation, data } }, book: books.get(p.book_id) || { id: p.book_id, language: 'Latin' },
  kind: 'translation', settings: settings(glosses), baseSize: 18.5,
} as any));

// A visible difference, by what it is. Order matters: the first rule that holds names the class.
const norm = (s: string) => s.replace(/[\s"“”'’.,;:()\[\]*_]+/g, '').toLowerCase();
function classify(today: string, layer: string, anns: any[]): string {
  if (today.replace(/\s+/g, '') === layer.replace(/\s+/g, '')) return 'spacing';
  const d = diffWordsWithSpace(squash(today), squash(layer)).filter((x) => x.added || x.removed);
  const words = (x: string) => /[\p{L}\p{N}]/u.test(x);
  const added = d.filter((x) => x.added && words(x.value)), removed = d.filter((x) => x.removed && words(x.value));
  const bodies = norm(anns.filter((a) => a.kind === 'commentary' || a.scope === 'page').map((a) => `${a.body ?? ''}`).join(' '));
  const inBodies = (x: string) => norm(x).length > 0 && bodies.includes(norm(x));
  // Word-level too: the renderer runs a chip into its neighbour ("SeresA classical name…"), which no substring finds.
  const bodyWords = new Set(anns.filter((a) => a.kind === 'commentary' || a.scope === 'page').flatMap((a) => `${a.body ?? ''}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  const termWords = new Set(anns.filter((a) => a.type === 'term' || a.glossary).flatMap((a) => `${a.exact ?? a.term ?? ''}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  const mostlyBodies = (x: string) => {
    const w = x.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const hits = w.filter((t) => bodyWords.has(t) || [...termWords].some((k) => t.startsWith(k) && bodyWords.has(t.slice(k.length)))).length;
    return w.length > 0 && hits / w.length >= 0.8;
  };
  const addedOnlyTerms = (x: string) => (x.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).every((t) => termWords.has(t));
  if (removed.length && removed.every((x) => inBodies(x.value) || mostlyBodies(x.value)) && added.every((x) => addedOnlyTerms(x.value))) return 'today-shows-model-words';
  if (added.length && !removed.length && added.every((x) => inBodies(x.value))) return 'layer-shows-model-words';
  if (!added.length && !removed.length) return 'punctuation';
  return 'other';
}

// Tags of the closed vocabulary in the composed markup must nest: a crossed pair is a composer bug.
function crossed(markup: string): number {
  const stack: string[] = [];
  let bad = 0;
  for (const m of markup.matchAll(/<(\/?)(note|image-desc|margin|gloss|insert|unclear|term)(?:\s[^<>]*)?>/gi)) {
    const name = m[2].toLowerCase();
    if (!m[1]) { stack.push(name); continue; }
    if (stack[stack.length - 1] === name) stack.pop();
    else { bad++; const k = stack.lastIndexOf(name); if (k >= 0) stack.splice(k, 1); }
  }
  return bad + stack.length;
}

const rows: any[] = [];
const S: any = { drawn: ids.length, kept: 0, skipped: { not_current: 0, no_doc: 0, withheld_or_empty: 0, orphans_fallback: 0 }, on: {}, off: {} };
const bump = (o: any, k: string) => { o[k] = (o[k] || 0) + 1; };
for (let i = 0; i < ids.length && S.kept < N; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const pages = await db.collection('pages').find({ id: { $in: chunk } }, { projection: PROJ }).toArray();
  const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } }, { projection: { _id: 0, id: 1, slug: 1, title: 1, language: 1 } }).toArray()).map((b) => [b.id, b]));
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const id of chunk) {
    if (S.kept >= N) break;
    const p: any = byId.get(id);
    if (!p?.translation?.data) { S.skipped.withheld_or_empty++; continue; }
    if (!translationTextIsCurrent(p.translation)) { S.skipped.not_current++; continue; }
    const doc = await newestDoc(p);
    if (!doc) { S.skipped.no_doc++; continue; }
    const markup = layerMarkup(getTranslationText(p), doc.annotations);
    if (markup === null) { S.skipped.orphans_fallback++; rows.push({ id, fallback: 'orphans' }); continue; }
    S.kept++;
    const cx = crossed(markup);
    if (cx) { S.crossed_tags = (S.crossed_tags || 0) + 1; }
    const row: any = { id, book_id: p.book_id, slug: books.get(p.book_id)?.slug, title: books.get(p.book_id)?.title, language: books.get(p.book_id)?.language, page_number: p.page_number, prompt_version: p.translation.prompt_version, source: doc.source, run_id: doc.run_id, n_ann: doc.annotations.length, crossed: cx };
    for (const g of [true, false]) {
      const k = g ? 'on' : 'off';
      const a = render(p, books, p.translation.data, g), b = render(p, books, markup, g);
      const va = visible(a), vb = visible(b);
      let cls: string;
      if (a === b) cls = 'html-identical';
      else if (va === vb) cls = 'visible-identical';
      else if (squash(va) === squash(vb)) cls = 'whitespace-only';
      else cls = classify(va, vb, doc.annotations);
      bump(S[k], cls);
      row[k] = { cls };
      if (cls !== 'html-identical' && cls !== 'visible-identical') {
        const d = diffWordsWithSpace(squash(va), squash(vb)).filter((x) => x.added || x.removed).map((x) => ({ op: x.added ? '+' : '-', v: x.value }));
        row[k].diff = d;
        row[k].today = va; row[k].layer = vb;
      }
    }
    rows.push(row);
  }
}
fs.writeFileSync(`${OUT}-ids.txt`, ids.join('\n') + '\n');
fs.writeFileSync(`${OUT}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(`${OUT}.json`, JSON.stringify(S, null, 1));
console.log(JSON.stringify(S, null, 1));
await client.close();
