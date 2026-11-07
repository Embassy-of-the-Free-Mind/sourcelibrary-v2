// PRIOR ART: conformance.mts (this folder) — this prints one page's word diff behind its counts.
/** Debug view: the reader's notes-off words vs the parser's notes-off text for pages in a draw file. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { diffWordsWithSpace } from 'diff';
import { splitAnnotations, notesOffText } from '../../lib/annotation-layer.mjs';
import * as NR from '@/components/reader/NotesRenderer';
const { prepareNotesMarkdown } = ((NR as any).prepareNotesMarkdown ? NR : (NR as any).default) as typeof NR;
const [file, ...ids] = process.argv.slice(2);
const want = new Set(ids);
const strip = (s: string) => s.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
for (const l of zlib.gunzipSync(fs.readFileSync(file)).toString().split('\n')) {
  if (!l) continue;
  const r = JSON.parse(l);
  if (!want.has(r.id)) continue;
  const p = prepareNotesMarkdown(r.data, { showNotes: false, pageType: r.page_type ?? undefined });
  const R = p.isDescriptionOnly ? '' : strip(p.processedText);
  const T = strip(notesOffText(splitAnnotations(r.data)));
  console.log(`===== ${r.id} v${r.prompt_version}`);
  console.log(diffWordsWithSpace(R, T).filter((x) => x.added || x.removed).map((x) => (x.added ? `{+${x.value}+}` : `[-${x.value}-]`)).join('\n').slice(0, 1500));
}
