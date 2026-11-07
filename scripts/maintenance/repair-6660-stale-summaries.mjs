#!/usr/bin/env node
/**
 * Four LoC books repaired by hand in #6660 / #5620 kept summaries naming the WRONG author.
 *
 * Those repairs fixed title, author and top-level `summary`, but not `index.bookSummary`,
 * which the book page reads first. That text had been generated while the record still
 * said "Matteo Ricci, On Friendship", so the model described the real pages under the
 * false byline ("Ricci uses the dramatic story of Mulian"). localize-metadata-cli then
 * translated it faithfully into `localized.es.summary` three days after the repair.
 *
 * Only the sentences carrying the false attribution change. Everything else in these
 * summaries came from the pages and stays. Authors are the ones set by the #6660 repair,
 * from each book's title page and the LoC record.
 *
 * PRIOR ART: scripts/maintenance/repair-loc-jesuit-misfiles-6660.mjs — the repair that left
 * these fields; it has already run and writes a different field set.
 * scripts/maintenance/repair-pharar-author-2026-09-24.mjs — the three-store pattern used here.
 *
 * Writes (each replacement must match, or the book is refused):
 *   books            index.bookSummary.{brief,abstract,detailed}, localized.es.summary,
 *                    ai_metadata.description, field_provenance.summary_attribution
 *   books_catalog    summary_text, only when it carries a replaced string
 *   sweep_log        one row per book, with the old values
 *
 *   node --env-file=.env.production.local scripts/maintenance/repair-6660-stale-summaries.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'repair-6660-stale-summaries';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Field path -> ordered [from, to] replacements. */
const EDITS = {
  '69af12350092756351e44760': {
    why: 'Mulian Rescues His Mother is by Zheng Zhizhen (#6660)',
    'index.bookSummary.brief': [['Matteo Ricci bridges the divide between East and West to ask what truly constitutes a good life. He challenges us', "Zheng Zhizhen's play asks what truly constitutes a good life. It challenges us"]],
    'index.bookSummary.abstract': [['Ricci uses the dramatic story', 'Zheng Zhizhen uses the dramatic story']],
    'index.bookSummary.detailed': [['Ricci creates a vivid stage', 'Zheng Zhizhen creates a vivid stage'], ['Ricci insists that heaven', 'The play insists that heaven']],
    'localized.es.summary': [['Matteo Ricci tiende un puente sobre la división entre Oriente y Occidente para preguntarse qué constituye verdaderamente una buena vida.', 'La obra de Zheng Zhizhen se pregunta qué constituye verdaderamente una buena vida.']],
  },
  '69af123e0092756351e44874': {
    why: 'Jiao hong ji is by Meng Chengshun (#6660)',
    'index.bookSummary.brief': [['Giulio Aleni’s work transforms', 'Meng Chengshun’s play transforms']],
    'index.bookSummary.abstract': [['Aleni challenges the reader', 'Meng Chengshun challenges the reader']],
    'localized.es.summary': [['La obra de Giulio Aleni transforma', 'La obra de Meng Chengshun transforma']],
  },
  '69af124b0092756351e44955': {
    why: 'Huan you quan is by Francisco Furtado and Li Zhizao, translating Aristotle (#6660)',
    'index.bookSummary.brief': [['Matteo Ricci bridges Western', 'Francisco Furtado and Li Zhizao bridge Western']],
    'index.bookSummary.abstract': [
      ['Ricci demands that scholars', 'Furtado and Li Zhizao demand that scholars'],
      ['He presents a systematic framework', 'They present a systematic framework'],
      ['causality, he argues that', 'causality, they argue that'],
    ],
    'index.bookSummary.detailed': [
      ['Ricci argues that failing', 'The translators argue that failing'],
      ['He guides the reader', 'They guide the reader'],
      ['he has established a framework', 'they have established a framework'],
      ['Ricci does not stop at logic. He creates a cosmology', 'The book does not stop at logic. It creates a cosmology'],
      ['He describes the world', 'It describes the world'],
      ['Through his lens, the six days', 'Through this lens, the six days'],
      ['He leaves the reader', 'It leaves the reader'],
    ],
    'localized.es.summary': [['Matteo Ricci tiende un puente', 'Francisco Furtado y Li Zhizao tienden un puente']],
  },
  '69af123a0092756351e4483e': {
    why: 'Xiu ru ji (Story of the Embroidered Coat) is by Xue Jinyan (#5620)',
    'index.bookSummary.abstract': [
      ['Ten Chapters of an Extraordinary Man captures', 'Story of the Embroidered Coat captures'],
      ['Matteo Ricci frames this narrative', 'Xue Jinyan frames this narrative'],
    ],
  },
};
/** Found by scripts/audit/identity-repair-summary-scope.mjs after the first four were applied. */
EDITS['69af12630092756351e449f9'] = {
  why: 'This book is the Mozi, not Guide to Calculation (#6660)',
  'index.bookSummary.abstract': [['The *Guide to Calculation* presents', 'The *Mozi* presents']],
};
const FALSE_NAMES = /Ricci|Aleni|Ten Chapters of an Extraordinary Man|Guide to Calculation/;
// Re-running after a partial apply: name the books still to do.
const ONLY = process.argv.find((a) => a.startsWith('--book='))?.split('=')[1];
if (ONLY) for (const k of Object.keys(EDITS)) if (k !== ONLY) delete EDITS[k];

