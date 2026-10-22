// READ (#7119): per leaf, either an edition-anchored collation (3a, Opus) where LOCATE placed the leaf, or a free
// read of each half (3b, Fable) where it did not. Writes reads/collate/<page>-<leaf>.txt or
// reads/free/<page>-<leaf><L|R>.txt (+meta).
//   node collate.mjs <first-page> <last-page> [--concurrency=3]
// PRIOR ART: ../whish147-palm-leaf-opus-2026-10-21/collation-multileaf/ — the collation prompt measured there
// (Opus caught 25/36 planted errors); its outputs/ show the shape: a row-by-row collation, then a DIFFERENCES list
// marked certain/uncertain. This keeps that instruction and adds the row text the page needs.
import fs from 'node:fs';
import path from 'node:path';
import { sealedCall, pool, crop, boxes, HERE } from './lib.mjs';
import { corpus } from './locate.mjs';

const LAYOUT = `Layout: the leaf has two string holes. The top and bottom rows run the full width; the rows in between are split into blocks around the holes, and the rows on either side of a hole do NOT always line up (a block can have one row more or fewer than its neighbour). Never join a row in one block to the row below it in the next block. p01 is cut from p02 at the middle of the leaf, so a word at the right edge of p01 may continue at the left edge of p02.`;

export function collatePrompt(work, excerpt) {
  return `The files p01.jpg and p02.jpg are the LEFT and RIGHT halves of one palm leaf of a Kerala manuscript (Sanskrit in Malayalam script, Calicut 1822). Open both with the Read tool.

${LAYOUT}

Below is the passage of ${work.name} (${work.source}) that a first pass placed on this leaf. It may begin a little before the leaf and run a little past it.

EDITION:
<<<
${excerpt}
>>>

Collate the LEAF against the EDITION, ROW BY ROW, separately in each half. For each row, find the stretch of the edition it carries and compare word by word. List every place where the leaf differs from the edition: a different word or letter, a word added or missing, words in another order. Mark each difference certain (you can clearly see the leaf's letters) or uncertain. Scribal spelling habits (gemination after r, anusvāra written as n or m, visarga before s written as s, single t in sattva) are not differences: ignore them.

Then write the TEXT of each row: the edition's words for the stretch that row carries, with each CERTAIN difference written as the leaf has it, each UNCERTAIN one written as  edition-word [leaf: what you see?]  and [illegible] for any part of the row you cannot match to the edition. Never write edition words for a part of a row you could not see on the leaf. Write in IAST.

Answer in exactly this form:
TEXT p01
ROW 1 | <text>
ROW 2 | <text>
TEXT p02
ROW 1 | <text>
DIFFERENCES
- p01 ROW n | <edition reading> | <leaf reading> | certain/uncertain
NOTE | <one line: anything the reader of this leaf should know, e.g. a stretch not in the edition>`;
}

export const FREE_PROMPT = `The file p01.jpg is one half of a palm leaf of a Kerala manuscript: Sanskrit (and possibly some Malayalam) in Malayalam script, Calicut 1822. Open it with the Read tool.

The leaf has string holes; the rows on either side of a hole do not always line up, so read each block of rows on its own and never join a row to the row below it in the next block. The image is cut at the middle of the leaf, so rows may break off mid-word at an edge.

Transcribe what you can see, ROW BY ROW, in IAST transliteration. Write [illegible] for any word or stretch you cannot read. Do not fill anything in from memory of a known text, and do not guess a word from the context: write only letters you can see. Malayalam (not Sanskrit) words are transliterated the same way.

Answer in exactly this form and nothing else:
ROW 1 | <text>
ROW 2 | <text>
...
NOTE | <one line: e.g. how much of the half you could read>`;

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const conc = Number((process.argv.find((a) => a.startsWith('--concurrency=')) || '=3').split('=')[1]);
  const [a, b] = args.map(Number);
  const { text, parts } = corpus();
  const loc = {};
  for (const f of fs.readdirSync(HERE).filter((f) => /^locate-.*\.json$/.test(f))) Object.assign(loc, JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8')));
  const B = boxes();
  const tasks = [];
  const order = Object.keys(B).map(Number).sort((x, y) => x - y).flatMap((n) => Object.keys(B[n].leaves).map((lf) => `${n}-${lf}`));
  for (let n = a; n <= b; n++) for (const leaf of Object.keys(B[n]?.leaves || {})) tasks.push({ n, leaf });
  await pool(tasks, conc, async ({ n, leaf }) => {
    const key = `${n}-${leaf}`, l = loc[key];
    if (l?.work) {
      // Excerpt in corpus offsets: the leaf's span, run on to where the next located leaf starts (so a leaf that
      // ends one work and opens the next, like 11-t, gets both), plus a margin either side.
      const g = (x) => parts.find((p) => p.work === x.work).start;
      const i = order.indexOf(key);
      const next = order.slice(i + 1).map((k) => loc[k]).find((x) => x?.work);
      const gs = g(l) + l.start, ge = Math.max(g(l) + l.end, next ? Math.min(g(next) + next.start, g(l) + l.end + 1500) : 0);
      let s = Math.max(0, gs - 150), e = Math.min(text.length, ge + 150);
      while (s > 0 && !/\s/.test(text[s])) s--;
      while (e < text.length && !/\s/.test(text[e])) e++;
      const ws = parts.filter((p) => p.end > s && p.start < e);
      const w = ws.length === 1 ? ws[0] : { name: ws.map((p) => p.name).join(', then '), source: ws.map((p) => p.source).join('; ') };
      // The GRETIL Tarkasaṃgraha gives every sentence twice, as written and then split with hyphens (pada-arthāḥ):
      // drop the split copies. Only applied when the excerpt reaches the Tarkasaṃgraha.
      const dedup = (t) => (ws.some((p) => p.work === 'ts') ? t.split('\n').filter((ln) => !/\p{L}-\p{L}/u.test(ln)).join('\n') : t);
      const excerpt = dedup(text.slice(s, e).trim());
      fs.mkdirSync(path.join(HERE, 'reads', 'collate'), { recursive: true });
      fs.writeFileSync(path.join(HERE, 'reads', 'collate', `${key}.excerpt.json`), JSON.stringify({ works: ws.map((p) => p.work), corpus_start: s, corpus_end: e, chars: excerpt.length }));
      const r = await sealedCall({ stage: 'collate', id: key, model: 'opus', prompt: collatePrompt(w, excerpt), images: [crop(n, leaf, 'L'), crop(n, leaf, 'R')] });
      console.log(`${key} collate ${r.meta.ok ? 'ok' : r.meta.error_class} ${r.meta.secs}s${r.cached ? ' cached' : ''}`);
    } else if (l && l.status !== 'not-text') {
      for (const half of ['L', 'R']) {
        const r = await sealedCall({ stage: 'free', id: `${key}${half}`, model: 'fable', prompt: FREE_PROMPT, images: [crop(n, leaf, half)] });
        console.log(`${key}${half} free ${r.meta.ok ? 'ok' : r.meta.error_class} ${r.meta.model} ${r.meta.secs}s${r.cached ? ' cached' : ''}`);
      }
    } else console.log(`${key}: ${l ? 'not text' : 'not located yet'}, no read`);
  });
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
