#!/usr/bin/env node
/**
 * Ingest the Kanripo / Kanseki Repository catalog into the works catalog (#2453).
 *
 * Source: github.com/kanripo/KR-Catalog — org-mode files, one heading per work:
 *   *** KR1a0002 子夏易傳-周-卜商        (title-dynasty-author)
 *   :PROPERTIES: ... :KR_ID: / :SOURCE: 四庫全書 文淵閣版 / :EXTENT: 11 卷
 *
 * ~10,142 works, all with open transcriptions (each KR id is a git repo at
 * github.com/kanripo/{KR_ID}). 3,477 are explicitly SKQS-sourced.
 *
 * Idempotent. Usage (Hetzner, where SUPABASE_DB_URL lives):
 *   set -a; source .env.production.local; set +a; node scripts/works-catalog/ingest-kanripo.mjs
 */
import { pgClient, normalizeCjk, fetchRetry, upsertWorks, upsertSources } from './lib.mjs';

const SECTION_TAG = { KR1: 'jing-classics', KR2: 'shi-histories', KR3: 'zi-masters', KR4: 'ji-belles-lettres', KR5: 'daozang', KR6: 'buddhist-canon' };

const idx = await (await fetchRetry('https://api.github.com/repos/kanripo/KR-Catalog/contents/KR', { headers: { 'User-Agent': 'SourceLibrary-WorksCatalog/1.0 (derek@sourcelibrary.org)' } })).json();
if (!Array.isArray(idx)) { console.error('GitHub API error:', idx.message); process.exit(1); }

const works = [];
const sources = [];
for (const f of idx.filter(f => f.name.endsWith('.txt'))) {
  const txt = await (await fetchRetry(`https://raw.githubusercontent.com/kanripo/KR-Catalog/master/KR/${f.name}`)).text();
  // section header: ** KR1a ZB1a 易類
  const section = (txt.match(/^\*\* (KR\S+)\s+\S+\s+(\S+)/m) || [])[2] || null;
  // split on work headings; each block = heading line + properties drawer
  const blocks = txt.split(/^\*\*\* /m).slice(1);
  for (const block of blocks) {
    const headline = block.split('\n')[0].trim();
    const m = headline.match(/^(KR\S+)\s+(.+)$/);
    if (!m) continue;
    const krId = m[1];
    // title-dynasty-author; title itself never contains '-' in this catalog
    const [title, dynasty, author] = m[2].split('-').map(s => s?.trim() || null);
    if (!title) continue;
    const prop = name => (block.match(new RegExp(`^\\s*:${name}:\\s*(.+)$`, 'm')) || [])[1]?.trim() || null;
    const skqsSource = prop('SOURCE');
    const isSkqs = /四庫全書/.test(skqsSource || '');
    const top = krId.slice(0, 3);
    const tags = [SECTION_TAG[top]].filter(Boolean);
    if (isSkqs) tags.push('siku-quanshu');
    works.push({
      id: `kr:${krId}`,
      tradition: 'chinese',
      original_language: 'lzh',
      title,
      title_normalized: normalizeCjk(title),
      author: author || null,
      authority_ids: { kanripo_id: krId },
      corpus_tags: tags,
      source_catalog: 'kanripo',
      extra: {
        dynasty: dynasty || null,
        kr_section: section,
        kr_custom_id: prop('CUSTOM_ID'),
        kr_source: skqsSource,
        extent: prop('EXTENT'),
      },
    });
    sources.push({
      work_id: `kr:${krId}`,
      source: 'kanripo',
      source_id: krId,
      kind: 'transcription',
      url: `https://github.com/kanripo/${krId}`,
      iiif: false,
    });
  }
  process.stderr.write(`${f.name}: ${works.length} works so far\n`);
}

console.log(`Parsed ${works.length} works (${works.filter(w => w.corpus_tags.includes('siku-quanshu')).length} SKQS-sourced)`);

const client = pgClient();
await client.connect();
const nW = await upsertWorks(client, works);
const nS = await upsertSources(client, sources);
const count = (await client.query(`select count(*) n from works where source_catalog = 'kanripo'`)).rows[0].n;
await client.end();
console.log(`Upserted ${nW} works, ${nS} sources. works(source_catalog=kanripo) = ${count}`);
