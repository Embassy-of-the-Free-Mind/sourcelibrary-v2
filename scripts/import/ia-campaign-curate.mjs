#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/enumerate-dedupe-source.ts — produces the candidate lists this
 *   consumes; it dedupes MANIFESTATIONS (exact IA id) against holdings and leaves WORK clustering
 *   and subject filtering to a human. This is that human step made repeatable for a topic campaign.
 *   scripts/catalog-coverage/harvest-ia-english.mjs — harvests whole IA collections into
 *   `import_candidates` for the pre-1700 census; no clustering, no rights probe, other target.
 *   scripts/import/ia-manifest-direct.mjs — consumes what this emits (the manifest JSON).
 *
 * ia-campaign-curate — turn enumerate-dedupe candidate files into ONE curated manifest for a topic.
 *
 * WHY (2026-09-21, #4966). Internet Archive holds the post-1850 English print literature of many
 * subjects the library covers only in early-modern originals. Those books are cheap: IA ships its
 * own OCR (`ia-ocr-ingest.mjs` fills them for free where it clears the agreement gate). The cost is
 * CHOOSING — a keyword enumeration returns five scans of one work, novels by a namesake, catalogues
 * that mention the term, and post-1930 reprints. This script does the choosing so each topic is a
 * config file, not a hand-typed list.
 *
 * Pipeline:  merge --in files → relevance filter (config) → cluster by work (surname + title head)
 *            → probe archive.org/metadata for every survivor (rights, lending, djvu.xml, scanner)
 *            → pick ONE scan per work (non-Google, has djvu.xml, most leaves) → manifest + review table.
 *
 * Nothing here writes to Mongo. Review the table, then:
 *   node scripts/import/ia-manifest-direct.mjs --manifest <out>/<campaign>-manifest.json --dry-run
 *
 * Config (scripts/import/campaigns/<topic>.json):
 *   { "campaign": "<acquisition_campaign tag>", "collections": ["slug"], "lang": "English",
 *     "max_year": 1930,                 // US public-domain line for 2026 (published before 1931)
 *     "title_terms": ["yoga", ...],     // regex; an item is RELEVANT if title matches any ...
 *     "author_allow": ["vivekananda"],  // ... OR author matches any of these
 *     "author_deny": ["ballantyne, r"], // regex; dropped even if relevant (namesakes)
 *     "title_deny": ["catalogue of"] }  // regex; dropped even if relevant
 *
 * Usage:
 *   node scripts/import/ia-campaign-curate.mjs --config scripts/import/campaigns/yoga-west.json \
 *        --in cand1.json --in cand2.json --out-dir scratchpad/acq/yoga [--cache <dir>] [--no-probe]
 */
import fs from 'fs';
import path from 'path';
import { iaFetch } from '../lib/ia-ocr-meta.mjs';

const args = process.argv.slice(2);
const argAll = (f) => args.flatMap((a, i) => (a === f ? [args[i + 1]] : []));
const argOne = (f, d = null) => argAll(f)[0] ?? d;
const CONFIG = argOne('--config');
const INS = argAll('--in');
const OUT_DIR = argOne('--out-dir', 'scratchpad/acq');
const CACHE = argOne('--cache', path.join(OUT_DIR, 'ia-meta-cache'));
const PROBE = !args.includes('--no-probe');
if (!CONFIG || !INS.length) { console.error('Required: --config <json> --in <candidates.json> [--in ...]'); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const MAX_YEAR = cfg.max_year ?? 1930;
const rx = (list) => (list || []).map((s) => new RegExp(s, 'i'));
const TITLE_TERMS = rx(cfg.title_terms), AUTHOR_ALLOW = rx(cfg.author_allow), AUTHOR_DENY = rx(cfg.author_deny), TITLE_DENY = rx(cfg.title_deny);
fs.mkdirSync(OUT_DIR, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });

// ---------- 1. merge ----------
const byId = new Map();
for (const f of INS) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const c of j.candidates || []) if (!byId.has(c.ia_identifier)) byId.set(c.ia_identifier, { ...c, from: path.basename(f) });
}
const merged = [...byId.values()];

