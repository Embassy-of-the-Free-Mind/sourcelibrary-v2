#!/usr/bin/env node
/**
 * GRETIL Sanskrit transcription corpus → works catalog (#2453, Frame B).
 *
 * GRETIL (Göttingen Register of Electronic Texts in Indian Languages) is the
 * largest open corpus of machine-readable Sanskrit/Prakrit/Pali e-texts. It
 * adds two things to the catalog that Wikidata (ingest-sanskrit-wikidata) does
 * not: a few hundred net-new works, and — for every text — a `transcription`
 * source (an openly available digital edition), which is real census evidence.
 *
 * Source: the openly-mirrored GitHub repo INDOLOGY/GRETIL-mirror (the
 * gretil.sub.uni-goettingen.de site itself is harder to crawl). Pure HTTP, no
 * Cloudflare. The git tree enumerates ~3,445 Sanskrit .htm files; many are
 * volumes/recensions of one work (Rgveda = rv_01..rv_10), so we group by
 * directory + filename stem (volume/format suffixes stripped) → one work per
 * group, and fetch one representative file's <title> for the work name.
 *
 * Authority id = `gretil:<dir>/<stem>`, source_catalog 'gretil',
 * original_language 'san'. translation_status left 'unknown'.
 *
 * Run on Hetzner (SUPABASE_DB_URL). Idempotent upsert.
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/ingest-gretil.mjs [--limit=N] [--dry-run]
 */
import { pgClient, fetchRetry, sleep, upsertWorks, upsertSources } from './lib.mjs';

const UA = 'SourceLibrary-WorksCatalog/1.0 (derek@sourcelibrary.org)';
const RAW = 'https://raw.githubusercontent.com/INDOLOGY/GRETIL-mirror/master';
const SITE = 'https://gretil.sub.uni-goettingen.de';
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.slice(2).split('='); return [k, v ?? true];
}));
const LIMIT = parseInt(args.limit) || Infinity;
const DRY_RUN = 'dry-run' in args;

// filename stem: strip extension, format suffixes (_u/_au/_pu/_acu/_su…) and a
// trailing volume number, so rv_01_u, rv_02_u, … collapse to 'rv'.
function stemOf(file) {
  return file.replace(/\.htm$/i, '')
    .replace(/_(a?[uoyp]|acu|au|pu|su|tu|nu|iu|eu|cu|mu)$/i, '')
    .replace(/[_-]?\d+[a-z]?$/i, '')
    .replace(/_$/, '') || file.replace(/\.htm$/i, '');
}
// clean a GRETIL <title>: drop "% " prefix and a ": Adiparvan"-style sub-part.
function cleanTitle(t) {
  if (!t) return null;
  return t.replace(/^[%#\s]+/, '').split(/[:|]/)[0].replace(/\s+/g, ' ').trim() || null;
}

console.log('Fetching GRETIL file tree from GitHub mirror…');
const tree = await (await fetchRetry(
  'https://api.github.com/repos/INDOLOGY/GRETIL-mirror/git/trees/master?recursive=1',
  { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } })).json();
const files = (tree.tree || [])
  .filter(t => t.type === 'blob' && /\/1_sanskr\/.*\.htm$/i.test(t.path) && !/corpustei/i.test(t.path))
  .map(t => t.path);
console.log(`Sanskrit .htm files: ${files.length}`);

// group by directory + stem
const groups = new Map(); // key -> { dir, stem, files[] }
for (const path of files) {
  const i = path.lastIndexOf('/');
  const dir = path.slice(0, i), name = path.slice(i + 1);
  const key = `${dir}/${stemOf(name)}`;
  if (!groups.has(key)) groups.set(key, { dir, stem: stemOf(name), files: [] });
  groups.get(key).files.push(path);
}
console.log(`Work groups: ${groups.size}`);

// fetch one representative <title> per group (bounded, polite)
const works = [], sources = [];
let done = 0, titled = 0;
for (const [key, g] of groups) {
  if (done >= LIMIT) break;
  done++;
  const rep = g.files[0];
  let title = null;
  try {
    const html = await (await fetchRetry(`${RAW}/${rep}`, { headers: { 'User-Agent': UA } })).text();
    title = cleanTitle((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  } catch { /* keep null */ }
  if (title) titled++;
  // fallback: derive a rough name from the stem if no title
  const finalTitle = title || g.stem.replace(/[_-]/g, ' ');
  const id = `gretil:${key.replace(`${SITE}`, '').replace(/^.*gretil\//, '')}`;
  works.push({
    id,
    tradition: 'sanskrit',
    original_language: 'san',
    title: finalTitle,
    title_romanized: /[a-zA-Z]/.test(finalTitle) ? finalTitle : null,
    corpus_tags: ['gretil'],
    source_catalog: 'gretil',
    extra: { gretil_files: g.files.length },
  });
  // one transcription source per group (URL = the GRETIL site page for rep file)
  sources.push({
    work_id: id,
    source: 'gretil',
    source_id: g.stem,
    kind: 'transcription',
    url: `${SITE}/${rep.replace(/^gretil\.sub\.uni-goettingen\.de\//, '')}`,
    iiif: false,
    coverage: g.files.length > 1 ? `${g.files.length} files` : null,
    extra: {},
  });
  if (done % 100 === 0) { console.log(`  …${done}/${Math.min(groups.size, LIMIT)} groups (${titled} titled)`); }
  await sleep(120);
}

console.log(`\nPrepared ${works.length} works, ${titled} with real <title> (rest stem-derived)`);
console.log('Sample:');
for (const w of works.slice(0, 8)) console.log(`  ${w.id}  |  ${w.title}`);
if (DRY_RUN) { console.log('\nDRY RUN — nothing written.'); process.exit(0); }

const client = pgClient();
await client.connect();
const nw = await upsertWorks(client, works);
const ns = await upsertSources(client, sources);
const stats = (await client.query(
  `select count(*) total, count(*) filter (where source_catalog='gretil') from_gretil from works where tradition='sanskrit'`)).rows[0];
const tr = (await client.query(`select count(*) n from work_sources where source='gretil'`)).rows[0];
await client.end();
console.log(`\nUpserted ${nw} works + ${ns} transcription sources.`);
console.log(`Sanskrit works now ${stats.total} (${stats.from_gretil} from gretil); gretil transcription sources: ${tr.n}`);
