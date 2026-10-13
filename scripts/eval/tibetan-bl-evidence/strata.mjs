// PRIOR ART: scripts/eval/tibetan-nyingma-reference/sample_nyingma.mjs (title regex for the Nyingma stratum) and
// /root/tibetan-eval/redraw-2026-10-01/sample_tib_redraw.mjs (Kangyur regex). Neither enumerates the HELD set or the
// terma/biography and monastery-collection strata this run needs (#4523). Read-only.
//   node --env-file=/root/sourcelibrary/.env.production.local strata.mjs > strata.json
import { createRequire } from 'module';
const require = createRequire('/root/sourcelibrary/package.json');
const { MongoClient } = require('mongodb');
// EAP project/series -> monastery collection (EAP039 Gangtey; EAP105/1 Drametse, EAP105/2 Ogyen Choling, from the
// manifests' catalogue numbers in our ft-pilot rows; EAP310/1-4 from the series titles).
const COLL = { 'EAP039-1': 'gangtey', 'EAP105-1': 'drametse', 'EAP105-2': 'ogyen-choling', 'EAP310-1': 'thadrak',
  'EAP310-2': 'neyphug', 'EAP310-3': 'phurdrup', 'EAP310-4': 'tshamdrak' };
const KANJUR = /kanjur|kangyur|bka'? ?'?gyur/i;
// Prajñāpāramitā and other canonical sūtras shelved as "Thor bu" (loose) volumes; Kangyur text, not Kangyur-titled.
const KANJUR_LIKE = /brgyad stong|khri brgyad|nyi khri|rdo rje gcod pa|gser 'od dam pa|mtshan lnga stong/i;
const NYINGMA = /rnying ?(ma'?i? )?rgyud|tsham ?drak|mtshams ?brag|rnying ma rgyud 'bum/i;
const TERMA = [
  ['kun-bzang-dgongs-dus', /kun bzang dgongs/i],
  ['padma-bka-thang', /bka['’‘]? ?thang|thang yig/i],
  ['mani-bka-bum', /ma ?ni bka['’‘]? ?['’‘]?bum/i],
  ['milarepa', /mi la|ras chung|mgur ['’‘]?bum|bzhad pa rdo rje/i],
  ['dgongs-dus', /dgongs ['’‘]?dus/i],
  ['zhi-khro-bardo', /zhi khro|bar do|thos grol|kar gling/i],
  ['namthar', /rnam ?['’‘]?thar|skyes rabs/i],
];
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const books = await c.db('bookstore').collection('books').find({ 'pipeline_auto.hold.reason': 'tibetan-retranslation-awaits-derek' },
  { projection: { id: 1, title: 1, display_title: 1, image_source: 1, pages_count: 1, pages_translated: 1, visible: 1 } }).toArray();
await c.close();
const out = books.map((b) => {
  const t = b.display_title || b.title || '';
  const m = (b.image_source?.source_url || '').match(/EAP\d+-\d+/);
  let stratum = 'other', work = null;
  if (NYINGMA.test(t)) stratum = 'nyingma';
  else if (KANJUR.test(t) || KANJUR_LIKE.test(t)) stratum = 'kangyur';
  else for (const [k, re] of TERMA) if (re.test(t)) { stratum = 'terma-bio'; work = k; break; }
  return { id: b.id, title: t, coll: COLL[m?.[0]] || 'unknown', stratum, work, pages: b.pages_count || 0,
    pages_translated: b.pages_translated || 0, visible: !!b.visible };
}).sort((a, b) => a.id.localeCompare(b.id));
const agg = (f) => { const r = {}; for (const o of out) { const k = f(o); r[k] ||= { books: 0, pages: 0 }; r[k].books++; r[k].pages += o.pages; } return r; };
console.error(JSON.stringify({ held: out.length, by_stratum: agg((o) => o.stratum), by_work: agg((o) => o.work || '-') }, null, 1));
console.log(JSON.stringify(out));
