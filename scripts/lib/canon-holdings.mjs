// PRIOR ART: scripts/catalog-coverage/canon-gap-map.mjs holdings() (#5519) — this IS that code,
// moved out so the canon-gap STATUS file (#5513) counts the same books the gap map counted. The gap
// map summed them once; the status file re-counts them on every run, so the selectors must have one home.
//
// canon-holdings — which books we hold for each open typed corpus of the canon gap map (#5513).
// Indexed queries only (language, collections, id). Selectors are by edition where an edition can be
// told (Derge Tengyur/Kangyur by BDRC scan id or Esukhia), otherwise "any edition" — each set carries
// its `method` sentence, and the readers quote it.

const PROJ = {
  projection: {
    id: 1, title: 1, english_title: 1, language: 1, visible: 1, hidden: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    collections: 1, 'image_source.provider': 1, 'image_source.source_url': 1, source_url: 1, metadata: 1,
    translation_state: 1, 'pipeline_auto.hold.reason': 1, acquisition_campaign: 1,
  },
};
// Latin and Greek (#6220): Latin is our largest language (≈52K books), so it is loaded by the four
// collections Figure 1 counts plus the title/source terms the canon rows need, never wholesale.
const LATIN_COLLS = ['hermetica', 'alchemy', 'kabbalah', 'natural-philosophy'];
const LATIN_CLASSICAL_COLLS = ['classical-philosophy', 'literature', 'stoicism', 'ancient-historiography', 'ancient-epic-drama', 'school-of-athens'];
const GREEK_LANGS = ['Greek', 'Ancient Greek'];
const LANGS = ['Tibetan', 'Chinese', 'Classical Chinese', 'Chinese; Chinese (script)', 'Sanskrit', 'Pali', 'Hebrew', 'Aramaic', 'Arabic', 'Persian', 'Mongolian', 'Korean', ...GREEK_LANGS];
const COLLS = ['tibetan-canon', 'buddhist-canon', 'chinese-buddhist-texts', 'zen-chan', 'kabbalah', 'jewish-kabbalistic-mysticism', 'sufism', 'sufi-eastern-mysticism', 'sufism-islamic-mysticism', 'vedanta-darshana', 'persian-literary-tradition', 'daoist-classics', 'buddhism'];

/**
 * Candidate books (by language, by collection, and by works-catalog work_holdings) plus the
 * work_holdings book sets per source catalog.
 * @param {import('mongodb').Db} db
 * @param {{ query: (sql: string) => Promise<{ rows: any[] }> }} pgc  a connected pg client (works catalog)
 */
export async function loadHoldingCandidates(db, pgc) {
  const B = db.collection('books');
  const byLang = await B.find({ language: { $in: LANGS } }, PROJ).toArray();
  const byColl = await B.find({ collections: { $in: COLLS } }, PROJ).toArray();
  const byLatin = await B.find({ language: 'Latin', $or: [
    { collections: { $in: [...LATIN_COLLS, ...LATIN_CLASSICAL_COLLS] } },
    { title: /patrolog|migne/i },
    { source_url: /camena|mateo\.uni-mannheim/i }, { 'image_source.source_url': /camena|mateo\.uni-mannheim/i },
  ] }, PROJ).toArray();
  const wh = (await pgc.query(`select distinct w.source_catalog, h.book_id from work_holdings h join works w on w.id=h.work_id where w.source_catalog in ('kanripo','cbeta','openiti','gretil','sefaria','bdrc')`)).rows;
  const whBooks = await B.find({ id: { $in: [...new Set(wh.map((r) => r.book_id))] } }, PROJ).toArray();
  const all = new Map();
  for (const b of [...byLang, ...byColl, ...byLatin, ...whBooks]) all.set(b.id, b);
  const whBy = {};
  for (const r of wh) (whBy[r.source_catalog] ||= new Set()).add(r.book_id);
  return { books: [...all.values()], whBy, counts: { lang: byLang.length, collections: byColl.length, latin: byLatin.length, work_holdings: whBooks.length } };
}

/**
 * Book sets per corpus key. Keys are the gap map's internal ones (tengyur, kangyur, cbeta, cbeta_chan,
 * pali, gretil*, kabbalah, zohar, lurianic, cordovero, openiti_sufi, ganjoor, mongolian_kanjur,
 * tripitaka_koreana, kanripo, and since #6220 latin, patrologia_latina, camena, latin_classical, greek); `other_editions` sets ride along for the two Derge canons.
 * @returns {Record<string, { books: object[], method: string }>}
 */
