#!/usr/bin/env node
/**
 * Ingest the OpenITI corpus (work-level Arabic/Persian Islamicate texts) into
 * the works catalog (#2453).
 *
 * Source: OpenITI/kitab-metadata-automation `all_book_meta.json` (~8.9K works,
 * URIs like 0179MalikIbnAnas.Muwatta — AH death-date + author + work) and
 * `all_author_meta.json` for author display names. Every work has open
 * mARkdown transcriptions (versions[]).
 *
 * Gotcha: raw.githubusercontent truncates these multi-MB files mid-stream
 * with HTTP 200 — parse-inside-retry, and prefer the jsDelivr mirror.
 *
 * Idempotent.
 *   set -a; source .env.production.local; set +a; node scripts/works-catalog/ingest-openiti.mjs
 */
import { pgClient, sleep, upsertWorks, upsertSources } from './lib.mjs';

async function fetchJson(path, tries = 5) {
  const urls = [
    `https://cdn.jsdelivr.net/gh/OpenITI/kitab-metadata-automation@master/output/${path}`,
    `https://raw.githubusercontent.com/OpenITI/kitab-metadata-automation/master/output/${path}`,
  ];
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(urls[i % urls.length]);
      return JSON.parse(await res.text()); // truncation shows up here, not as an HTTP error
    } catch (e) {
      if (i === tries - 1) throw e;
      process.stderr.write(`fetch ${path} attempt ${i + 1} failed (${e.message.slice(0, 60)}), retrying\n`);
      await sleep(3000);
    }
  }
}

const books = await fetchJson('OpenITI_Github_clone_all_book_meta.json');
const authors = await fetchJson('OpenITI_Github_clone_all_author_meta.json');
console.log(`OpenITI: ${Object.keys(books).length} works, ${Object.keys(authors).length} authors`);

function authorInfo(authorUri) {
  const a = authors[authorUri];
  if (!a) return { name: null, qid: null };
  // prefer the Latin shuhra ("famous name"), fall back to Latin/Arabic name lists
  const name = a.shuhra || a.author_lat?.[0] || a.author_ar?.[0] || null;
  const qid = (a.external_id?.match(/wikidata@(Q\d+)/) || [])[1] || null;
  return { name, qid };
}

const works = [];
const sources = [];
for (const [uri, b] of Object.entries(books)) {
  const m = uri.match(/^(\d{4})([A-Za-z]+)\.(\S+)$/);
  if (!m) continue;
  const [, ahStr, authorKey] = m;
  const authorUri = ahStr + authorKey;
  const ah = parseInt(ahStr, 10);
  const ceYear = Math.round(ah * 0.970225 + 621.54); // AH -> CE
  const titleAr = (b.title_ar || []).find(t => t?.trim()) || null;
  const titleLat = (b.title_lat || []).find(t => t?.trim()) || null;
  if (!titleAr && !titleLat) continue;
  // language: majority vote over version URI suffixes (-ara1, -per1, ...)
  const langs = (b.versions || []).map(v => (v.match(/-([a-z]{3})\d*$/) || [])[1]).filter(Boolean);
  const lang = langs.sort((a, c) => langs.filter(x => x === c).length - langs.filter(x => x === a).length)[0] || 'ara';
  const { name: authorName, qid: authorQid } = authorInfo(authorUri);
  works.push({
    id: `oiti:${uri}`,
    tradition: 'islamicate',
    original_language: lang,
    title: titleAr || titleLat,
    title_normalized: (titleAr || titleLat).replace(/\s+/g, ' ').trim(),
    title_romanized: titleLat,
    author: authorName || authorKey.replace(/([a-z])([A-Z])/g, '$1 $2'),
    century: Math.floor(ceYear / 100) + 1, // author death century, CE — composition proxy
    authority_ids: { openiti_uri: uri, openiti_author: authorUri, ...(authorQid ? { author_wikidata_qid: authorQid } : {}) },
    corpus_tags: ['openiti'],
    source_catalog: 'openiti',
    extra: {
      author_death_ah: ah,
      author_death_ce: ceYear,
      genre_tags: (b.genre_tags || []).slice(0, 12),
      n_versions: (b.versions || []).length,
      relations: (b.relations || []).length,
    },
  });
  sources.push({
    work_id: `oiti:${uri}`,
    source: 'openiti',
    source_id: uri,
    kind: 'transcription',
    url: `https://github.com/OpenITI/${ahStr}AH`, // 25-years repo bucket; exact path in extra
    iiif: false,
    extra: { versions: (b.versions || []).slice(0, 5) },
  });
}

console.log(`Parsed ${works.length} works (langs: ${[...new Set(works.map(w => w.original_language))].join(', ')})`);
const client = pgClient();
await client.connect();
const nW = await upsertWorks(client, works);
const nS = await upsertSources(client, sources);
const count = (await client.query(`select count(*) n from works where source_catalog = 'openiti'`)).rows[0].n;
await client.end();
console.log(`Upserted ${nW} works, ${nS} sources. works(source_catalog=openiti) = ${count}`);
