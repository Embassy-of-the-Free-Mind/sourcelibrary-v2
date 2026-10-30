// PRIOR ART: scripts/eval/notes-layer-5942/pilot-checks.mts runs the storage pilot's checks on pages the backfill
// WROTE. Under annotation-layer/3 nothing is written yet (the backfill is paused), so this runs the same checks on what
// /3 WOULD store — translationLayers() from scripts/lib/translation-text.mjs, the exact function the backfill calls —
// for a list of pages read from Mongo, and adds the reader-conformance oracle of conformance.mts (this folder).
/**
 * #5942 legacy syntaxes, step 4 — read-only, $0.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local node_modules/.bin/tsx \
 *     scripts/eval/notes-legacy-5942/pilot-checks-dry.mts --ids-file ids.txt --out $JOB_SCRATCH/checks-<name>
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { splitAnnotations, renderInline, renderMarkup, resolveAnchor, notesOffText } from '../../lib/annotation-layer.mjs';
import { translationLayers, parserAnnotation } from '../../lib/translation-text.mjs';
import { wordConservation } from '../notes-layer-5942/word-conservation.mjs';
import { versionOf } from './syntaxes.mjs';
import * as NR from '@/components/reader/NotesRenderer';

const { prepareNotesMarkdown } = ((NR as any).prepareNotesMarkdown ? NR : (NR as any).default) as typeof NR;
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const ids = fs.readFileSync(arg('--ids-file')!, 'utf8').split(/\s+/).filter(Boolean);
const OUT = arg('--out')!;
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const words = (s: string) => (s.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, ' ').match(WORD) || []).sort().join(' ');

const c = new MongoClient(process.env.MONGODB_URI!, { appName: 'notes-legacy-5942-checks' });
await c.connect();
const P = c.db('bookstore').collection('pages');
const S: any = {
  pages: 0, no_data: 0, by_version: {} as Record<string, number>,
  round_trip: 0, round_trip_term_lifted: 0, store_matches_parser: 0, orphans: 0,
  malformed: { pages: 0, unclosed: 0, stray: 0 },
  conservation: { comparable: 0, pages_lost: 0, pages_leaked: 0, chars_off_pages: 0 },
  anchors: { anchored: 0, slice_mismatch: 0, unresolved: 0, repeated: 0, repeated_own: 0, repeated_elsewhere: 0 },
  reader: { equal: 0, differ: 0 },
  annotations: 0, interp: 0, bytes: { text: 0, annotations: 0 },
};
for (let i = 0; i < ids.length; i += 200) {
  const docs = await P.find({ id: { $in: ids.slice(i, i + 200) } }).project({ _id: 0, id: 1, page_type: 1, 'translation.data': 1, 'translation.prompt_version': 1 }).toArray();
  for (const p of docs) {
    const data = p.translation?.data;
    if (typeof data !== 'string' || !data) { S.no_data++; continue; }
    S.pages++;
    const v = versionOf(p.translation);
    S.by_version[v] = (S.by_version[v] || 0) + 1;
    const split: any = splitAnnotations(data);
    const L = translationLayers(data, { promptVersion: p.translation.prompt_version });
    if (renderInline(split) === data) S.round_trip++; else if (split.termDefinitionsLifted) S.round_trip_term_lifted++;
    const stored = renderMarkup(L.text, L.annotations.map(parserAnnotation));
    if (stored.markup === renderMarkup(split.text, split.annotations).markup) S.store_matches_parser++;
    S.orphans += stored.orphans.length;
    const mal = split.annotations.filter((a: any) => a.malformed);
    if (mal.length) { S.malformed.pages++; S.malformed.unclosed += mal.filter((a: any) => a.malformed === 'unclosed').length; S.malformed.stray += mal.filter((a: any) => a.malformed === 'stray-close').length; }
    const cons = wordConservation(data, split);
    if (cons.comparable) {
      S.conservation.comparable++;
      if (cons.lost.length) S.conservation.pages_lost++;
      if (cons.leaked.length) S.conservation.pages_leaked++;
      if (cons.chars_lost || cons.chars_leaked) S.conservation.chars_off_pages++;
    }
    for (const a of L.annotations as any[]) {
      S.annotations++;
      if (a.type === 'interp') S.interp++;
      if (a.exact === undefined) continue;
      S.anchors.anchored++;
      if (L.text.slice(a.start, a.end) !== a.exact) S.anchors.slice_mismatch++;
      const r = resolveAnchor(L.text, parserAnnotation(a).anchor);
      if (!r) S.anchors.unresolved++;
      if (a.exact && L.text.split(a.exact).length > 2) {
        S.anchors.repeated++;
        if (r && r.start === a.start) S.anchors.repeated_own++; else if (r) S.anchors.repeated_elsewhere++;
      }
    }
    const rd = prepareNotesMarkdown(data, { showNotes: false, pageType: p.page_type ?? undefined });
    if (words(rd.isDescriptionOnly ? '' : rd.processedText) === words(notesOffText(split))) S.reader.equal++; else S.reader.differ++;
    S.bytes.text += Buffer.byteLength(L.text);
    S.bytes.annotations += Buffer.byteLength(JSON.stringify(L.annotations));
  }
}
await c.close();
fs.writeFileSync(`${OUT}.json`, JSON.stringify(S, null, 1));
console.log(JSON.stringify(S, null, 1));
