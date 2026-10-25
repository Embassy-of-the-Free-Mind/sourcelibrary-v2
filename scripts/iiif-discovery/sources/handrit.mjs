#!/usr/bin/env node
/**
 * handrit.is (Icelandic and Old Norse manuscripts) discovery harvester.
 *
 * PRIOR ART: scripts/iiif-discovery/sources/oai-dc.mjs — same candidate shape and
 * idempotent upsert. handrit.is has no OAI endpoint and its search sits behind
 * hCaptcha (probed 2026-10-24), but the catalogue itself is published as TEI P5
 * on GitHub (github.com/Handrit/Manuscripts, ~20K files, one per manuscript per
 * description language). One `git clone` replaces ~18K page requests.
 *
 *   git clone --depth 1 https://github.com/Handrit/Manuscripts.git <dir>
 *   node --env-file=.env.production.local scripts/iiif-discovery/sources/handrit.mjs --repo-dir=<dir> [--imaged-only] [--dry-run]
 *
 * A manuscript is described up to three times (is/en/da); rows are keyed on the
 * shelfmark (`<idno>`), so it lands once. `--imaged-only` keeps manuscripts whose
 * TEI lists page images (`<facsimile>` → myndir.handrit.is, plain JPEGs at about
 * 4,000 px, no IIIF manifest); the rest are catalogue-only.
 *
 * Writes `import_candidates` rows ONLY (status 'discovered'). Never touches `books`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, upsertCandidates } from '../lib/candidate-store.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const DIR = args['repo-dir'];
if (!DIR) { console.error('--repo-dir=<clone of github.com/Handrit/Manuscripts> required'); process.exit(1); }
const DRY_RUN = 'dry-run' in args;
const IMAGED_ONLY = 'imaged-only' in args;

const LANG = { is: 'Icelandic', non: 'Icelandic', da: 'Danish', la: 'Latin', de: 'German', en: 'English', sv: 'Swedish', no: 'Norwegian', nn: 'Norwegian', fo: 'Faroese', nl: 'Dutch', fr: 'French', grc: 'Greek', he: 'Hebrew' };

function* xmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* xmlFiles(p);
    else if (name.endsWith('.xml')) yield p;
  }
}

const byId = new Map();
for (const file of xmlFiles(path.join(DIR, 'Manuscripts'))) {
  const x = readFileSync(file, 'utf8');
  const idno = x.match(/<idno[^>]*>([^<]+)<\/idno>/)?.[1]?.trim();
  if (!idno) continue;
  const images = (x.match(/SECONDARY_DISPLAY/g) || []).length;
  const prev = byId.get(idno);
  if (prev) { prev.page_count = Math.max(prev.page_count || 0, images) || null; continue; }
  const sub = x.match(/<title type="subordinate">([^<]*)/)?.[1]?.trim();
  const titles = [...x.matchAll(/<title[^>]*>([^<]{2,200})<\/title>/g)].map(m => m[1].trim()).filter(t => t !== idno);
  const lang = (x.match(/<textLang[^>]*mainLang="([^"]+)"/)?.[1] || 'und').split('-')[0];
  const od = x.match(/<origDate([^>]*)>/)?.[1] || '';
  const year = parseInt(od.match(/(?:notBefore|when|from)="(\d{3,4})/)?.[1]) || null;
  const yearTo = parseInt(od.match(/(?:notAfter|to)="(\d{3,4})/)?.[1]) || year;
  byId.set(idno, {
    source: 'handrit',
    source_id: idno,
    manifest_url: null,
    origin_library: x.match(/<repository>([^<]+)/)?.[1]?.trim() || 'handrit.is',
    provider_name: 'handrit.is',
    title: sub || idno,
    author: 'Unknown',
    language: LANG[lang] || lang,
    date_text: od ? (x.match(/<origDate[^>]*>([^<]*)/)?.[1]?.trim() || null) : null,
    date_earliest: year,
    date_latest: yearTo,
    page_count: images || null,
    subjects: [...new Set(titles)].slice(0, 40),
    source_url: `https://handrit.is/manuscript/view/is/${encodeURIComponent(idno.replace(/ /g, '-'))}`,
    metadata: { shelfmark: idno, images, image_base: images ? 'https://myndir.handrit.is/file/Handrit.is/' : null, tei_path: path.relative(DIR, file) },
  });
}

const rows = [...byId.values()].filter(r => !IMAGED_ONLY || r.page_count);
const langs = {};
for (const r of rows) langs[r.language] = (langs[r.language] || 0) + 1;
console.log(`handrit: ${byId.size.toLocaleString()} manuscripts, ${[...byId.values()].filter(r => r.page_count).length.toLocaleString()} with images; writing ${rows.length.toLocaleString()}${DRY_RUN ? ' (dry run)' : ''}`);
console.log(`languages: ${Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(' ')}`);
if (!DRY_RUN) {
  await withMongo(async (db) => {
    await ensureIndexes(db);
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 1000) inserted += (await upsertCandidates(db, rows.slice(i, i + 1000))).inserted;
    console.log(`new rows: ${inserted.toLocaleString()}`);
  });
}
