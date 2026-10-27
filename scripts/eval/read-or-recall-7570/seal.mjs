#!/usr/bin/env node
// PRIOR ART: scripts/eval/continuation-probe-7271/draw.mjs --write (seals the pages before any probe call); this seals
// the PAIRS from the pools, the blind key screen and the online check, by the preregistered rules (#7570).
/**
 * seal.mjs — screen + online check + pairing → pairs.json and the published pair list (#7570).
 *
 *   node scripts/eval/read-or-recall-7570/seal.mjs phrases   → results/…/phrases.json (what the online check searches)
 *   node scripts/eval/read-or-recall-7570/seal.mjs seal      → results/…/pairs.json + dataset/read-or-recall-v0/
 *
 * Screen pass: SCRIPT is the target, SHARE ≥ 60, KIND print, PAGE running-prose | verse | text-with-commentary, key
 * ≥ MIN_KEY comparison characters. Online check (online.json from online.mjs, one row per page_key: { hits: [{ phrase,
 * label, url }] }): an obscure page must have no `etext` hit; famous pages keep their work-level label. Pairing: famous in pool
 * order, up to 20; each takes the first unused eligible obscure page in pool order with the same half-century, else
 * within ±100 years, else (a year missing on either side) any. The key text of the published rows is withheld
 * (sha256 only): the obscure pages are the contamination-resistant half, and a published transcription would end that.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { cmp } from './text.mjs';
import { anchorOf } from './prompts.mjs';
import { CANARY_GUID, CANARY_TEXT } from '../../lib/dataset-canary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../../..');
const RES = path.join(__dirname, '../results/read-or-recall-7570');
const DS = path.join(__dirname, '../dataset/read-or-recall-v0');
const MODE = process.argv[2];
const N_PAIRS = 20;
const MIN_KEY = { latin: 600, greek: 400, chinese: 150, hebrew: 300, sanskrit: 300 };
const TARGET = { latin: /latin/i, greek: /greek/i, chinese: /chinese/i, hebrew: /hebrew/i, sanskrit: /devanagari|sanskrit/i };
const PAGE_OK = /running-prose|verse|text-with-commentary/;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const pools = JSON.parse(fs.readFileSync(path.join(RES, 'pools.json'), 'utf8')).pools;
const keys = new Map();
for (const l of fs.readFileSync(path.join(RES, 'keys.jsonl'), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (!keys.has(r.page_key) || !r.cls) keys.set(r.page_key, r); }
const pk = (c) => `${c.book_id}:${c.page_number}`;

function screen(c, script) {
  const k = keys.get(pk(c));
  if (!k) return 'not screened';
  if (k.cls) return `key call failed: ${k.cls}`;
  if (!TARGET[script].test(k.script)) return `script ${k.script}`;
  if (!(k.share >= 60)) return `share ${k.share}`;
  if (!/print/.test(k.kind)) return `kind ${k.kind}`;
  if (!PAGE_OK.test(k.page)) return `page ${k.page}`;
  const n = [...cmp(k.text, script)].length;
  if (n < MIN_KEY[script]) return `key ${n} chars < ${MIN_KEY[script]}`;
  return null;
}

/** Two search phrases from the key: 8 words at word 30 and at the middle (Chinese: 10 Han characters). */
function phrases(text, script) {
  const t = String(text || '').replace(/\[\.\.\.\]|\[…\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (script === 'chinese') {
    const han = [...t].filter((ch) => /\p{Script=Han}/u.test(ch));
    const at = (i) => han.slice(i, i + 10).join('');
    return [at(30), at(Math.max(40, Math.floor(han.length / 2)))];
  }
  const w = t.split(' ').filter((x) => /\p{L}{2,}/u.test(x)).map((x) => x.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''));
  const at = (i) => w.slice(i, i + 8).join(' ');
  return [at(30), at(Math.max(45, Math.floor(w.length / 2)))];
}

if (MODE === 'phrases') {
  const out = {};
  for (const [script, p] of Object.entries(pools)) for (const side of ['famous', 'obscure']) for (const c of p[side]) {
    if (screen(c, script)) continue;
    if (side === 'famous' && (script === 'greek' || script === 'chinese')) continue; // carries an aligned e-text already
    out[pk(c)] = { script, side, title: c.title, author: c.author, year: c.year, phrases: phrases(keys.get(pk(c)).text, script) };
  }
  fs.writeFileSync(path.join(RES, 'phrases.json'), JSON.stringify(out, null, 1));
  const by = {}; for (const v of Object.values(out)) by[`${v.script}/${v.side}`] = (by[`${v.script}/${v.side}`] || 0) + 1;
  console.log(by);
  process.exit(0);
}
if (MODE !== 'seal') { console.error('usage: seal.mjs phrases|seal'); process.exit(2); }

const online = JSON.parse(fs.readFileSync(path.join(RES, 'online.json'), 'utf8'));
// relabelled here with the final rule (online.mjs SELF), so a row written before that rule was fixed reads the same
const SELF = /Embassy-of-the-Free-Mind|JDerekLomas\/|sourcelibrary\.org/i;
for (const v of Object.values(online)) for (const h of v.hits || []) if (SELF.test(h.url || '')) h.label = 'self';
const labels = (c) => (online[pk(c)]?.hits || []).map((h) => h.label);
const log = [];
const pairs = [], pages = [];
for (const [script, p] of Object.entries(pools)) {
  const elig = (side) => p[side].map((c, i) => ({ c, i })).filter(({ c }) => {
    const why = screen(c, script);
    if (why) { log.push({ script, side, page_key: pk(c), out: why }); return false; }
    const L = labels(c);
    // Deviation (recorded in the experiment file before sealing): famous Latin/Hebrew/Sanskrit pages are labelled at
    // the work level (canonical title, or a RECITATION refusal), not by a page lookup: the lookups miss too many
    // known-online pages (online-summary.json, calibration rows) for a miss to unlabel a page.
    if (side === 'obscure') {
      if (!online[pk(c)]) { log.push({ script, side, page_key: pk(c), out: 'not online-checked' }); return false; }
      if (L.includes('etext')) { log.push({ script, side, page_key: pk(c), out: 'etext hit for an obscure page' }); return false; }
    }
    return true;
  });
  const F = elig('famous'), O = elig('obscure');
  const used = new Set();
  let n = 0;
  for (const { c: f } of F) {
    if (n >= N_PAIRS) break;
    const free = O.filter(({ c }) => !used.has(pk(c)));
    const yf = typeof f.year === 'number' ? f.year : null;
    const pick = free.find(({ c }) => yf != null && c.half != null && c.half === f.half)
      || free.find(({ c }) => yf != null && typeof c.year === 'number' && Math.abs(c.year - yf) <= 100)
      || free.find(({ c }) => yf == null || typeof c.year !== 'number');
    if (!pick) { log.push({ script, side: 'famous', page_key: pk(f), out: 'no obscure partner' }); continue; }
    used.add(pk(pick.c)); n++;
    const pair_id = `${script}-${String(n).padStart(2, '0')}`;
    pairs.push({ pair_id, script, famous: pk(f), obscure: pk(pick.c), year_gap: yf != null && typeof pick.c.year === 'number' ? Math.abs(pick.c.year - yf) : null });
    for (const [side, c] of [['famous', f], ['obscure', pick.c]]) {
      const k = keys.get(pk(c));
      const etext = c.ref?.path ? fs.readFileSync(path.join(ROOT, c.ref.path), 'utf8') : null;
      pages.push({ slug: `${pair_id}-${side[0]}`, pair_id, script, side, book_id: c.book_id, page_number: c.page_number, page_id: c.page_id || null,
        image_url: c.image_url, image_id: c.page_id || `${c.book_id}-p${c.page_number}`, title: String(c.title || '').slice(0, 200), author: c.author || null, year: c.year ?? null, language: c.language || null,
        famous_kind: c.famous_kind || null, label_evidence: c.famous_evidence || null, online: online[pk(c)] || null,
        stored_model: c.stored_model || null, stored_read_at: c.stored_read_at || null, recitation_count: c.recitation_count ?? null,
        key_kind: etext ? 'etext-window' : 'opus-blind', key_ref: c.ref || null, key_text: etext || k.text, opus_key_text: k.text,
        anchor: anchorOf(k.text, script), key_raw_chars: [...String(k.text).replace(/\s+/g, ' ')].length,
        screen: { script: k.script, share: k.share, kind: k.kind, page: k.page } });
    }
  }
  if (n < N_PAIRS) log.push({ script, out: `SHORT: ${n} pairs` });
  console.log(`${script}: ${n} pairs (famous eligible ${F.length}, obscure eligible ${O.length})`);
}
fs.writeFileSync(path.join(RES, 'pairs.json'), JSON.stringify({ issue: 7570, sealed_at: new Date().toISOString(), pairs, pages }, null, 1));
fs.writeFileSync(path.join(RES, 'seal-log.json'), JSON.stringify(log, null, 1));

// the published pair list: no page text (sha256 of the key only)
fs.mkdirSync(DS, { recursive: true });
const rows = pages.map((p) => ({ slug: p.slug, pair_id: p.pair_id, script: p.script, side: p.side, book_id: p.book_id, page_number: p.page_number,
  reader_url: `https://sourcelibrary.org/book/${p.book_id}`, image_url: p.image_url, title: p.title, author: p.author, year: p.year,
  famous_kind: p.famous_kind, label_evidence: p.label_evidence, online_check: p.online ? { phrases_sha256: (p.online.phrases || []).map(sha), hits: (p.online.hits || []).map((h) => ({ label: h.label, url: h.url })), checked_at: p.online.checked_at || null } : null,
  key_kind: p.key_kind, key_source: p.key_ref ? { source: p.key_ref.source, work: p.key_ref.work, url: p.key_ref.url, licence: p.key_ref.licence } : { source: 'blind Opus 5.5 read of the image (claude -p), prompts.mjs KEY' },
  key_sha256: sha(p.key_text), opus_key_sha256: sha(p.opus_key_text), screen: p.screen, canary: CANARY_GUID }));
fs.writeFileSync(path.join(DS, 'pairs.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(DS, 'CANARY.txt'), CANARY_TEXT + '\n');
console.log(`wrote ${pairs.length} pairs, ${pages.length} pages`);
