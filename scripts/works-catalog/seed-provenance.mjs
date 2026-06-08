#!/usr/bin/env node
/**
 * Seed catalog_sources with verified provenance/licensing for every source
 * feeding the works catalog (#2453), and stamp per-item rights where the
 * source records it (BDRC copyrightStatus).
 *
 * Licenses verified 2026-06-08 from the sources themselves (LICENSE files,
 * Zenodo records, per-resource RDF) — see .claude/docs/works-catalog-provenance.md.
 *
 *   set -a; source .env.production.local; set +a; node scripts/works-catalog/seed-provenance.mjs
 */
import { pgClient } from './lib.mjs';

const SOURCES = [
  {
    source: 'kanripo', name: 'Kanseki Repository (漢籍リポジトリ)',
    url: 'https://github.com/kanripo',
    data_license: 'CC BY-SA 4.0', content_license: 'CC BY-SA 4.0', commercial_ok: true,
    attribution: 'Kanseki Repository, ed. Christian Wittern, Kyoto University',
    notes: 'Texts derive from PD Siku Quanshu (1773), Zhengtong Daozang, Daozang jiyao + CBETA Buddhist canon. Importing transcriptions carries BY-SA (share-alike).',
  },
  {
    source: 'openiti', name: 'Open Islamicate Texts Initiative',
    url: 'https://github.com/OpenITI/RELEASE',
    data_license: 'CC BY-NC-SA 4.0', content_license: 'CC BY-NC-SA 4.0', commercial_ok: false,
    attribution: 'Romanov, Maxim, and Masoumeh Seydi. "OpenITI: A Machine-Readable Corpus of Islamicate Texts." Zenodo, 2019- (doi:10.5281/zenodo.3082463)',
    notes: 'NON-COMMERCIAL + ShareAlike binds the TEXT. Bibliographic metadata we hold (titles/authors/URIs/dates) is uncopyrightable fact; importing the mARkdown transcriptions for reading triggers NC — assess before any commercial context.',
  },
  {
    source: 'bdrc', name: 'Buddhist Digital Resource Center / BUDA',
    url: 'https://library.bdrc.io',
    data_license: 'Open (LOD, attribution requested)', content_license: null, commercial_ok: null,
    attribution: 'Buddhist Digital Resource Center (bdrc.io)',
    notes: 'Bibliographic LOD is openly shared with attribution. SCANS carry per-record bdo:copyrightStatus (often CopyrightUndetermined) — never auto-import a scan as readable without checking work_sources.rights. Aggregates British Library EAP, IA, CBETA, NGMCP partners.',
  },
  {
    source: 'ia-cadal', name: 'Internet Archive — Universal Library / CADAL',
    url: 'https://archive.org/details/universallibrary',
    data_license: 'Open metadata', content_license: null, commercial_ok: null,
    attribution: 'China-America Digital Academic Library (CADAL); Internet Archive',
    notes: 'Volume-level facsimiles, mostly of pre-1773 PD works, but rights are per-item. Check IA item metadata (possible-copyright) before bulk scan import.',
  },
  {
    source: 'wikidata-siku', name: 'Wikidata (Siku Quanshu denominator)',
    url: 'https://www.wikidata.org',
    data_license: 'CC0 1.0', content_license: 'CC0 1.0', commercial_ok: true,
    attribution: 'Wikidata contributors (CC0)',
    notes: 'Public-domain dedication — no constraint. Used for QIDs, labels, aliases.',
  },
  {
    source: 'wikidata-sanskrit', name: 'Wikidata (Sanskrit works, P407=Q11059)',
    url: 'https://www.wikidata.org',
    data_license: 'CC0 1.0', content_license: 'CC0 1.0', commercial_ok: true,
    attribution: 'Wikidata contributors (CC0)',
    notes: 'Public-domain dedication. SPARQL: works whose language-of-work (P407) is Sanskrit (Q11059). Titles English-skewed; ~180/3.9K carry IAST. ingest-sanskrit-wikidata.mjs.',
  },
  {
    source: 'gretil', name: 'GRETIL — Goettingen Register of Electronic Texts in Indian Languages',
    url: 'https://gretil.sub.uni-goettingen.de',
    data_license: 'Bibliographic facts (titles) — uncopyrightable',
    content_license: 'Per-text, varies (contributed e-texts; mostly non-commercial scholarly use)',
    commercial_ok: null,
    attribution: 'GRETIL, ed. Reinhold Gruenendahl, Goettingen State and University Library',
    notes: 'We hold only titles (fact) + transcription URLs (pointers), NOT the e-text bodies. Each GRETIL text carries its OWN licence/encoder terms — check the file header before importing any body. Enumerated via the open GitHub mirror INDOLOGY/GRETIL-mirror. ingest-gretil.mjs.',
  },
  {
    source: 'pandit', name: 'Pandit — Prosopographical Database of Indic Texts',
    url: 'https://www.panditproject.org',
    data_license: 'CC BY-NC-SA 4.0', content_license: 'CC BY-NC-SA 4.0', commercial_ok: false,
    attribution: 'PANDiT: Prosopographical Database of Indic Texts (panditproject.org), CC BY-NC-SA 4.0',
    notes: 'NON-COMMERCIAL + ShareAlike. Bibliographic facts (titles/authors/dates) are arguably uncopyrightable, but the project asserts CC BY-NC-SA — attribute + assess before any commercial use. Retrieved 2026-06-09 via the site own entity CSV export (type=Work, field_language=45=Sanskrit). ingest-pandit.mjs.',
  },
];

