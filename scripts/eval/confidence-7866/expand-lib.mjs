// PRIOR ART: ./lib.mjs (OUT, SEED, FRAME for #7866) and scripts/eval/severity-cal-7263/lib.mjs (#8136: the Opus-call
// ledger that holds a study under its cap; restated, that file is not on main). These are #7263 judged-expand's own
// constants; the instrument and the frame stay ./lib.mjs's.
/** Constants of #7263 judged-expand (scripts/eval/experiments/2026-11-04-judged-expand-prereg-7263.md). */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const EX_OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'judged-expand-7263'));
export const EX_SEED = 72631;
/** Books a language × script cell is brought up to; languages with fewer live books than MIN_LIVE are listed, not drawn. */
export const TARGET = 30, MIN_LIVE = 100;
/** books.language values that are ISO codes for a language the corpus otherwise names in full. */
export const LANG_ALIAS = Object.freeze({ la: 'Latin', de: 'German', en: 'English', fr: 'French', it: 'Italian', es: 'Spanish', nl: 'Dutch',
  el: 'Greek', grc: 'Greek', he: 'Hebrew', ar: 'Arabic', fa: 'Persian', ru: 'Russian', ko: 'Korean', ja: 'Japanese', zh: 'Chinese', sa: 'Sanskrit',
  bo: 'Tibetan', syr: 'Syriac', pt: 'Portuguese' });
/** The brief: Chinese print and Sanskrit print are not topped up (Sanskrit print uses severity-cal-7263's 30 stored reads). */
export const NO_TOPUP = ['Chinese|print', 'Sanskrit|print'];
/** severity-cal-7263's run directory (sample.json, key.json, route-s1.jsonl): read, never written. */
export const SEV_CAL_DIR = process.env.SEV_CAL_DIR || '/mnt/HC_Volume_105839809/jobs/severity-cal-7263/severity-cal-7263';
/** Study caps (the brief): pages judged, and Opus calls of every stage together. */
export const PAGE_CAP = 1000, OPUS_CAP = 1300;
/** The second reader sees a seeded random SECOND_SHARE of the serious spans. */
export const SECOND_SHARE = 0.2;
export const TEST_ID = 'judged-expand-7263';
export const RECORD = 'scripts/eval/experiments/2026-11-04-judged-expand-7263.md';

export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export function shuffle(xs, rng) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/**
 * A book's script: books.book_class.class when it says printed or handwritten; else the majority (at least two thirds)
 * of its OCR'd pages' script_type; else unclassified (mixed, or no signal), which enters no cell and is counted.
 */
export async function bookScripts(db, books) {
  const out = new Map(), ask = [];
  for (const b of books) {
    const k = b.book_class?.class;
    if (k === 'printed') out.set(b.id, { script: 'print', basis: 'book_class' });
    else if (k === 'handwritten') out.set(b.id, { script: 'manuscript', basis: 'book_class' });
    else if (k === 'mixed') out.set(b.id, { script: 'unclassified', basis: 'book_class mixed' });
    else ask.push(b.id);
  }
  for (let i = 0; i < ask.length; i += 300) {
    const rows = await db.collection('pages').aggregate([
      { $match: { book_id: { $in: ask.slice(i, i + 300) }, script_type: { $in: ['printed', 'handwritten'] } } },
      { $group: { _id: { b: '$book_id', s: '$script_type' }, n: { $sum: 1 } } }]).toArray();
    const by = new Map();
    for (const r of rows) { const e = by.get(r._id.b) ?? { printed: 0, handwritten: 0 }; e[r._id.s] = r.n; by.set(r._id.b, e); }
    for (const id of ask.slice(i, i + 300)) {
      const e = by.get(id), n = e ? e.printed + e.handwritten : 0;
      out.set(id, !n ? { script: 'unclassified', basis: 'no book_class, no page script_type' }
        : e.printed / n >= 2 / 3 ? { script: 'print', basis: 'page script_type majority' }
          : e.handwritten / n >= 2 / 3 ? { script: 'manuscript', basis: 'page script_type majority' }
            : { script: 'unclassified', basis: 'page script_type split' });
    }
  }
  return out;
}

const LEDGER = () => path.join(EX_OUT, 'opus-calls.jsonl');
export const opusUsed = () => jsonl(LEDGER()).length;
export function noteOpus(stage, id, r) {
  fs.mkdirSync(EX_OUT, { recursive: true });
  fs.appendFileSync(LEDGER(), JSON.stringify({ stage, id, cls: r.cls, model: r.model, usage: r.usage, list_usd: r.cost, at: new Date().toISOString() }) + '\n');
}
