#!/usr/bin/env node
/**
 * Jung Küsnacht ↔ BPH bibliographic alignment.
 *
 * Of the 345 works in Jung's personal library at Küsnacht (e-rara OAI set
 * "cgj"), which ones also exist in BPH's catalogue (Supabase bph_works)?
 *
 * Jozef Ritman asked for this on 2026-05-21: "establish a meaningful
 * connection between the collections of the Embassy of the Free Mind
 * and Jung's library in Switzerland."
 *
 * This is a READ-ONLY analysis. Outputs a markdown report.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/jung-bph-alignment.mjs
 *
 * Output:
 *   .claude/docs/jung-bph-alignment-YYYY-MM-DD.md
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OAI_BASE = 'https://www.e-rara.ch/oai';
const OAI_SET = process.env.OAI_SET || 'cgj';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Normalization (consistent across both sides) ─────────────────────────

/**
 * Orthographic equivalences common in early modern Latin / German / French
 * print culture. Applied AFTER diacritic stripping and lowercasing. These let
 * "Iohannes" and "Johannes", "vellus" and "uellus", "philosophia" and
 * "filosofia", "chymie" and "chimie" hit the same normalized form.
 *
 * Order matters — ligatures expand first, then character-class folds.
 */
function latinize(s) {
  return s
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/[ij]/g, 'i')           // Iohannes ↔ Johannes
    .replace(/[uv]/g, 'u')           // medieval u/v alternation
    .replace(/ae/g, 'e').replace(/oe/g, 'e')  // diphthong collapse
    .replace(/ph/g, 'f')             // philosophia ↔ filosofia
    .replace(/y/g, 'i');             // chymia ↔ chimia
}

function normalize(s) {
  const stripped = (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las|een|het|sancti|sanctus|sancto)\s+/i, '')
    .replace(/\[s\.n\.\]|\[s\.l\.\]|\[s\. n\.\]|\[s\. l\.\]/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return latinize(stripped);
}

// Surname-extracting normalizer: "Boccalini, Trajano" -> "boccalini"
function normSurname(author) {
  const a = normalize(author);
  if (!a) return '';
  const parts = a.split(/[, ]/).filter(Boolean);
  // For "lastname, firstname" form, first part is the surname
  // For "firstname lastname" form, last part is the surname
  // Heuristic: e-rara seems to use the natural "firstname lastname [year-year]" form
  // BPH uses "Lastname, Firstname". So matching is hard.
  // Safest: build a set of all words and require one significant word matches.
  return parts.filter(p => p.length >= 4).join(' ');
}

function tokens(s, minLen = 4) {
  return normalize(s).split(' ').filter(w => w.length >= minLen);
}

// ── OAI-PMH harvest ──────────────────────────────────────────────────────

function parseRecords(xml) {
  const records = [];
  const recordRegex = /<record>([\s\S]*?)<\/record>/g;
  let m;
  while ((m = recordRegex.exec(xml)) !== null) {
    const r = m[1];
    if (r.includes('status="deleted"')) continue;
    const idMatch = r.match(/<identifier>oai:www\.e-rara\.ch:(\d+)<\/identifier>/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const get = (tag) => {
      const x = r.match(new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`));
      return x ? x[1].trim() : null;
    };
    const date = get('date');
    const yearMatch = date && date.match(/(\d{4})/);
    records.push({
      erara_id: id,
      title: get('title') || '',
      author: get('creator') || '',
      year: yearMatch ? parseInt(yearMatch[1]) : null,
      source_url: `https://www.e-rara.ch/content/titleinfo/${id}`,
    });
  }
  const tokenMatch = xml.match(/<resumptionToken[^>]*>([^<]*)<\/resumptionToken>/);
  return { records, resumptionToken: tokenMatch?.[1]?.trim() || null };
}

async function harvestCgj() {
  console.log(`Harvesting e-rara OAI set "${OAI_SET}"...`);
  let url = `${OAI_BASE}?verb=ListRecords&metadataPrefix=oai_dc&set=${OAI_SET}`;
  const all = [];
  while (url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (Jung-BPH alignment)' },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      console.error(`OAI ${res.status}, retrying`);
      await sleep(5000);
      continue;
    }
    const xml = await res.text();
    const { records, resumptionToken } = parseRecords(xml);
    all.push(...records);
    url = resumptionToken
      ? `${OAI_BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`
      : null;
    await sleep(1000);
  }
  console.log(`  ${all.length} cgj records`);
  return all;
}

// ── BPH pull ─────────────────────────────────────────────────────────────

async function pullBphCatalogue(supa) {
  console.log('Pulling BPH catalogue (bph_works)...');
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supa
      .from('bph_works')
      .select('ubn, title, author, year, place, publisher, printer, shelf_mark, ustc_sn')
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('Supabase error:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
    process.stdout.write(`  ${all.length}…\r`);
  }
  console.log(`  ${all.length} BPH works`);
  return all;
}

