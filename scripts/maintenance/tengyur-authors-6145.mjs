#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/additive-mint-authors-3780.mjs is THE minting path for the `authors`
// thesaurus (author-identity.md) and does the writing; this script only builds its verdict file.
// scripts/maintenance/tengyur-catalogue-6145.mjs wrote the BDRC persons into the Tengyur chapters and
// linked 10 by reviewed name match; it mints nothing. build-authors-collection.mjs is a rebuild and
// reads books.author, which the Tengyur volumes do not carry per text.
//
// #6145 follow-up: one `authors` doc per BDRC person named as author or translator of a Derge
// Tengyur text (~830). Writes $OUT/authors/verdicts.jsonl for additive-mint-authors-3780.mjs:
//
//   node --env-file=… scripts/maintenance/tengyur-authors-6145.mjs            # → verdicts.jsonl
//   node --env-file=… scripts/maintenance/additive-mint-authors-3780.mjs --input=$OUT/authors/verdicts.jsonl \
//        --source=tengyur-authors-6145 --backup=$OUT/authors/mint-backup.json --plan=$OUT/authors/plan.json [--apply]
//
// The BDRC id is the identity (the mint script's `authority`), never the name: BDRC splits
// Dharmakīrti I / II / III and labels the translator Ba ri lo tsā ba "Dharmakīrti" too, and all
// four fold to one name key. Display names:
//   - Indian authors: BDRC's IAST label ("*" marks a reconstructed Sanskrit name — kept).
//   - Tibetan translators (Wylie name contains "lo tsA ba"): the Wylie name. Their IAST label is a
//     Sanskritised rendering no reader knows them by, and as a variant it is a trapdoor (Dharmakīrti).
//   - Names shared by several BDRC persons get the Wylie name in parentheses, so no two docs read alike.
//   - Hand decisions below: the canonical Dharmakīrti and Candrakīrti are BDRC's "I".
// Not minted (reported): uncertain names ("?" / "="), deities and bodhisattvas named as revealers,
// names of ≤4 letters, and the reviewed rejections from the catalogue run.
import fs from 'node:fs';
import path from 'node:path';
import { parsePerson, fold } from '../lib/tengyur-catalogue.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out', '/root/tengyur-enrich-6145');
const CACHE = path.join(OUT, 'bdrc');
const DIR = path.join(OUT, 'authors');

// Reviewed in the catalogue run (tengyur-catalogue-6145.mjs REVIEWED_AUTHOR_LINKS): same person.
const LINK_TO = {
  P4954: 'nagarjuna', P6119: 'vasubandhu', P6161: 'santideva', P7612: 'asvaghosa', P8058: 'kalidasa',
  P5787: 'dandin', P7374: 'harsha', P0AT0254: 'vagbhata', P6951: 'vagbhata', P4CZ16888: 'kautilya',
  P1056: 'sakya-pandita-kunga-gyaltsen', // same Wikidata id (Q982008) on BDRC and on the doc; the doc's books are his
};
// Reviewed rejections: the name is on another person's doc. Mint them separately.
// The display carries the Wylie name, and the bare IAST name (already on the other doc) is no variant.
const STANDALONE = {
  P4CZ10559: 'Samantabhadra (Mkhan po kun tu bzang po)', // the `samantabhadra` doc is the Jain author
  P4CZ15437: '*Nīlakaṇṭha (Slob dpon ni la khaṭa)', // `nilakantha-somayaji` is the Kerala astronomer
  P5013: 'Lo chen bai ro tsa na', // the 8th-c. translator Vairocana; his name key lands on the Ming author `chen-zhi`
};
// Hand-chosen display names.
const DISPLAY = {
  P6120: { name: 'Dharmakīrti', slug: 'dharmakirti' }, // the pramāṇa author, 7th c. (Q457990)
  P5782: { name: 'Candrakīrti', slug: 'candrakirti' }, // the Madhyamaka author, 7th c.
  P3453: { name: 'Dharmakīrti of Suvarṇadvīpa (gSer gling pa)' }, // Atiśa's teacher
};
// Named as author by tradition, but a deity, bodhisattva or generic title — not a person to mint.
const NOT_A_PERSON = new Set(['Vasudharā', 'Vajrapāṇi (Bodhisattva)', 'Vajrapāṇi', 'Avalokiteśvara', 'Tārā', 'Mañjuśrī',
  'Maitreya', 'Śākyamuni', 'Bodhisattva', 'Vajraḍākinī', 'Padmapāṇi', 'Kāmadhenu', 'Bṛhaspati']);
const INSTITUTION = new Set(['Jagaddala Vihāra']);

