#!/usr/bin/env node
/**
 * Join the Siku Quanshu Wikidata denominator (3,418 QIDs, from the translation
 * census #2234) onto the works catalog (#2453).
 *
 * For each QID: fetch zh labels, match to an existing kr: work by normalized
 * title (variant glyphs handled in lib). On match → set wikidata_qid +
 * 'siku-quanshu' tag + English title/aliases. No match → create a wd: work row
 * so the denominator is fully represented.
 *
 * Also writes translation_status for the census labeled-stratum verdicts
 * (method 'census-auto' — a recall floor, see memory; hand-verified upgrades
 * come later).
 *
 * Run AFTER ingest-kanripo.mjs. Idempotent.
 *   set -a; source .env.production.local; set +a; node scripts/works-catalog/ingest-siku-wikidata.mjs
 */
import { readFileSync } from 'fs';
import { pgClient, normalizeCjk, fetchRetry, sleep, upsertWorks } from './lib.mjs';

const denom = JSON.parse(readFileSync('scripts/analysis/siku-denominator.json', 'utf8'));
const census = JSON.parse(readFileSync('scripts/analysis/siku-census-results.json', 'utf8'));
const translatedQids = new Map(census.labeled_hits.map(h => [h.qid, h.evidence]));

const client = pgClient();
await client.connect();

// kr: works lookup by normalized title
const kr = await client.query(`select id, title_normalized from works where id like 'kr:%'`);
const krByNorm = new Map(kr.rows.map(r => [r.title_normalized, r.id]));
console.log(`Loaded ${krByNorm.size} kanripo works for matching`);

// zh labels for all QIDs, batched 50/call
const zhByQid = {};
for (let i = 0; i < denom.length; i += 50) {
  const ids = denom.slice(i, i + 50).map(w => w.qid).join('|');
  const j = await (await fetchRetry(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|aliases&languages=zh|zh-hant|zh-hans|lzh&format=json`,
    { headers: { 'User-Agent': 'SourceLibrary-WorksCatalog/1.0 (derek@sourcelibrary.org)' } })).json();
  for (const [qid, ent] of Object.entries(j.entities || {})) {
    const set = new Set();
    for (const lang of ['zh-hant', 'lzh', 'zh', 'zh-hans'])
      for (const v of [ent.labels?.[lang]?.value, ...(ent.aliases?.[lang] || []).map(a => a.value)]) if (v) set.add(v);
    zhByQid[qid] = [...set];
  }
  await sleep(400);
  if (i % 500 === 0) process.stderr.write(`labels ${i}/${denom.length}\n`);
}

let matched = 0;
const newWorks = [];
for (const w of denom) {
  const zh = zhByQid[w.qid] || [];
  const en = w.enLabel && /[a-z]/i.test(w.enLabel) ? w.enLabel : (/[a-z]/i.test(w.label) ? w.label : null);
  // strip "(Siku Quanshu)" style edition suffixes from English display titles
  const enClean = en?.replace(/\s*\((Siku Quanshu|四庫全書)[^)]*\)\s*$/i, '') || null;
  let krId = null;
  for (const t of zh) { krId = krByNorm.get(normalizeCjk(t)); if (krId) break; }
  const status = translatedQids.has(w.qid)
    ? { s: 'partial', ev: translatedQids.get(w.qid), m: 'census-auto' }
    : null;
  if (krId) {
    matched++;
    await client.query(
      `update works set
         wikidata_qid = coalesce(wikidata_qid, $2),
         title_english = coalesce(title_english, $3),
         corpus_tags = (select array(select distinct unnest(corpus_tags || '{siku-quanshu}'))),
         authority_ids = authority_ids || jsonb_build_object('siku_qid', $2),
         translation_status = case when $4::text is not null and translation_status = 'unknown' then $4 else translation_status end,
         translation_evidence = coalesce(translation_evidence, $5),
         translation_method = coalesce(translation_method, $6),
         updated_at = now()
       where id = $1`,
      [krId, w.qid, enClean, status?.s ?? null, status?.ev ?? null, status ? status.m : null]);
  } else {
    const title = zh[0] || w.label;
    newWorks.push({
      id: `wd:${w.qid}`,
      tradition: 'chinese',
      original_language: 'lzh',
      title,
      title_normalized: normalizeCjk(title),
      title_english: enClean,
      wikidata_qid: w.qid,
      authority_ids: { siku_qid: w.qid },
      corpus_tags: ['siku-quanshu'],
      source_catalog: 'wikidata-siku',
      extra: { wikidata_description: w.desc || null, aliases: (w.alts || []).slice(0, 10) },
    });
  }
}

const inserted = await upsertWorks(client, newWorks);
// census verdicts for wd: rows
for (const [qid, ev] of translatedQids) {
  await client.query(
    `update works set translation_status = 'partial', translation_evidence = $2, translation_method = 'census-auto', updated_at = now()
     where id = $1 and translation_status = 'unknown'`, [`wd:${qid}`, ev]);
}

const stats = (await client.query(`
  select count(*) filter (where 'siku-quanshu' = any(corpus_tags)) total,
         count(*) filter (where wikidata_qid is not null and 'siku-quanshu' = any(corpus_tags)) with_qid
  from works where tradition = 'chinese'`)).rows[0];
await client.end();
console.log(`QID-matched to kanripo: ${matched}/${denom.length}; new wd: works: ${inserted}`);
console.log(`siku-quanshu tagged works: ${stats.total} (${stats.with_qid} with QID)`);