const client = pgClient();
await client.connect();

for (const s of SOURCES) {
  await client.query(
    `insert into catalog_sources (source, name, url, data_license, content_license, commercial_ok, attribution, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (source) do update set
       name=excluded.name, url=excluded.url, data_license=excluded.data_license,
       content_license=excluded.content_license, commercial_ok=excluded.commercial_ok,
       attribution=excluded.attribution, notes=excluded.notes, updated_at=now()`,
    [s.source, s.name, s.url, s.data_license, s.content_license, s.commercial_ok, s.attribution, s.notes]);
}
console.log(`Seeded ${SOURCES.length} catalog_sources rows`);

// Per-item rights for BDRC scans: lift copyrightStatus from the cached records.
// (Only run if the BDRC harvest cache is present.)
import { existsSync, readdirSync, readFileSync } from 'fs';
const CACHE = process.env.BDRC_CACHE_DIR || '/root/works-catalog-cache/bdrc';
if (existsSync(CACHE)) {
  const files = readdirSync(CACHE).filter(f => f.endsWith('.jsonld'));
  let stamped = 0;
  const updates = [];
  for (const f of files) {
    try {
      const doc = JSON.parse(readFileSync(`${CACHE}/${f}`, 'utf8'));
      const g = doc['@graph'] || [doc];
      const id = f.replace(/\.jsonld$/, '');
      const node = g.find(n => (n['@id'] || '').includes(id)) || {};
      const cs = (node['copyrightStatus'] ?? node['bdo:copyrightStatus']);
      const status = (Array.isArray(cs) ? cs[0] : cs);
      const val = (typeof status === 'string' ? status : status?.['@id'])?.replace(/^bdr:/, '');
      if (val) updates.push([`bdrc:${id}`, id, val]);
    } catch { /* skip */ }
  }
  // bulk update work_sources.rights by (work matched via source_id = MW id)
  for (let i = 0; i < updates.length; i += 1000) {
    const chunk = updates.slice(i, i + 1000);
    const values = chunk.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2})`).join(',');
    const params = chunk.flatMap(u => [u[1], u[2]]);
    const res = await client.query(
      `update work_sources ws set rights = v.rights
       from (values ${values}) as v(source_id, rights)
       where ws.source = 'bdrc' and ws.source_id = v.source_id`,
      params);
    stamped += res.rowCount;
  }
  const dist = (await client.query(
    `select rights, count(*) n from work_sources where source='bdrc' group by 1 order by 2 desc limit 8`)).rows;
  console.log(`Stamped ${stamped} bdrc work_sources with rights. Distribution:`, JSON.stringify(dist));
}

await client.end();