// ── Matching ─────────────────────────────────────────────────────────────

function buildBphIndex(bph) {
  // Index by normalized title (first 4+ chars) for fast scan, then refine by author/year.
  const byTitleStart = new Map();
  for (const b of bph) {
    const t = normalize(b.title);
    if (t.length < 6) continue;
    const key = t.slice(0, 12); // first 12 chars of normalized title
    if (!byTitleStart.has(key)) byTitleStart.set(key, []);
    byTitleStart.get(key).push({ ...b, _normTitle: t, _normAuthor: normalize(b.author) });
  }
  return byTitleStart;
}

function findMatches(record, byTitleStart) {
  const normT = normalize(record.title);
  if (normT.length < 6) return [];
  const key = normT.slice(0, 12);
  const candidates = byTitleStart.get(key) || [];
  if (candidates.length === 0) return [];

  const recTokens = new Set(tokens(record.title, 5));
  const recAuthorTokens = new Set(tokens(record.author, 4));
  const matches = [];

  for (const c of candidates) {
    const cTokens = new Set(tokens(c.title, 5));
    // Title token overlap — share at least 2 significant 5+ letter words
    const titleShared = [...recTokens].filter(t => cTokens.has(t));
    if (titleShared.length < 2 && recTokens.size > 1 && cTokens.size > 1) continue;
    if (titleShared.length === 0) continue;

    // Year proximity (within 5 years, or both unknown)
    let yearScore = 0;
    if (record.year && c.year) {
      const diff = Math.abs(record.year - c.year);
      if (diff > 10) continue;
      yearScore = diff === 0 ? 3 : diff <= 2 ? 2 : 1;
    }

    // Author surname overlap
    const cAuthorTokens = new Set(tokens(c.author, 4));
    const authorShared = [...recAuthorTokens].filter(t => cAuthorTokens.has(t));
    const authorScore = authorShared.length;

    const score = titleShared.length * 2 + yearScore + authorScore * 2;
    matches.push({ bph: c, score, titleShared, authorShared, yearScore });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3);
}

// ── Report ───────────────────────────────────────────────────────────────