// ---------- 2. relevance ----------
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dropped = [];
const relevant = merged.filter((c) => {
  const t = fold(c.title), a = fold(c.author);
  const why = AUTHOR_DENY.some((r) => r.test(a)) ? 'author_deny'
    : TITLE_DENY.some((r) => r.test(t)) ? 'title_deny'
    : !(TITLE_TERMS.some((r) => r.test(t)) || AUTHOR_ALLOW.some((r) => r.test(a))) ? 'not_relevant'
    : null;
  if (why) { dropped.push({ ...c, why }); return false; }
  return true;
});

// ---------- 3. cluster by work ----------
const STOP = new Set(['the', 'a', 'an', 'of', 'or', 'and', 'by', 'with', 'in', 'to', 'on', 'for', 'its', 'being', 'from', 'as']);
const titleHead = (t) => fold(t).split(/[:;(\[]/)[0].replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).slice(0, 4).join(' ');
const surname = (a) => { const s = fold(a).replace(/\[.*?\]/g, '').split(/[,;]/)[0].replace(/[^a-z ]/g, '').trim().split(/\s+/); return s[s.length - 1] || ''; };
const clusters = new Map();
for (const c of relevant) { const k = `${surname(c.author)}|${titleHead(c.title)}`; if (!clusters.has(k)) clusters.set(k, []); clusters.get(k).push(c); }

// ---------- 4. probe ----------
async function probe(id) {
  const cf = path.join(CACHE, `${id}.json`);
  if (fs.existsSync(cf)) return JSON.parse(fs.readFileSync(cf, 'utf8'));
  if (!PROBE) return null;
  const r = await iaFetch(`https://archive.org/metadata/${id}`);
  if (!r.ok) return { http: r.status };
  const j = await r.json(); const m = j.metadata || {}; const files = j.files || [];
  const coll = [].concat(m.collection || []);
  const yr = parseInt(String(m.date || m.year || '').match(/\d{4}/)?.[0] || '0', 10) || null;
  const p = {
    id, year: yr, date: m.date || null, title: m.title, creator: [].concat(m.creator || []).join('; '),
    publisher: [].concat(m.publisher || [])[0] || null, language: [].concat(m.language || []).join(','),
    pcs: m['possible-copyright-status'] || null, rights: m.rights || null, licenseurl: m.licenseurl || null,
    access_restricted: m['access-restricted-item'] === 'true' || m['access-restricted-item'] === true,
    lending: coll.some((x) => /inlibrary|printdisabled|lendinglibrary/.test(x)),
    google: /goog$|^bub_gb_/.test(id) || /google/i.test(String(m.scanner || '')) || coll.includes('googlebooks'),
    imagecount: m.imagecount ? +m.imagecount : null,
    has_djvu_xml: files.some((f) => /_djvu\.xml$/.test(f.name || '')),
    djvu_xml_count: files.filter((f) => /_djvu\.xml$/.test(f.name || '')).length,
    has_jp2: files.some((f) => /_jp2\.zip$/.test(f.name || '')),
    contributor: m.contributor || null, collections: coll.slice(0, 6),
  };
  fs.writeFileSync(cf, JSON.stringify(p));
  return p;
}
const REQUIRE_JP2 = cfg.require_jp2 !== false;      // page images are what the reader shows; a PDF-only item has none
const REVIEW_IDS = rx(cfg.review_id_patterns);      // ids whose metadata is known-unreliable go to a separate REVIEW manifest
// Language gate (added 2026-09-25, theosophy shelf). The manifest stamps every pick with cfg.lang, so a
// candidate list that was enumerated without a language clause put 49 German/French/Finnish/Tamil scans
// into the table labelled "English" — the importer would have written `language: English` on all of them
// (invariants/language-fields.md). Refuse when the item's own `language` field is present and disagrees.
// Match on the first three letters so "eng" / "english" / "English" all pass; `lang_codes` in the config
// overrides the pattern for languages whose ISO code is not a prefix of the name (e.g. German → ger|deu).
const LANG_RX = cfg.lang ? new RegExp(cfg.lang_codes || `^${String(cfg.lang).slice(0, 3)}`, 'i') : null;
function rightsClass(c, p) {
  if (!p || p.http) return 'UNPROBED';
  if (p.access_restricted || p.lending) return 'REFUSE:restricted';
  if (REQUIRE_JP2 && !p.has_jp2) return 'REFUSE:no-jp2';
  if (LANG_RX && p.language && !String(p.language).split(',').some((l) => LANG_RX.test(l.trim()))) return `REFUSE:lang ${p.language}`;
  const y = p.year || c.year || null;
  if (y && y > MAX_YEAR) return `REFUSE:year ${y}`;
  const stated = /publicdomain|public domain|cc0|creativecommons|not_in_copyright/i.test(`${p.licenseurl || ''} ${p.rights || ''} ${p.pcs || ''}`);
  if (stated) return 'CLEAR:stated';
  if (!y) return 'REVIEW:no year';
  return 'CLEAR:by-date';        // published ≤ max_year, no statement on the item — the importer records it as assumed
}
const natural = (a) => { // "Vivekananda, Swami, 1863-1902" → "Swami Vivekananda"
  const parts = String(a || '').split(',').map((s) => s.trim()).filter((s) => s && !/^\d{4}|^-?\d{4}|^b\.|^d\.|^ca\./.test(s));
  return parts.length > 1 ? `${parts.slice(1).join(' ')} ${parts[0]}`.replace(/\s+/g, ' ').trim() : parts[0] || 'Unknown';
};

// ---------- 5. probe lazily and pick one scan per work ----------
// Probe the best-looking member of each work first (non-Google, most leaves per the search index)
// and move to the next only if it is refused — so a 1,300-item topic costs ~one probe per WORK,
// not per scan. Unprobed alternates are still listed on the pick so a reviewer can swap.
const preScore = (c) => (/goog$|^bub_gb_/.test(c.ia_identifier) ? 0 : 500) + Math.min(c.images || 0, 600);
const score = (c) => { const p = c.meta || {}; return (p.has_djvu_xml ? 1000 : 0) + (p.google ? 0 : 500) + Math.min(p.imagecount || c.images || 0, 600); };
const picks = [], alternates = [], refused = [];
let probed = 0;
for (const [k, members] of clusters) {
  members.sort((a, b) => preScore(b) - preScore(a));
  let keeper = null;
  for (const m of members) {
    m.meta = await probe(m.ia_identifier); m.rights = rightsClass(m, m.meta);
    if (++probed % 25 === 0) process.stderr.write(`  probed ${probed} (${picks.length} picks so far, ${clusters.size} works)\n`);
    if (m.rights.startsWith('REFUSE')) { refused.push({ ...m, cluster: k }); continue; }
    keeper = m; break;
  }
  if (!keeper) continue;
  const rest = members.filter((m) => m !== keeper && !m.rights?.startsWith('REFUSE'));
  picks.push({ ...keeper, cluster: k, alternates: rest.map((m) => m.ia_identifier) });
  alternates.push(...rest.map((m) => ({ ...m, cluster: k, keeper: keeper.ia_identifier })));
}
void score;
for (const c of picks) c.review = REVIEW_IDS.some((r) => r.test(c.ia_identifier)) ? 'REVIEW:id-pattern' : null;
picks.sort((a, b) => (a.meta?.year || a.year || 9999) - (b.meta?.year || b.year || 9999));

// ---------- 6. emit ----------
const CAMP = cfg.campaign || path.basename(CONFIG, '.json');
const toBook = (c) => ({
  id: c.ia_identifier, title: String(c.title).replace(/\s+/g, ' ').trim(), author: natural(c.author || c.meta?.creator),
  year: c.meta?.year || c.year || null, lang: cfg.lang || 'English',
  note: [c.rights, c.review, c.meta?.contributor ? `held by ${c.meta.contributor}` : null, c.alternates.length ? `alternate scans: ${c.alternates.join(', ')}` : null].filter(Boolean).join('; '),
});
const noteFor = (kind) => `Curated by ia-campaign-curate.mjs on ${new Date().toISOString().slice(0, 10)} from ${INS.map((f) => path.basename(f)).join(', ')}; config ${path.basename(CONFIG)}. Every id probed against archive.org/metadata: not access-restricted, not lending, ${REQUIRE_JP2 ? 'page images present (jp2), ' : ''}imprint ≤ ${MAX_YEAR}. One scan per work; alternates listed per book.${kind === 'review' ? ' REVIEW manifest: ids matching review_id_patterns (metadata known-unreliable — e.g. Digital Library of India years are often the author\'s birth year). Confirm imprint and language on the title page before --commit.' : ' REVIEW:no year rows — confirm the imprint on the title page before --commit.'}`;
const main = picks.filter((c) => !c.review), review = picks.filter((c) => c.review);
fs.writeFileSync(path.join(OUT_DIR, `${CAMP}-manifest.json`), JSON.stringify({ note: noteFor('main'), campaign: CAMP, collections: cfg.collections || [], BOOKS: main.map(toBook) }, null, 2));
if (review.length) fs.writeFileSync(path.join(OUT_DIR, `${CAMP}-manifest-review.json`), JSON.stringify({ note: noteFor('review'), campaign: CAMP, collections: cfg.collections || [], BOOKS: review.map(toBook) }, null, 2));
fs.writeFileSync(path.join(OUT_DIR, `${CAMP}-dropped.json`), JSON.stringify({ dropped, refused, alternates }, null, 2));
const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w);
const lines = [`# ${CAMP} — review table (${new Date().toISOString().slice(0, 10)})`, '',
  `merged ${merged.length} candidates → relevant ${relevant.length} (dropped ${dropped.length}: ${JSON.stringify(dropped.reduce((m, d) => (m[d.why] = (m[d.why] || 0) + 1, m), {}))}) → ${clusters.size} works → ${main.length} picks + ${review.length} review-manifest picks, ${refused.length} refused (${JSON.stringify(refused.reduce((m, d) => (m[d.rights] = (m[d.rights] || 0) + 1, m), {}))}), ${alternates.length} alternate scans`, '',
  '| year | ia id | pages | rights | djvu | google | title | author | alternates |', '|---|---|---|---|---|---|---|---|---|'];
