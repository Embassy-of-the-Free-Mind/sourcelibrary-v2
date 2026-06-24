#!/usr/bin/env node
/**
 * Ingest Sefaria (Hebrew/Aramaic canon — Tanakh, Talmud, Midrash, Halakhah,
 * Kabbalah, Jewish philosophy) into the works catalog (#2453).
 *
 * Sefaria is the INVERSE of the Tibetan/Chinese case: a CC0 platform whose
 * purpose is English translation, so most of its canon IS translated. Adds a
 * Hebrew tradition and a valuable contrast point for the gap story (and the
 * Kabbalah / Jewish-philosophy works flagged for acquisition earlier).
 *
 * Source: https://www.sefaria.org/api/index/ (bulk tree, ~6,600 leaf titles)
 * + per-title /api/v2/index/{title} for era + composition date + heTitle +
 * authors. Per-title calls are cached to disk (resumable, polite).
 *
 * License: Sefaria text + metadata is CC0 (see catalog_sources via
 * seed-provenance). No reuse constraint.
 *
 *   set -a; source .env.production.local; set +a; node scripts/works-catalog/ingest-sefaria.mjs
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { pgClient, sleep, fetchRetry, upsertWorks, upsertSources } from './lib.mjs';

const CACHE = (process.env.CENSUS_CACHE_DIR || '/root/works-catalog-cache') + '/sefaria';
mkdirSync(CACHE, { recursive: true });
const UA = { 'User-Agent': 'SourceLibrary-WorksCatalog/1.0 (derek@sourcelibrary.org)' };

// 1. bulk index tree -> leaf titles with their category path
const tree = await (await fetchRetry('https://www.sefaria.org/api/index/', { headers: UA })).json();
const leaves = []; // {title, category}
(function walk(node, cat) {
  if (Array.isArray(node)) return node.forEach(n => walk(n, cat));
  if (node.contents) return node.contents.forEach(n => walk(n, node.category || cat));
  if (node.title) leaves.push({ title: node.title, category: node.category || cat });
})(tree, null);
console.log(`Sefaria index: ${leaves.length} leaf titles`);

// 2. per-title detail (cached)
async function detail(title) {
  const f = `${CACHE}/${encodeURIComponent(title)}.json`;
  if (existsSync(f)) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { /* refetch */ } }
  try {
    const r = await fetchRetry(`https://www.sefaria.org/api/v2/index/${encodeURIComponent(title)}`, { headers: UA });
    if (!r.ok) return null;
    const j = await r.json();
    writeFileSync(f, JSON.stringify({
      title: j.title, heTitle: j.heTitle, era: j.era, compDate: j.compDate,
      compPlace: j.compPlaceString?.en || j.compPlace?.en || null,
      authors: (j.authors || []).map(a => a.en || a).filter(Boolean),
    }));
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch { return null; }
}

// Sefaria era codes -> rough century (composition midpoint preferred when present)
const ERA_CENTURY = { Tanakh: -6, 'Second Temple': -2, Tannaim: 2, Amoraim: 5, Geonim: 8, RI: 12, Ra: 16, AH: 18, CO: 20 };
function century(d) {
  if (Array.isArray(d.compDate) && d.compDate.length) {
    const mid = (Number(d.compDate[0]) + Number(d.compDate[d.compDate.length - 1])) / 2;
    if (Number.isFinite(mid)) return mid < 0 ? Math.floor(mid / 100) : Math.floor(mid / 100) + 1;
  }
  return ERA_CENTURY[d.era] ?? null;
}

const works = [];
const sources = [];
let done = 0;
for (const leaf of leaves) {
  const d = await detail(leaf.title);
  if (!d) { done++; continue; }
  const c = century(d);
  works.push({
    id: `sefaria:${leaf.title}`,
    tradition: 'hebrew',
    original_language: 'hbo', // Hebrew/Aramaic canon; Aramaic works noted in extra
    title: d.heTitle || leaf.title,
    title_normalized: (d.heTitle || leaf.title).trim(),
    title_romanized: leaf.title,
    title_english: leaf.title,
    author: (d.authors || [])[0] || null,
    century: c,
    corpus_tags: ['sefaria', leaf.category].filter(Boolean),
    source_catalog: 'sefaria',
    extra: { era: d.era, comp_date: d.compDate, comp_place: d.compPlace, category: leaf.category },
  });
  sources.push({
    work_id: `sefaria:${leaf.title}`,
    source: 'sefaria',
    source_id: leaf.title,
    kind: 'transcription',
    url: `https://www.sefaria.org/${encodeURIComponent(leaf.title.replace(/ /g, '_'))}`,
    iiif: false,
  });
  if (++done % 250 === 0) process.stderr.write(`${done}/${leaves.length}\n`);
  if (!existsSync(`${CACHE}/${encodeURIComponent(leaf.title)}.json`)) await sleep(200);
}
console.log(`Parsed ${works.length} works`);

const client = pgClient();
await client.connect();
const nW = await upsertWorks(client, works);
const nS = await upsertSources(client, sources);
const count = (await client.query(`select count(*) n from works where source_catalog='sefaria'`)).rows[0].n;
const byCat = (await client.query(
  `select corpus_tags[2] cat, count(*) n from works where source_catalog='sefaria' group by 1 order by 2 desc limit 8`)).rows;
await client.end();
console.log(`Upserted ${nW} works, ${nS} sources. sefaria works = ${count}`);
console.log('by category:', JSON.stringify(byCat));
