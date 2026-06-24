#!/usr/bin/env node
/**
 * Ingest the CBETA Chinese Buddhist canon catalog into the works catalog (#2453).
 *
 * Source: github.com/DILA-edu/cbeta-metadata — work-info/{CANON}.json, one entry
 * per work keyed by CBETA work id (T0001, X0001, A1057, …):
 *   { "T0001": { title, byline, dynasty, time_from, time_to, contributors[], category, juans, vol, type } }
 *
 * Grows the Chinese DENOMINATOR — the Buddhist canon is largely absent from
 * Kanripo (whose KR6 buddhist-canon section is thin). CBETA reprints the same
 * work across many canon editions (T, X, A, B, …), so we DEDUPE within CBETA on
 * normalized-title + byline, preferring the standard scholarly canons (T Taishō,
 * X Xuzangjing) — one work row per distinct text, never the same text N times.
 * Cross-SOURCE dedup (CBETA ↔ Kanripo) is the later catalog pass (#2318).
 *
 * Idempotent upsert. Run on Hetzner (SUPABASE_DB_URL).
 *   set -a; source .env.production.local; set +a; node scripts/works-catalog/ingest-cbeta.mjs
 */
import { pgClient, normalizeCjk, fetchRetry, upsertWorks, upsertSources } from './lib.mjs';

const UA = { headers: { 'User-Agent': 'SourceLibrary-WorksCatalog/1.0 (derek@sourcelibrary.org)' } };
const REPO = 'DILA-edu/cbeta-metadata';

// canon edition tags; preference order for dedup (earlier = kept)
const CANON_TAG = { T: 'taisho', X: 'xuzangjing', J: 'jiaxing', A: 'zhonghua', K: 'koryo', N: 'nanchuan', L: 'qisha', M: 'mingzang' };
const CANON_PREF = ['T', 'X', 'J', 'A', 'K', 'N', 'L', 'M'];
const prefRank = (canon) => { const i = CANON_PREF.indexOf(canon); return i < 0 ? 99 : i; };

function centuryOf(year) {
  if (!Number.isInteger(year) || year === 0) return null;
  return year > 0 ? Math.floor((year - 1) / 100) + 1 : -(Math.floor((-year - 1) / 100) + 1);
}

const dir = await (await fetchRetry(`https://api.github.com/repos/${REPO}/contents/work-info`, UA)).json();
if (!Array.isArray(dir)) { console.error('GitHub API error:', dir.message); process.exit(1); }
const files = dir.filter(f => f.name.endsWith('.json')).map(f => f.name);
console.log(`work-info canons: ${files.map(f => f.replace('.json', '')).join(', ')}`);

// collect all textbody works across canons
const raw = [];
for (const f of files) {
  const canon = f.replace('.json', '');
  const obj = await (await fetchRetry(`https://raw.githubusercontent.com/${REPO}/master/work-info/${f}`)).json();
  for (const [wid, w] of Object.entries(obj)) {
    if (w.type && w.type !== 'textbody') continue;       // skip non-work entries
    if (!w.title) continue;
    raw.push({ wid, canon, ...w });
  }
  process.stderr.write(`${f}: ${raw.length} works so far\n`);
}

// dedupe within CBETA on normalized title + byline, preferring standard canons
const seen = new Map();
for (const w of raw) {
  const key = normalizeCjk(w.title) + '|' + normalizeCjk(w.byline || '');
  const prev = seen.get(key);
  if (!prev || prefRank(w.canon) < prefRank(prev.canon)) seen.set(key, w);
}
const deduped = [...seen.values()];
console.log(`${raw.length} canon entries -> ${deduped.length} distinct works after intra-CBETA dedup`);

const works = deduped.map(w => ({
  id: `cbeta:${w.wid}`,
  tradition: 'chinese',
  original_language: 'lzh',
  title: w.title,
  title_normalized: normalizeCjk(w.title),
  author: w.contributors?.[0]?.name || (w.byline ? w.byline.replace(/^\S+\s+/, '').replace(/[譯撰述著集造]$/, '') : null) || null,
  century: centuryOf(w.time_from),
  authority_ids: { cbeta_id: w.wid },
  corpus_tags: ['cbeta', CANON_TAG[w.canon] || w.canon.toLowerCase()].filter(Boolean),
  source_catalog: 'cbeta',
  extra: { byline: w.byline || null, dynasty: w.dynasty || null, category: w.category || null, juans: w.juans || null, vol: w.vol || null, canon: w.canon },
}));

console.log(`Prepared ${works.length} works (e.g. ${works.slice(0, 3).map(w => w.id + ' ' + w.title).join(' / ')})`);

// CBETA is a full digital TEXT edition — record a transcription work_source per
// work pointing at the CBETA reader. This is a LINK (not a redistribution of the
// text), so it carries no licence burden; it lets the census show these works as
// digitized-as-text (not "undigitized") even though they have no scan. The text
// metadata is MIT; the text bodies are CC BY-NC-SA 3.0 TW + © Taishō/Zokuzōkyō
// publishers — importing bodies into the reader is a separate, deliberate step.
const sources = deduped.map(w => ({
  work_id: `cbeta:${w.wid}`,
  source: 'cbeta',
  source_id: w.wid,
  kind: 'transcription',
  url: `https://cbetaonline.dila.edu.tw/${w.wid}`,
  iiif: false,
}));

const client = pgClient();
await client.connect();
const n = await upsertWorks(client, works);
const nS = await upsertSources(client, sources);
const count = (await client.query(`select count(*) c from works where source_catalog='cbeta'`)).rows[0].c;
const chinese = (await client.query(`select count(*) c from works where tradition='chinese'`)).rows[0].c;
await client.end();
console.log(`Upserted ${n} works, ${nS} transcription sources. works(cbeta)=${count}; total chinese works now ${chinese}.`);
