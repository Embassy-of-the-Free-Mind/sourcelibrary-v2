#!/usr/bin/env node
/**
 * Fetch romanized Javanese works (text) from jv.wikisource.org and STAGE them.
 *
 * Why stage, not import: Source Library's reader assumes every page has an image
 * (BookOverview filters pages with no thumbnail; the page reader expects
 * page.photo). So a text-only work would render BROKEN. Two sound integration
 * paths, decided separately (see issue #2144):
 *   (a) a small text-only reader mode, then import these as text books, OR
 *   (b) attach this transliteration onto the BL manuscript IMAGES we already
 *       hold (pages[n].transliteration) — renders correctly, needs page alignment.
 *
 * This script just captures the data (full plaintext + subpages + metadata) into
 * scripts/import/wikisource-staged/<slug>.json so it's ready to ingest either way.
 *
 * Usage:
 *   node scripts/import/fetch-wikisource-javanese.mjs --work "Babad Tanah Jawi"
 *   node scripts/import/fetch-wikisource-javanese.mjs --search "Serat" --max 20   # stage a catalog
 */
import { mkdirSync, writeFileSync } from 'fs';
import { parseArgs } from 'util';

const { values: args } = parseArgs({ options: {
  work: { type: 'string' }, search: { type: 'string' }, max: { type: 'string', default: '20' },
} });
const API = 'https://jv.wikisource.org/w/api.php';
const OUT = 'scripts/import/wikisource-staged';
mkdirSync(OUT, { recursive: true });
const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

async function api(params) {
  const u = new URL(API);
  Object.entries({ format: 'json', formatversion: '2', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let a = 1; a <= 4; a++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': 'SourceLibrary-importer/1.0 (library ingest)' } }); if (r.ok) return await r.json(); } catch {}
    if (a < 4) await new Promise(r => setTimeout(r, 1500 * a));
  }
  throw new Error('api failed: ' + u);
}
const plaintext = async (title) => (await api({ action: 'query', prop: 'extracts', explaintext: '1', titles: title })).query?.pages?.[0]?.extract || '';

async function subpages(title) {
  const r = await api({ action: 'query', list: 'prefixsearch', pssearch: title + '/', pslimit: '500' });
  return (r.query?.prefixsearch || []).map(p => p.title);
}

async function stageWork(title) {
  // Only keep subpages that are genuinely under "<title>/" (prefixsearch can return siblings).
  const subs = (await subpages(title)).filter(s => s.startsWith(title + '/'));
  const parts = [];
  const safeText = async (t) => { try { return await plaintext(t); } catch { console.log(`    (skip unreadable part: ${t})`); return ''; } };
  const root = await safeText(title);
  if (root.trim()) parts.push({ title, text: root });
  for (const s of subs) { const t = await safeText(s); if (t.trim()) parts.push({ title: s, text: t }); }
  const totalChars = parts.reduce((n, p) => n + p.text.length, 0);
  const doc = {
    work: title, source: 'jv.wikisource.org',
    source_url: 'https://jv.wikisource.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')),
    license: 'CC-BY-SA-4.0 (text); underlying work public domain',
    script: 'Latin (romanized Javanese)', language: 'Javanese',
    part_count: parts.length, total_chars: totalChars, parts,
    staged_at_note: 'timestamp added at write time by caller',
  };
  const file = `${OUT}/${slugify(title)}.json`;
  writeFileSync(file, JSON.stringify(doc, null, 2));
  console.log(`  staged "${title}": ${parts.length} part(s), ${totalChars.toLocaleString()} chars -> ${file}`);
  return { title, parts: parts.length, chars: totalChars };
}

async function main() {
  if (args.work) { await stageWork(args.work); return; }
  if (args.search) {
    const r = await api({ action: 'query', list: 'search', srsearch: args.search, srlimit: args.max, srnamespace: '0' });
    const hits = (r.query?.search || []).map(h => h.title);
    console.log(`search "${args.search}" -> ${hits.length} works:`);
    const catalog = [];
    for (const t of hits) { try { catalog.push(await stageWork(t)); } catch (e) { console.log(`  ✗ ${t}: ${e.message}`); } }
    writeFileSync(`${OUT}/_catalog.json`, JSON.stringify(catalog, null, 2));
    console.log(`\ncatalog: ${catalog.length} works staged`);
    return;
  }
  console.error('pass --work "<title>" or --search "<term>" [--max N]');
  process.exit(1);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