for (const c of main) lines.push(`| ${c.meta?.year || c.year || '?'} | ${c.ia_identifier} | ${c.meta?.imagecount || c.images || '?'} | ${c.rights} | ${c.meta?.has_djvu_xml ? 'y' : 'n'} | ${c.meta?.google ? 'y' : ''} | ${String(c.title).slice(0, 70)} | ${natural(c.author).slice(0, 30)} | ${c.alternates.length} |`);
if (review.length) { lines.push('', `## Review manifest (${review.length}) — ids matching review_id_patterns`, '', '| year | ia id | pages | rights | title | author |', '|---|---|---|---|---|---|');
  for (const c of review) lines.push(`| ${c.meta?.year || c.year || '?'} | ${c.ia_identifier} | ${c.meta?.imagecount || c.images || '?'} | ${c.rights} | ${String(c.title).slice(0, 70)} | ${natural(c.author).slice(0, 30)} |`); }
lines.push('', '## Refused', ...refused.map((c) => `- ${c.ia_identifier} — ${c.rights} — ${String(c.title).slice(0, 60)}`));
lines.push('', '## Dropped (first 60)', ...dropped.slice(0, 60).map((c) => `- ${c.ia_identifier} — ${c.why} — ${String(c.title).slice(0, 50)} / ${String(c.author).slice(0, 30)}`));
fs.writeFileSync(path.join(OUT_DIR, `${CAMP}-review.md`), lines.join('\n') + '\n');
console.log(lines.slice(0, 3).join('\n'));
console.log(`\nwrote ${OUT_DIR}/${CAMP}-{manifest.json,review.md,dropped.json}`);