const read = (rid) => { const f = path.join(CACHE, `${rid}.jsonld`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
// Wylie, readable: drop stacking "+", Sanskrit capitals to IAST, trailing shad, capital first letter.
const SKT = { A: 'ā', I: 'ī', U: 'ū', N: 'ṇ', T: 'ṭ', D: 'ḍ', M: 'ṃ', H: 'ḥ', R: 'ṛ' };
export function wylieDisplay(ewts) {
  if (!ewts) return null;
  const s = ewts.replace(/\/+\s*$/, '').replace(/\+/g, '').replace(/Sh/g, 'ṣ').replace(/[AIUNTDMHR]/g, (c) => SKT[c]).replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : null;
}
const lit = (v, lang) => [v].flat().find((x) => x?.['@language'] === lang)?.['@value'] || null;

function main() {
  const people = new Map();
  for (const l of fs.readFileSync(path.join(OUT, 'applied.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    for (const ch of JSON.parse(l).chapters) {
      for (const [role, list] of [['author', ch.catalogue.authors], ['translator', ch.catalogue.translators]]) {
        for (const p of list || []) {
          const e = people.get(p.bdrc) || { bdrc: p.bdrc, name: p.name, name_ewts: p.name_ewts, texts: { author: 0, translator: 0 } };
          e.texts[role]++; people.set(p.bdrc, e);
        }
      }
    }
  }
  const rows = [];
  for (const p of people.values()) {
    const doc = read(p.bdrc);
    const parsed = doc ? parsePerson(doc, p.bdrc) : null;
    const node = (doc?.['@graph'] || [doc]).find((x) => x?.['@id'] === `bdr:${p.bdrc}`) || {};
    const same = parsed?.sameAs || [];
    const qid = same.find((x) => x.startsWith('wd:'))?.slice(3) || null;
    const viaf = same.find((x) => x.startsWith('viaf:'))?.slice(5) || null;
    const iast = p.name; const wylie = wylieDisplay(p.name_ewts);
    const tibetan = /lo ?tsA ?ba|lo tsa ba|^lo /.test(p.name_ewts || '');
    const r = { bdrc: p.bdrc, iast, ewts: p.name_ewts, wylie, texts: p.texts, wikidata_id: qid, viaf_id: viaf,
      zh: lit(node['skos:prefLabel'], 'zh-hans'), centuries: [node['tmp:associatedCentury']].flat().filter(Boolean).map((x) => Number(x['@value'] ?? x)) };
    if (LINK_TO[p.bdrc]) { r.verdict = 'person'; r.link_to = LINK_TO[p.bdrc]; r.display = iast || wylie; }
    else if (INSTITUTION.has(iast)) { r.verdict = 'institution'; r.display = iast; }
    else if (/[?=]/.test(iast || '') || (!iast && !wylie)) { r.verdict = 'uncertain'; r.why = 'BDRC marks the name uncertain, or has none'; }
    else if (NOT_A_PERSON.has(iast)) { r.verdict = 'uncertain'; r.why = 'deity, bodhisattva or title named as author by tradition'; }
    else if (iast && !tibetan && fold(iast.replace(/^\*/, '')).length <= 4) { r.verdict = 'uncertain'; r.why = 'name of four letters or fewer — too generic to match on'; }
    else { r.verdict = 'person'; r.display = DISPLAY[p.bdrc]?.name || STANDALONE[p.bdrc] || (tibetan || !iast ? wylie : iast); if (STANDALONE[p.bdrc]) r.standalone = true; }
    rows.push(r);
  }
  // Names shared by several BDRC persons: disambiguate every member by its Wylie name.
  const byName = new Map();
  for (const r of rows.filter((x) => x.display && !x.link_to && !DISPLAY[x.bdrc])) {
    const k = fold(r.display.replace(/^\*/, '')); byName.set(k, [...(byName.get(k) || []), r]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const wy = group.map((r) => fold(r.wylie || ''));
    for (const r of group) {
      const own = r.wylie && fold(r.wylie) !== fold(r.display) && wy.filter((w) => w === fold(r.wylie)).length === 1;
      r.display = `${r.display} (${own ? r.wylie : `BDRC ${r.bdrc}`})`;
      r.disambiguated = true;
    }
  }
  fs.mkdirSync(DIR, { recursive: true });
  const verdicts = rows.filter((r) => r.verdict === 'person' || r.verdict === 'institution').map((r) => {
    // Only BDRC's IAST label rides along as a variant. The Wylie name of an Indian author is the
    // Tibetan TRANSLATION of his name, and common: "Chos grags" (Dharmakīrti) and "Zla ba grags pa"
    // (Candrakīrti) are also ordinary Tibetan monks' names, so as match keys they would claim them.
    // A name shared by several persons stays off every one of them (it would match none safely).
    const extra = r.iast && r.iast !== r.display && !r.disambiguated && !r.standalone && !/lo ?tsA ?ba/.test(r.ewts || '') ? [r.iast] : [];
    return {
      string: r.display, verdict: r.verdict, canonical_name: r.display,
      authority: { bdrc: r.bdrc },
      ...(DISPLAY[r.bdrc]?.slug ? { slug: DISPLAY[r.bdrc].slug } : {}),
      ...(r.link_to ? { link_to: r.link_to } : {}),
      ...(r.standalone ? { standalone: true } : {}),
      ...(extra.length ? { extra_variants: extra } : {}),
      ...(r.wikidata_id ? { wikidata_id: r.wikidata_id } : {}),
      ...(r.viaf_id ? { viaf_id: r.viaf_id } : {}),
      note: `BDRC ${r.bdrc}; Tengyur texts as author ${r.texts.author}, as translator ${r.texts.translator} (#6145)`,
    };
  });
  fs.writeFileSync(path.join(DIR, 'verdicts.jsonl'), verdicts.map((v) => JSON.stringify(v)).join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'people.json'), JSON.stringify(rows, null, 1));
  const n = (v) => rows.filter((r) => r.verdict === v).length;
  console.log(`${rows.length} BDRC persons: person ${n('person')} (link_to ${rows.filter((r) => r.link_to).length}), institution ${n('institution')}, not minted ${n('uncertain')}`);
  for (const r of rows.filter((x) => x.verdict === 'uncertain')) console.log(`  not minted: ${r.bdrc} ${r.iast || r.ewts} — ${r.why}`);
}

main();