export function corpusBookSets(books, whBy = {}) {
  const hay = (b) => `${b.title || ''} | ${b.english_title || ''} | ${b.image_source?.source_url || ''} | ${b.source_url || ''}`;
  const has = (b, ...cs) => (b.collections || []).some((c) => cs.includes(c));
  const set = (sel, method) => ({ books: sel, method });
  const tib = books.filter((b) => b.language === 'Tibetan');
  const zh = books.filter((b) => /Chinese/.test(b.language || ''));
  const R = {};
  R.tengyur = set(tib.filter((b) => /W23703|derge-tengyur/i.test(hay(b)) || (/bstan ?'?gyur|tengyur|tanjur/i.test(hay(b)) && /sde dge|derge|dege/i.test(hay(b)))),
    "language=Tibetan, title/source matches Derge Tengyur (bstan 'gyur + sde dge, BDRC W23703, Esukhia)");
  R.tengyur_other_editions = set(tib.filter((b) => /bstan ?'?gyur|tengyur|tanjur/i.test(hay(b))), 'any Tengyur edition by title');
  // W4CZ5369 (#5665): the Library of Congress Derge copy the Esukhia text transcribes; W22084 the Karmapa reprint.
  R.kangyur = set(tib.filter((b) => /W4CZ5369|W22084|derge-kangyur/i.test(hay(b)) || (/bka'? ?'?gyur|kangyur|kanjur/i.test(hay(b)) && /sde dge|derge|dege/i.test(hay(b)))),
    "language=Tibetan, title/source matches Derge Kangyur (bka' 'gyur + sde dge, BDRC W4CZ5369 / W22084, Esukhia)");
  R.kangyur_other_editions = set(tib.filter((b) => /bka'? ?'?gyur|kangyur|kanjur/i.test(hay(b))), 'any Kangyur edition by title (e.g. BL Thadrak manuscript Kanjur)');
  const cbetaSet = whBy.cbeta || new Set();
  R.cbeta = set(zh.filter((b) => cbetaSet.has(b.id) || b.metadata?.cbeta_id || b.image_source?.provider === 'sat_daizokyo' || has(b, 'buddhist-canon', 'chinese-buddhist-texts', 'zen-chan')),
    'Chinese-language books in buddhist-canon / chinese-buddhist-texts / zen-chan, SAT Daizōkyō scans, metadata.cbeta_id, or works-catalog cbeta holdings');
  R.cbeta_chan = set(zh.filter((b) => /景德傳燈錄|景德传灯录|祖堂集|五燈會元|五灯会元|語錄|语录|廣錄|語要/.test(hay(b)) || has(b, 'zen-chan')),
    'Chinese-language books whose title contains 景德傳燈錄 / 祖堂集 / 五燈會元 / 語錄 / 廣錄 / 語要, or in zen-chan');
  R.pali = set(books.filter((b) => b.language === 'Pali'), 'language=Pali (any edition; not matched to the VRI CSCD edition)');
  const skt = books.filter((b) => b.language === 'Sanskrit');
  R.gretil = set(skt, 'language=Sanskrit (any edition; NOT matched to GRETIL e-texts — work_holdings has no gretil rows)');
  R.gretil_buddhist = set(skt.filter((b) => has(b, 'buddhism', 'buddhist-canon', 'indian-buddhist-jain') || /buddh|bauddh|sūtra|sutra|prajñā|prajna|abhidharma|bodhi/i.test(hay(b))), 'Sanskrit books in buddhism collections or Buddhist title terms');
  R.gretil_vedanta = set(skt.filter((b) => has(b, 'vedanta-darshana') || /vedānta|vedanta|brahmasūtra|brahmasutra|upaniṣad|upanishad|śaṅkara|shankara/i.test(hay(b))), 'Sanskrit books in vedanta-darshana or Vedānta title terms');
  R.gretil_gaudiya = set(skt.filter((b) => /gosvām|gosvam|caitanya|chaitanya|rūpa|jīva gos|bhaktirasām|bhaktirasam|haribhakti/i.test(hay(b))), 'Sanskrit books with Gauḍīya author/title terms');
  const heb = books.filter((b) => /Hebrew|Aramaic/.test(b.language || '') || has(b, 'kabbalah', 'jewish-kabbalistic-mysticism'));
  const kab = heb.filter((b) => has(b, 'kabbalah', 'jewish-kabbalistic-mysticism') || /zohar|זהר|זוהר|kabbal|qabbal|cabbal|עץ חיים|etz ?chaim|ets ?hayy?im|pardes rimm?on|פרדס רמונים|cordovero|קורדובירו|luria|vital|ויטאל|tikk?un/i.test(hay(b)));
  R.kabbalah = set(kab, 'Hebrew/Aramaic or kabbalah collections, with Kabbalah collection/title terms (any edition)');
  R.zohar = set(kab.filter((b) => /zohar|זהר|זוהר|tikk?un/i.test(hay(b))), 'Zohar / Tikkunei Zohar by title');
  R.lurianic = set(kab.filter((b) => /etz ?chaim|ets ?hayy?im|עץ חיים|luria|vital|ויטאל|ari\b|shemonah sh|שמונה שערים|pri etz|sha.ar ha/i.test(hay(b))), 'Lurianic corpus by title (Etz Chaim, Vital, Shemonah She`arim …)');
  R.cordovero = set(kab.filter((b) => /cordovero|קורדובירו|pardes rimm?on|פרדס רמונים|tomer dev|תומר דבורה|or ne.erav|אור נערב/i.test(hay(b))), 'Cordovero by title (Pardes Rimonim, Tomer Devorah, Or Ne`erav)');
  const isl = books.filter((b) => /Arabic|Persian/.test(b.language || '') || has(b, 'sufism', 'sufi-eastern-mysticism', 'sufism-islamic-mysticism'));
  const oitiSet = whBy.openiti || new Set();
  R.openiti_sufi = set(isl.filter((b) => oitiSet.has(b.id) || has(b, 'sufism', 'sufi-eastern-mysticism', 'sufism-islamic-mysticism') || /ibn ?.?arab[iī]|fus[uū]s|fut[uū]h[aā]t|فصوص|فتوحات|ابن عربي|ابن العربي/i.test(hay(b))),
    'Arabic/Persian books in sufism collections, Ibn ʿArabī title terms, or works-catalog openiti holdings');
  R.ganjoor = set(books.filter((b) => b.language === 'Persian' && (has(b, 'persian-literary-tradition') || /d[iī]v[aā]n|diwan|masnav|mathnaw|shahnam|sh[aā]hn[aā]m|gulist|bust[aā]n|دیوان|ديوان|مثنوی|شاهنامه|گلستان|بوستان|غزل|hafez|hafiz|sa.di|rumi|attar|ferdowsi|nizami|jami/i.test(hay(b)))),
    'Persian books in persian-literary-tradition or with classical poetry title terms (any edition)');
  R.mongolian_kanjur = set(books.filter((b) => b.language === 'Mongolian' || /W4CZ5370|mongolian (kanjur|kangyur)|ganjuur/i.test(hay(b))), 'language=Mongolian or Mongolian Kanjur by title/source');
  R.tripitaka_koreana = set(books.filter((b) => (/Korean|Chinese/.test(b.language || '')) && /高麗|高丽|tripitaka koreana|koryo|goryeo|海印寺|再雕/i.test(hay(b))), 'Korean/Chinese books with Tripitaka Koreana / 高麗 / 海印寺 title terms');
  const lat = books.filter((b) => b.language === 'Latin');
  R.latin = set(lat.filter((b) => has(b, ...LATIN_COLLS)), `language=Latin and in one of our collections ${LATIN_COLLS.join(', ')} (any edition)`);
  R.patrologia_latina = set(lat.filter((b) => /patrolog|migne/i.test(hay(b))), "language=Latin with Patrologia / Migne in the title or source (any volume; not matched to Corpus Corporum's texts)");
  R.camena = set(lat.filter((b) => /camena|mateo\.uni-mannheim/i.test(hay(b))), 'language=Latin with a CAMENA / MATEO (Mannheim) source URL');
  R.latin_classical = set(lat.filter((b) => has(b, ...LATIN_CLASSICAL_COLLS)), `language=Latin in ${LATIN_CLASSICAL_COLLS.join(', ')} (any edition; not matched to Perseus works)`);
  R.greek = set(books.filter((b) => GREEK_LANGS.includes(b.language)), `language=${GREEK_LANGS.join(' or ')} (any edition; not matched to Perseus or First1KGreek works)`);
  const krSet = whBy.kanripo || new Set();
  R.kanripo = set(books.filter((b) => krSet.has(b.id)), 'works-catalog work_holdings for kanripo works (build-holdings.mjs title-auto match; a floor)');
  return R;
}

/** live = visible && pages_count > 0 (the canonical live filter); everything else hidden. */
export const isLive = (b) => b.visible === true && (b.pages_count || 0) > 0;

/** The gap map's holdings summary for one set. */
export function sumHoldings({ books, method }) {
  const live = books.filter(isLive);
  const hid = books.filter((b) => !isLive(b));
  return {
    live_books: live.length, live_pages: live.reduce((a, b) => a + (b.pages_count || 0), 0), live_pages_translated: live.reduce((a, b) => a + (b.pages_translated || 0), 0),
    hidden_books: hid.length, hidden_pages: hid.reduce((a, b) => a + (b.pages_count || 0), 0), method,
  };
}

/** Gap-map row id → corpusBookSets key. */
export const ROW_SET = Object.freeze({
  'derge-tengyur': 'tengyur', 'derge-kangyur': 'kangyur', cbeta: 'cbeta', 'cbeta-chan': 'cbeta_chan',
  'pali-mula': 'pali', 'pali-atthakatha': 'pali', 'pali-tika': 'pali',
  'gretil-buddhist': 'gretil_buddhist', 'gretil-vedanta': 'gretil_vedanta', 'gretil-gaudiya': 'gretil_gaudiya',
  'sefaria-zohar': 'zohar', 'sefaria-lurianic': 'lurianic', 'sefaria-cordovero': 'cordovero',
  'openiti-sufi': 'openiti_sufi', ganjoor: 'ganjoor', 'mongolian-kanjur': 'mongolian_kanjur',
  'tripitaka-koreana': 'tripitaka_koreana', kanripo: 'kanripo',
  'patrologia-latina': 'patrologia_latina', 'camena-poemata': 'camena', 'perseus-latin': 'latin_classical',
  'perseus-greek': 'greek', 'first1k-greek': 'greek',
});