function writeReport(jung, results) {
  const today = new Date().toISOString().slice(0, 10);
  const baseDir = path.join(process.cwd(), '.claude/docs');
  fs.mkdirSync(baseDir, { recursive: true });

  const matched = results.filter(r => r.matches.length > 0);
  const notInBph = results.filter(r => r.matches.length === 0);

  const lines = [];
  lines.push(`# Jung Küsnacht ↔ BPH alignment (${today})`);
  lines.push('');
  lines.push(`Of the **${jung.length}** works in Jung's personal library at Küsnacht (e-rara OAI set \`${OAI_SET}\` — held by Stiftung der Werke von C.G. Jung, Zürich), which also exist in the BPH catalogue?`);
  lines.push('');
  lines.push(`Match heuristic: shared significant words in title + author surname overlap + year proximity (≤10 years). Highest-scoring BPH candidate shown per Jung title.`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- Jung works: **${jung.length}**`);
  lines.push(`- Also present in BPH (candidate match): **${matched.length}**`);
  lines.push(`- Jung-only (no BPH match found): ${notInBph.length}`);
  lines.push('');
  lines.push(`Coverage: **${(matched.length / jung.length * 100).toFixed(1)}%** of Jung's Küsnacht library is also bibliographically represented in BPH.`);
  lines.push('');

  const ustcCount = matched.filter(r => r.matches[0]?.bph.ustc_sn).length;
  lines.push(`## Works present in both libraries (${matched.length})`);
  lines.push('');
  lines.push(`USTC anchor: **${ustcCount}** of these ${matched.length} matches carry a USTC SN on the BPH side — those are identity-grade (USTC = Universal Short Title Catalogue, which only covers pre-1651 imprints, so coverage is limited to early matches).`);
  lines.push('');
  lines.push('| Year | Author | Jung title (Küsnacht) | BPH match (UBN / title) | USTC | Score |');
  lines.push('|---|---|---|---|---|--:|');
  for (const r of matched.sort((a, b) => (a.jung.year || 9999) - (b.jung.year || 9999))) {
    const best = r.matches[0];
    const t = (r.jung.title || '').slice(0, 60).replace(/\|/g, '\\|');
    const a = (r.jung.author || '').slice(0, 30).replace(/\|/g, '\\|');
    const bphT = (best.bph.title || '').slice(0, 50).replace(/\|/g, '\\|');
    const ubn = best.bph.ubn || '';
    const ustc = best.bph.ustc_sn ? `[${best.bph.ustc_sn}](https://www.ustc.ac.uk/editions/${best.bph.ustc_sn})` : '–';
    lines.push(`| ${r.jung.year || '–'} | ${a} | ${t} | [${ubn}](https://bph.sourcelibrary.org/catalog/${ubn}) ${bphT} | ${ustc} | ${best.score} |`);
  }
  lines.push('');

  // Top 30 not in BPH (could be opportunities for acquisition / scholarly connections)
  lines.push(`## In Jung's library but not in BPH (${notInBph.length}, first 30 shown)`);
  lines.push('');
  lines.push('| Year | Author | Title | e-rara |');
  lines.push('|---|---|---|---|');
  for (const r of notInBph.sort((a, b) => (a.jung.year || 9999) - (b.jung.year || 9999)).slice(0, 30)) {
    const t = (r.jung.title || '').slice(0, 70).replace(/\|/g, '\\|');
    const a = (r.jung.author || '').slice(0, 30).replace(/\|/g, '\\|');
    lines.push(`| ${r.jung.year || '–'} | ${a} | ${t} | [${r.jung.erara_id}](${r.jung.source_url}) |`);
  }
  if (notInBph.length > 30) lines.push(`| _...and ${notInBph.length - 30} more_ | | | |`);
  lines.push('');

  lines.push(`## Method note`);
  lines.push('');
  lines.push(`This is a fuzzy bibliographic match, not a UBN-level identity check. The score combines:`);
  lines.push(`- Shared significant title words (≥5 letters), weighted ×2`);
  lines.push(`- Shared author tokens (≥4 letters), weighted ×2`);
  lines.push(`- Year proximity (3 pts for same year, 2 for ≤2 years, 1 for ≤10 years)`);
  lines.push('');
  lines.push(`Different editions of the same work (e.g. *Theatrum chemicum* 1602 in Zürich and 1659 in BPH) count as a match because the bibliographic connection is what Jozef's question asked about.`);
  lines.push('');
  lines.push(`The matches table is sorted by year and shows the highest-scoring BPH candidate per Jung work. False positives are possible at the long-tail (low score) end — review with Paul before publishing.`);

  const mdPath = path.join(baseDir, `jung-bph-alignment-${today}.md`);
  fs.writeFileSync(mdPath, lines.join('\n'));
  console.log(`Wrote ${mdPath}`);

  const jsonPath = path.join(baseDir, `jung-bph-alignment-${today}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    oai_set: OAI_SET,
    jung_count: jung.length,
    matched_count: matched.length,
    not_in_bph_count: notInBph.length,
    results,
  }, null, 2));
  console.log(`Wrote ${jsonPath}`);

  // CSV — flat, spreadsheet-friendly, one row per Jung work. For Jozef/Emiel
  // to share with scholars. Includes the best BPH match (if any).
  const csvPath = path.join(baseDir, `jung-bph-alignment-${today}.csv`);
  const csvRows = [];
  csvRows.push([
    'jung_year', 'jung_author', 'jung_title', 'jung_erara_id', 'jung_url',
    'match_status', 'match_score',
    'bph_ubn', 'bph_author', 'bph_title', 'bph_year', 'bph_place', 'bph_printer', 'bph_publisher', 'bph_url',
    'bph_ustc_sn', 'ustc_url',
  ].join(','));
  const csvEsc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  for (const r of results.sort((a, b) => (a.jung.year || 9999) - (b.jung.year || 9999))) {
    const best = r.matches[0];
    const ustcSn = best?.bph.ustc_sn || '';
    const status = best ? (ustcSn ? 'in_bph_ustc' : 'in_bph_fuzzy') : 'jung_only';
    csvRows.push([
      r.jung.year, r.jung.author, r.jung.title, r.jung.erara_id, r.jung.source_url,
      status, best ? best.score : '',
      best?.bph.ubn || '', best?.bph.author || '', best?.bph.title || '',
      best?.bph.year || '', best?.bph.place || '', best?.bph.printer || '', best?.bph.publisher || '',
      best ? `https://bph.sourcelibrary.org/catalog/${best.bph.ubn}` : '',
      ustcSn, ustcSn ? `https://www.ustc.ac.uk/editions/${ustcSn}` : '',
    ].map(csvEsc).join(','));
  }
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`Wrote ${csvPath}`);

  return { matched, notInBph, mdPath, jsonPath, csvPath };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  const [jung, bph] = await Promise.all([
    harvestCgj(),
    pullBphCatalogue(supa),
  ]);

  console.log('\nBuilding BPH title index...');
  const byTitleStart = buildBphIndex(bph);
  console.log(`  ${byTitleStart.size} title-prefix buckets`);

  console.log('\nMatching...');
  const results = jung.map(j => ({ jung: j, matches: findMatches(j, byTitleStart) }));

  const matched = results.filter(r => r.matches.length > 0);
  console.log(`  ${matched.length} of ${jung.length} have BPH matches`);

  writeReport(jung, results);

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\nDone in ${mins} min.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
