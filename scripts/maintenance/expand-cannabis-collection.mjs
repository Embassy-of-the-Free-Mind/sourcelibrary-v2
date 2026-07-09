// Expands the cannabis collection: globalizes the framing (now includes the
// Chinese & Indian classics), tags the newly-acquired Western works and the
// already-held Eastern materia medica.
import { MongoClient, ObjectId } from 'mongodb';
const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
if (!uri) { console.error('No MONGODB_URI'); process.exit(1); }
const SLUG = 'cannabis-western-record';

const NEW_META = {
  subtitle: "Cannabis in the world's written record — from the Chinese and Indian classics to Hooke's Royal Society and the Decadents",
  description:
    "Cannabis enters the written record on three continents. In China the <em>Shennong Bencao Jing</em> warns that eating its flowers \"makes people see ghosts and run wildly\"; in India the Ayurvedic and tantric pharmacologists knew it as <em>bhaṅgā</em> and <em>vijayā</em>, \"the victorious.\" In Europe it was first the fiber-crop <em>kannabis</em> of Dioscorides, then the \"bangue\" the Portuguese met in the Indies — until Robert Hooke read <em>An Account of the Plant, call'd Bangue</em> to the Royal Society in 1689 and named it \"Indian hemp.\" This collection follows the plant across the world's traditions and across the two centuries after Hooke: the Chinese herbals, the Ayurvedic classics, the Orientalists who recovered the legend of the Assassins, the alienists — O'Shaughnessy and Moreau de Tours — who carried it into modern medicine and psychiatry, the Decadent literature of Baudelaire and Ludlow, and the fin-de-siècle occultists for whom Indian hemp was the sorcerer's key. One plant, read in turn as medicine, menace, muse, and mystery.",
};

// Newly acquired Western works (this session)
const NEW_WESTERN = [
  '6a356ea287fae58c35bbca59', // O'Shaughnessy, Bengal Dispensatory (1841)
  '6a356eac87fae58c35bbcacc', // Moreau de Tours, Du hachisch (1845)
  '6a356eb487fae58c35bbcc94', // Ludlow, The Hasheesh Eater (1857)
  '6a356ebb87fae58c35bbce11', // Bayard Taylor, Lands of the Saracen (1856)
  '6a356ec887fae58c35bbcfe8', // Indian Hemp Drugs Commission Report (1894)
  '6a356ecfea27ed96662d77a0', // Hammer-Purgstall, Geschichte der Assassinen (1818)
  '6a356ee2ea27ed96662d790c', // Garcia de Orta, Coloquios (Portuguese, 1563/1891)
];

// Already-held Eastern texts with CONFIRMED cannabis content
const EASTERN_CONFIRMED = [
  '69ee19caa478f461b9eb6357', // Shennong Bencao Jing (Divine Farmer's) — mafen
  '6992cd5a43713c66ea635f8d', // Li Shizhen, Compendium of Materia Medica (1596)
  '69e788094a6785cfd60ceb41', // Bencao Gangmu, Vol. 10 (1888)
  '6992cefbf7519cdd65044ae0', // Wu Qijun, Zhiwu Mingshi Tukao, Vol. 1 (1848) — 大麻
  '69d006973b94fe3961729712', // Rasa-Jala-Nidhi (bhang/ganja preparations)
];

const ADD = [...NEW_WESTERN, ...EASTERN_CONFIRMED];

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const colls = db.collection('collections');

await colls.updateOne({ slug: SLUG }, { $set: { ...NEW_META, updated_at: new Date() } });
console.log('Updated collection framing → global');

let tagged = 0, missed = [];
for (const bid of ADD) {
  const q = { $or: [{ id: bid }] };
  try { q.$or.push({ _id: new ObjectId(bid) }); } catch {}
  const r = await books.updateOne(q, { $addToSet: { collections: SLUG }, $set: { updated_at: new Date() } });
  if (r.matchedCount === 1) tagged++; else missed.push(bid);
}
// Seven Sisters of Sleep already existed — tag by title match
const ss = await books.updateOne(
  { title: /seven sisters of sleep/i },
  { $addToSet: { collections: SLUG }, $set: { updated_at: new Date() } }
);
console.log(`Tagged ${tagged}/${ADD.length} by id; Seven Sisters matched=${ss.matchedCount}`);
if (missed.length) console.log('MISSED:', missed);

const taggedDocs = await books.find({ collections: SLUG }, { projection: { language: 1, visible: 1, pages_count: 1, title: 1, published: 1 } }).toArray();
const live = taggedDocs.filter(b => b.visible !== false && (b.pages_count || 0) > 0);
const langMap = {};
for (const b of live) { const l = b.language || 'Unknown'; langMap[l] = (langMap[l] || 0) + 1; }
const languages = Object.entries(langMap).map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count);
await colls.updateOne({ slug: SLUG }, { $set: { book_count: live.length, languages, updated_at: new Date() } });
console.log(`\nbook_count=${live.length} (of ${taggedDocs.length} tagged) | languages:`, JSON.stringify(languages));
console.log('\nFull collection roster:');
for (const b of taggedDocs.sort((a,b)=>String(a.published).localeCompare(String(b.published))))
  console.log(`  ${String(b.published||'?').padStart(5)}  ${b.title}`);
await client.close();