const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
let refused = 0;

for (const [id, { why, ...fields }] of Object.entries(EDITS)) {
  const b = await books.findOne({ id });
  const $set = {}, before = {};
  for (const [path, reps] of Object.entries(fields)) {
    let v = get(b, path);
    before[path] = v;
    for (const [from, to] of reps) {
      if (typeof v !== 'string' || !v.includes(from)) { console.log(`REFUSED ${id} ${path}: "${from}" not found`); refused++; continue; }
      v = v.replace(from, to);
    }
    if (FALSE_NAMES.test(v)) { console.log(`REFUSED ${id} ${path}: a false name survives: ${v.match(FALSE_NAMES)[0]}`); refused++; }
    $set[path] = v;
  }
  // On the Furtado record the enrichment description repeats the Ricci attribution.
  const ai = b.ai_metadata?.description;
  if (typeof ai === 'string' && /Matteo Ricci|Ricci/.test(ai)) {
    before['ai_metadata.description'] = ai;
    $set['ai_metadata.description'] = ai.replace(/Matteo Ricci/g, 'Francisco Furtado and Li Zhizao').replace(/Ricci/g, 'Furtado')
      .replace(/likely 'Xiguo Jifa' \(Western Methods of Memorization\)/, "Huan you quan (On Heaven and Earth)");
  }
  const [row] = await (await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${id}&select=summary_text`, { headers: H })).json();
  const stale = row?.summary_text && FALSE_NAMES.test(row.summary_text);
  console.log(`${id}: ${Object.keys($set).join(', ')}${stale ? ' + books_catalog.summary_text' : ''}`);
  for (const [p, v] of Object.entries($set)) console.log(`  ${p}: ${v.slice(0, 150)}`);
  if (!APPLY || refused) continue;

  await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: 'summary-attribution-repaired', detail: { why, before, supabase_before: stale ? row.summary_text : undefined }, script: 'repair-6660-stale-summaries.mjs' });
  const r = await books.updateOne({ id }, { $set: { ...$set, 'field_provenance.summary_attribution': { source: 'hand-adjudicated', script: 'repair-6660-stale-summaries.mjs', date: new Date().toISOString(), why } } });
  console.log(`  modified ${r.modifiedCount}`);
  if (stale) {
    const next = $set['index.bookSummary.brief'] ?? row.summary_text;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ summary_text: next }) });
    console.log(`  books_catalog ${res.status}`);
  }
}
console.log(APPLY ? (refused ? `REFUSED ${refused}; later books not written` : 'applied') : `dry run; refused ${refused}`);
await client.close();
