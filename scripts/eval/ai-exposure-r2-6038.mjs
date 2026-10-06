#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/ai-exposure-6038.mjs — run 1 of #6038. This file BUILDS ON it: same
 * sample (seed 6038), same random 500, same packets and controls, and its helpers are imported,
 * not copied. Name comparison reuses scripts/lib/latin-morphology.mjs (`foldAccents`,
 * `foldOrthography`, `stripEnding`, `PARTICLES`) — src/lib/search/name-variants.ts `foldName` is
 * TS on the request path and generates forms rather than comparing them. The OpenRouter call
 * mirrors scripts/eval/lib/runners.mjs `runClaudeOpenRouter` (image-only there, so text-only here).
 *
 * ai-exposure-r2-6038 — run 2: answers the critiques of run 1 (#6038 "Critique review → design for
 * run 2"). Preregistered in scripts/eval/PREREGISTRATION-ai-exposure-r2-6038.md BEFORE any model call.
 *
 * Arms:
 *   neutral  — run 1's prompt minus 'Be honest: "no" and "unknown" are good answers.' Same packets.
 *   verify   — TITLE ONLY (catalogue author masked out of the title), year, language. The model
 *              names the author (guess allowed, flagged), a date and one line. The author is
 *              scored mechanically against the catalogue author. "Verified" = author matches.
 *
 * Stages:
 *   --stage=prep                         sample annotations (identifiability, author parse, masked
 *                                        title, units, century, genre), obscure-known tier, Nālandā
 *                                        slice, single-request 100, eye-check 40 -> works.jsonl …
 *   --stage=packets --arm=neutral|verify --set=sub500|controls|nalanda|single100
 *   --stage=gemini  --arm --set --model [--rep=2]       (endpoint eval/ai-exposure-refresh)
 *   --stage=openrouter --arm --set --model=openai/...   (OPENROUTER_API_KEY, usage.cost metered)
 *   --stage=ingest  --arm --set --model=claude-haiku|claude-opus  (subagent outputs)
 *   --stage=report
 *
 * node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ai-exposure-r2-6038.mjs --stage=prep
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from './lib/paired-stats.mjs';
import { wilson } from './lib/agreement-stats.mjs';
import { foldAccents, foldOrthography, stripEnding, PARTICLES } from '../lib/latin-morphology.mjs';
import { readJsonl, writeJsonl, fold, authorKey, workKey, bookLine, parseAnswers, bootstrap, cohenKappa, SEED } from './ai-exposure-6038.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R1 = path.join(HERE, 'results', 'ai-exposure-6038');
const OUT = path.join(HERE, 'results', 'ai-exposure-r2-6038');
const PRIVATE = process.env.AIEXP_PRIVATE || '/root/claude-jobs/ai-exposure-6038-private';
const ENDPOINT = 'eval/ai-exposure-refresh';
const CAP_USD = 20; // run 2, Gemini + OpenRouter together (Derek, 2026-10-06)
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
fs.mkdirSync(OUT, { recursive: true });

// ---------- catalogue author: persons, scorability ----------
const ROLE = /^(ed|eds|editor|editors|hrsg|hg|trans|transl|translator|translation|tr|comp|compiler|attrib|attributed|attr|commentator|ill|illustrator|printer|publisher)\.?$/i;
const ROLE_LEAD = /^(ed|eds|edited|hrsg|trans|transl|translated|tr|comp|by)\.?\s/i;
const NONPERSON = /\b(collection|monastery|society|library|bibliothek|university|universit[aä]t|press|verlag|museum|archive|archiv|institute|gesellschaft|akademie|academy|committee|church|kirche|council)\b/i;
const SENT_A = /^(unknown|anonym|anon\b|anonymous|unbekannt|none|various|n\/?a\b|\?|ignotus|incertus|sine)/i;
const isLatinScript = (s) => !/[^\p{Script=Latin}\p{P}\p{N}\p{Z}\p{S}\p{M}]/u.test(s);
// Fold for comparison (Latin script). Applied to BOTH sides alike, so a lossy fold only merges.
const foldLat = (s) => foldOrthography(foldAccents(String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')).replace(/ue/g, 'u').replace(/[ʻʼʾʿ‘’'`´]/g, ''))
  .replace(/ph/g, 'f').replace(/th/g, 't').replace(/sh/g, 's').replace(/ch/g, 'c').replace(/w/g, 'u').replace(/([a-z])\1/g, '$1');
const latTokens = (s) => foldLat(s).split(/[^a-z0-9]+/).filter(Boolean);
const stem = (t) => stripEnding(t, undefined, 4);
const nativeCore = (s) => String(s).normalize('NFKC').replace(/[\p{P}\p{Z}\p{N}\p{S}\s་།༄༅\u200e\u200f]/gu, '').replace(/(菩薩|撰|著|編|輯|註|注|疏|等|述|集)$/u, '');

/** Persons in a catalogue author string. Returns { persons: [{surname:[stems], given:[stems], native}], why }. */
export function parseCatalogueAuthor(raw) {
  const a = String(raw || '').trim();
  if (!a || SENT_A.test(a)) return { persons: [], why: 'no catalogue author' };
  const persons = []; let roleOnly = 0; let nonPerson = 0;
  for (let part of a.split(/\s*(?:;|\||\s\/\s|\s&\s|\band\b)\s*/i).filter(Boolean)) {
    part = part.trim();
    if (ROLE_LEAD.test(part)) continue; // "trans. Gerard of Cremona": a translator, not the author
    const parens = [...part.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
    let main = part.replace(/\([^)]*\)/g, ' ').replace(/[[\]]/g, ' ').trim();
    let mainRole = false;
    const alts = [];
    for (const p of parens) {
      if (ROLE.test(p) || /^(ed|eds|hrsg|trans|tr|transl)\.?$/i.test(p)) mainRole = true;
      else if (/^[\d\s?.,–-]+$/.test(p) || /^(c|ca|fl|d|b)\.?\s*\d/i.test(p)) continue; // dates
      else if (ROLE_LEAD.test(p) || /\b(translation|translator|attributed|attrib|transmitted|commentary)\b/i.test(p)) continue;
      else alts.push(p);
    }
    if (/,\s*(ed|eds|hrsg|trans|tr)\.?$/i.test(main)) { mainRole = true; main = main.replace(/,\s*\w+\.?$/, ''); }
    if (mainRole) { roleOnly++; continue; }
    for (const nm of [main, ...alts]) {
      if (!nm || SENT_A.test(nm)) continue;
      if (NONPERSON.test(nm)) { nonPerson++; continue; }
      if (!isLatinScript(nm)) {
        // Mixed records ("Aaron ben Joseph, ha-Rofe, -1320אהרון בן יוסף"): the native run is one form,
        // the Latin-script run (if any) another.
        const natRun = nm.replace(/[\p{Script=Latin}]/gu, ' ');
        if (NO_SPACES.test(natRun)) { const core = nativeCore(natRun); if (core.length >= 2) persons.push({ native: core, raw: nm }); }
        else { const nt = natTokens(natRun); if (nt.length) persons.push({ native_tokens: nt, raw: nm }); }
        const latPart = nm.replace(/[^\p{Script=Latin}\s,.'-]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (/\p{Script=Latin}{3}/u.test(latPart)) { const [sn, ...g] = latPart.split(','); const sur = latTokens(latPart.includes(',') ? sn : latPart).filter((x) => !PARTICLES.has(x)); const surname = (latPart.includes(',') ? sur : sur.slice(-1)).filter((x) => x.length >= 2); if (surname.length) persons.push({ surname: surname.map(stem), given: latTokens(latPart.includes(',') ? g.join(' ') : sur.slice(0, -1).join(' ')).filter((x) => x.length >= 3).map(stem), raw: latPart }); }
        continue;
      }
      let surname, given;
      if (nm.includes(',')) { const [s, ...g] = nm.split(','); surname = latTokens(s); given = latTokens(g.join(' ')); }
      else { const t = latTokens(nm).filter((x) => !PARTICLES.has(x)); surname = t.slice(-1); given = t.slice(0, -1); }
      surname = surname.filter((x) => !PARTICLES.has(x) && x.length >= 2);
      given = given.filter((x) => !PARTICLES.has(x) && x.length >= 3);
      if (!surname.length) continue;
      persons.push({ surname: surname.map(stem), given: given.map(stem), raw: nm });
    }
  }
  if (persons.length) return { persons, why: 'ok' };
  return { persons: [], why: roleOnly ? 'editor/translator only' : nonPerson ? 'institution, not a person' : 'no usable name' };
}

function lev1(a, b) { // edit distance <= 1
  if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return d + (a.length - i) + (b.length - j) <= 1;
}
const tokMatch = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 3) || (Math.min(a.length, b.length) >= 6 && lev1(a, b));
// Alphabetic non-Latin scripts (Cyrillic, Greek, Hebrew, Arabic, Devanagari …) compare by word;
// Han, Kana, Tibetan and Hangul have no reliable word breaks and compare by containment.
const COMMON_GIVEN = new Set(['iohannes', 'iohan', 'iohann', 'georg', 'georgi', 'heinric', 'friedric', 'cristof', 'cristoph', 'iacob', 'iacobus', 'micael', 'martin', 'petrus', 'peter', 'pierre', 'paulus', 'tomas', 'andreas', 'nicolaus', 'nicola', 'dauid', 'daniel', 'samuel', 'caspar', 'cristian', 'gotfried', 'uilhelm', 'ludouic', 'mattias', 'filip', 'filipp', 'iosef', 'iosep', 'franz', 'franciscus', 'anton', 'antonius', 'giouann', 'francesc', 'uilliam', 'iames', 'robert', 'ricard', 'carles', 'carl', 'henri', 'edu', 'edward', 'abraham', 'isac', 'iacques', 'louis', 'antoin', 'francois', 'marcus', 'albert', 'conrad', 'balt', 'baltasar', 'melcior', 'sebastian', 'sebastianus', 'bernard', 'ernst', 'gustau', 'leonard', 'lorenz', 'laurentius', 'matteus', 'simon', 'stefan', 'stefanus', 'tobias', 'ulric', 'uolfgang', 'adam', 'august', 'augustus', 'benedict', 'elias', 'emanuel', 'gabriel', 'iulius', 'maria', 'otto', 'rudolf', 'ioacim', 'ioacimus', 'erasmus', 'iustus', 'iodocus', 'ieremias', 'iosua', 'lucas', 'marcus', 'mose', 'moses', 'salomon', 'saul', 'tobias', 'ualentin', 'zacarias']);
const NO_SPACES = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\u0f00-\u0fff\uac00-\ud7af]/;
const NATIVE_PARTICLES = new Set(['בן', 'בר', 'אבן', 'ابن', 'بن', 'بنت', 'אבו', 'ابو', 'أبو', 'הרב', 'רבי']);
const natTokens = (s) => String(s).normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}]+/u).map((w) => w.replace(/^ال/, '').replace(/\p{M}/gu, '')).filter((w) => w.length >= 3 && !NATIVE_PARTICLES.has(w) && !/\p{Script=Latin}/u.test(w));
/** Does a model's named author match the catalogue? 'match' | 'mismatch' | 'none' (said unknown) | 'unjudgeable'. */
export function scoreAuthor(persons, ans) {
  const lat = String(ans?.author ?? '').trim(); const nat = String(ans?.author_native ?? '').trim();
  const said = (s) => s && !/^(unknown|none|n\/a|anonymous|anon|unbekannt|-|\?|unsure)$/i.test(s);
  if (!said(lat) && !said(nat)) return 'none';
  let judgeable = false;
  const mt = latTokens(lat).filter((x) => !PARTICLES.has(x)).map(stem);
  const mn = nativeCore(nat || (isLatinScript(lat) ? '' : lat));
  for (const p of persons) {
    if (p.native_tokens) {
      const mtok = natTokens(nat || (isLatinScript(lat) ? '' : lat));
      if (mtok.length) { judgeable = true; if (p.native_tokens.some((x) => mtok.some((y) => x === y || (Math.min(x.length, y.length) >= 4 && lev1(x, y))))) return 'match'; }
      continue;
    }
    if (p.native) {
      if (mn.length >= 2) { judgeable = true; if (mn.includes(p.native) || (p.native.length >= 2 && p.native.includes(mn) && mn.length >= Math.min(3, p.native.length))) return 'match'; }
      continue;
    }
    if (!mt.length) continue;
    judgeable = true;
    const short = p.surname.every((s) => s.length < 4);
    const sOk = p.surname.some((s) => mt.some((m) => (s.length >= 4 ? tokMatch(s, m) : s === m)));
    if (sOk && (!short || p.given.some((g) => mt.some((m) => tokMatch(g, m))))) return 'match';
    // A one-word answer that is the catalogue's distinctive non-surname token (Nizami for
    // "Nizami Ganjavi", Galileo for "Galileo Galilei"); never a common given name.
    if (mt.length === 1 && mt[0].length >= 5 && !COMMON_GIVEN.has(mt[0]) && p.given.some((g) => tokMatch(g, mt[0]))) return 'match';
  }
  return judgeable ? 'mismatch' : 'unjudgeable';
}

/** Mask the catalogue author's surname (any declension the matcher accepts) out of a title. */
export function maskTitle(title, persons) {
  let t = String(title || ''); let masked = 0;
  for (const p of persons) {
    if (p.native) { if (p.native.length >= 2 && t.includes(p.native)) { t = t.split(p.native).join('[…]'); masked++; } continue; }
    if (p.native_tokens) { t = t.replace(/[\p{L}\p{M}]+/gu, (w) => { const x = natTokens(w)[0]; if (x && p.native_tokens.some((y) => y === x || (Math.min(x.length, y.length) >= 4 && lev1(x, y)))) { masked++; return '[…]'; } return w; }); continue; }
    t = t.replace(/[\p{L}\p{M}ʻʼ'’]+/gu, (w) => {
      const st = latTokens(w).map(stem);
      if (st.length === 1 && p.surname.some((s) => (s.length >= 4 ? tokMatch(s, st[0]) : s === st[0]))) { masked++; return '[…]'; }
      return w;
    });
  }
  return { title: t, masked };
}

// ---------- identifiability (step 4) ----------
const GENERIC = new Set(['text', 'texts', 'manuscript', 'manuscripts', 'fragment', 'fragments', 'collection', 'collections', 'untitled', 'miscellany', 'miscellanea', 'miscellaneous', 'sammelband', 'notes', 'papers', 'letters', 'documents', 'document', 'recipes', 'prayers', 'prayer', 'book', 'books', 'volume', 'vol', 'handschrift', 'codex', 'kabbalistic', 'alchemical', 'chemical', 'medical', 'religious', 'hebrew', 'latin', 'arabic', 'persian', 'tibetan', 'sanskrit', 'various', 'assorted', 'of', 'and', 'the', 'a', 'in', 'on', 'with', 'und', 'de', 'et', 'leaf', 'leaves', 'folio', 'folios', 'pages', 'scroll', 'item', 'items', 'works', 'writings', 'part', 'paper']);
export function identifiability(b) {
  const t = String(b.title || ''); const f = fold(t);
  if (/kanjur|kangyur|tengyur|bka. ?.gyur|bstan ?.gyur|བཀའ་འགྱུར|བསྟན་འགྱུར|neyphug/i.test(t)) return { ident: false, cls: 'volume or collection label', rule: 'kanjur/tengyur volume' };
  // A Tibetan collection volume: "<collection> <volume letter>" (rNying ma rgyud 'bum Ha, mDo sde Gi).
  if (/(rgyud|'bum|mdo sde|sher phyin|dkon brtsegs|phal chen|'dul ba|gsung 'bum|sna tshogs)\b.*\s(ka|kha|ga|nga|ca|cha|ja|nya|ta|tha|da|na|pa|pha|ba|ma|tsa|tsha|dza|wa|zha|za|'a|ya|ra|la|sha|sa|ha|a|ki|khi|gi|ngi)$/i.test(t.trim())) return { ident: false, cls: 'volume or collection label', rule: 'tibetan collection volume letter' };
  if (/^[A-Z]{1,3}\s?\d+[a-z]?$/.test(t.trim())) return { ident: false, cls: 'shelfmark', rule: 'shelfmark-only title' };
  if (/^\s*(ms\.?|mss\.?|cod\.?|codex|cgm|clm|hs\.?|sig\.?|signatur|inv\.?|or\.?|add\.?|harley|sloane|ashmole|vat\. ?lat\.?)\s*[\d.]/i.test(t)) return { ident: false, cls: 'shelfmark', rule: 'leading shelfmark' };
  if (/^\s*([A-Z]{1,4}\s?)?\d{3,}\b/.test(t) && /sharada|sharda|manuscript|paper|upss|trust/i.test(t)) return { ident: false, cls: 'shelfmark', rule: 'accession-number manuscript record' };
  if (/\bmus\.\s?\d|\b[A-Z]{2,}[-.]\d{2,}[-.][A-Z0-9]/.test(t) && f.split(' ').length <= 4) return { ident: false, cls: 'shelfmark', rule: 'shelfmark-only title' };
  const han = /[\u3400-\u9fff\uf900-\ufaff]/.test(t);
  if (f.replace(/ /g, '').length < (han ? 3 : 6)) return { ident: false, cls: 'generic', rule: 'title too short to name a work' };
  const toks = f.split(' ').filter(Boolean);
  if (toks.every((w) => GENERIC.has(w) || /^\d+$/.test(w) || w.length <= 2)) return { ident: false, cls: 'generic', rule: 'only generic words' };
  return { ident: true, cls: 'identifiable', rule: '' };
}

// ---------- units, century, genre (step 6) ----------
export function genre(b) {
  const t = String(b.title || '');
  if (/disputat|dissertat|\btheses\b|thesium|\boratio\b|orationem|exercitati|positiones|conclusiones|assertiones|discursus|programma|panegyr|propemptic|epithalam|gratulator|inaugural|praeside|praes\.|respondente|resp\.|\bdisp\.|leichpredigt|leichenpredigt|funeral sermon/i.test(t)) return 'disputatio/oratio/dissertatio';
  if (/biblia|bible|\bpsalm|evangel|epistol|genes[ie]s|apocalyps|commentar|comment[oa]\b|expositio|explicatio|\bsutra|sūtra|sutta|\bmdo\b|kanjur|kangyur|tengyur|bka. ?.gyur|qur.?an|koran|alcoran|torah|talmud|mishna|\bveda|upani[sṣ]|gita|tafsir|shar[hḥ]|ṭīkā|\btika\b|bh[aā][sṣ]ya|pañjik|panjik|v[rṛ]tti|scholia|glossa|postill|homil|sermon|predigt|catech|liturg|missale|breviar|officium|註|注|疏|經|经/i.test(t)) return 'scripture/commentary';
  if (/manuscript|handschrift|\bms\.?\b|\bcodex\b|sharada|sharda|autograph|monastery collection/i.test(t + ' ' + (b.author || '')) || /manuscript/i.test(String(b.provider || ''))) return 'manuscript';
  return 'other';
}
export const century = (y) => { const n = Number(String(y ?? '').match(/-?\d{3,4}/)?.[0]); if (!Number.isFinite(n) || y == null) return 'unknown'; return n < 1400 ? 'before 1400' : n >= 1900 ? '1900+' : `${Math.floor(n / 100) + 1}th c.`; };

// ---------- Nālandā slice (step 4): works BY the 17 Nālandā masters that we hold, one edition each ----------
// From a catalogue scan (title + author, Latin/IAST, Devanagari, Tibetan and Chinese name forms) on
// 2026-10-06. Excluded: Derge Tengyur/Kanjur volume records (a volume is not a work); duplicate
// editions of one work (MMK ×5, Bodhicaryāvatāra ×3, Tattvasaṃgraha I/II); the alchemist Nāgārjuna
// (Rasaratnākara, Kakṣapuṭa); the Jain Haribhadra Sūri; a compilation of commentaries on Vasubandhu
// (大乘百法明門論註疏六種合刊). `ref` is the slice-defining author, used where the catalogue has none.
export const NALANDA = [
  ['6955831757e3b773024f76ae', 'Vasubandhu'], ['69e8b28a2ff2a8dc09e77ff4', 'Nāgārjuna'], ['69b99f4376b9bab2de21a891', 'Śāntideva'],
  ['6a3067c2c4fd77fb5b9f8044', 'Asaṅga'], ['6a3067c9c4fd77fb5b9f8143', 'Maitreyanātha; Asaṅga'], ['6a3067d0c4fd77fb5b9f8378', 'Candrakīrti'],
  ['6a3067dcc4fd77fb5b9f8627', 'Candrakīrti'], ['6a3067e0c4fd77fb5b9f87ea', 'Nāgārjuna'], ['6a3067e4c4fd77fb5b9f882d', 'Nāgārjuna'],
  ['6a306861c4fd77fb5b9f8885', 'Vasubandhu'], ['6a30778d0b77787bed79a607', 'Nāgārjuna'], ['6a308257675ed2bdbe36eddd', 'Śāntarakṣita'],
  ['6a308263675ed2bdbe36f2e5', 'Dharmakīrti'], ['6a308278558372a29b370f39', 'Āryadeva'], ['6a30881fbd425508b0edad49', 'Śāntideva'],
  ['6a30909cbec66f86487f2e8d', 'Dharmakīrti'], ['6a37d7e3d07939943b24cb9e', 'Buddhapālita'],
];
// Tibetan commentaries ON Nālandā works (not by the masters): reported as a second, labelled group.
export const NALANDA_COMMENTARIES = ['6a37c24763d3f620b49f6947', '6a37d9acd07939943b251938', '6a37da11d07939943b261286', '6a37da46d07939943b266292', '6a37da4bd07939943b26688a', '69dfee89ce6bb8619e07f958', '69dfee88ce6bb8619e07f8f5'];

// ---------- stage: prep ----------
function r1Answers(set, model) {
  const f = path.join(R1, `answers-${set}-${model}.jsonl`); const m = new Map(); const seen = new Set();
  for (const r of readJsonl(f).reverse()) { if (r.error || seen.has(r.packet)) continue; seen.add(r.packet); for (const a of r.answers) if (!a.missing) m.set(a.id, a); }
  return m;
}
const r1Recog = (a) => !!a && (a.knows_of === 'yes' || a.self_familiar === 'yes');
async function stagePrep() {
  const sample = readJsonl(path.join(R1, 'sample.jsonl'));
  const sub = sample.filter((s) => s.in_sub500);
  const ids = readJsonl(path.join(PRIVATE, 'ids.jsonl')).filter((b) => b.pages_count > 0);
  const byWork = new Map(); for (const b of ids) { const k = workKey(b); if (!byWork.has(k)) byWork.set(k, []); byWork.get(k).push(b); }
  const walk = new Map(readJsonl(path.join(R1, 'walk.jsonl')).map((w) => [w.k, w]));
  const annotate = (s, extra = {}) => {
    const pa = parseCatalogueAuthor(extra.ref_author || s.author);
    const mt = maskTitle(s.title, pa.persons);
    const eds = byWork.get(s.work_key) || [s];
    const w = walk.get(s.work_key);
    const cpp = w?.text_chars && w?.text_pages ? w.text_chars / w.text_pages : null;
    const pages = eds.reduce((t, b) => t + (b.pages_count || 0), 0);
    return { id: s.id, work_key: s.work_key, title: s.title, author: s.author, year: s.year, lang: s.lang, visible: s.visible, provider: s.provider,
      ...identifiability(s), author_scorable: pa.persons.length > 0, author_why: pa.why, persons: pa.persons,
      title_masked: mt.title, author_in_title: mt.masked > 0, volumes: s.n_editions || eds.length, pages, chars_per_page: cpp ? Math.round(cpp) : null,
      tokens_est: cpp ? Math.round((pages * cpp) / 4) : null, century: century(s.year), genre: genre(s), ...extra };
  };
  const works = sub.map((s) => annotate(s));
  writeJsonl(path.join(OUT, 'works.jsonl'), works);

  // Obscure-but-verifiably-known tier: run-1 works BOTH Pro and Haiku recognised, ≤ 2 editions,
  // a scorable author NOT printed in the title, identifiable; seeded 25, distinct authors.
  const pro = r1Answers('sub500', 'gemini-3.1-pro-preview'); const hai = r1Answers('sub500', 'claude-haiku');
  const rng = makeRng(SEED + 2);
  const pool = works.filter((w) => r1Recog(pro.get(w.id)) && r1Recog(hai.get(w.id)) && w.volumes <= 2 && w.author_scorable && !w.author_in_title && w.ident)
    .map((w) => ({ w, r: rng() })).sort((a, b) => a.r - b.r).map((o) => o.w);
  const obscure = []; const seenA = new Set();
  for (const w of pool) { const a = authorKey(w); if (a && seenA.has(a)) continue; seenA.add(a); obscure.push(w); if (obscure.length === 25) break; }
  // Controls for run 2: run 1's 24 canonical + 22 known + 40 decoys, plus the obscure tier.
  const c1 = readJsonl(path.join(R1, 'controls.jsonl'));
  const controls = [...c1.map((c) => annotate({ ...c, work_key: c.work_key || workKey(c) }, { control: c.control, label: c.label || null })),
    ...obscure.map((w) => ({ ...w, control: 'obscure' }))];
  writeJsonl(path.join(OUT, 'controls.jsonl'), controls);

  // Nālandā slice.
  const byId = new Map(ids.map((b) => [b.id, b]));
  const nal = [];
  for (const [id, ref] of NALANDA) { const b = byId.get(id); if (!b) { console.log('nalanda missing', id); continue; } nal.push(annotate({ ...b, lang: b.language, work_key: workKey(b), n_editions: (byWork.get(workKey(b)) || [b]).length }, { ref_author: b.author && !SENT_A.test(b.author) ? b.author : ref, nalanda: 'by a Nālandā master', nalanda_master: ref })); }
  for (const id of NALANDA_COMMENTARIES) { const b = byId.get(id); if (!b) continue; nal.push(annotate({ ...b, lang: b.language, work_key: workKey(b), n_editions: (byWork.get(workKey(b)) || [b]).length }, { nalanda: 'Tibetan commentary on a Nālandā work' })); }
  writeJsonl(path.join(OUT, 'nalanda.jsonl'), nal);

  // Single-request 100 (step 5) and the by-eye identifiability 40 (step 4), both seeded.
  const r3 = makeRng(SEED + 100); const single = works.map((w) => ({ id: w.id, r: r3() })).sort((a, b) => a.r - b.r).slice(0, 100).map((o) => o.id);
  fs.writeFileSync(path.join(OUT, 'single100-ids.json'), JSON.stringify(single, null, 1) + '\n');
  const r4 = makeRng(SEED + 40); const eye = works.map((w) => ({ w, r: r4() })).sort((a, b) => a.r - b.r).slice(0, 40).map((o) => o.w);
  // The eye file carries NO rule label: it is labelled blind, then compared.
  const eyeF = path.join(OUT, 'eye-identifiability.jsonl');
  if (!fs.existsSync(eyeF)) writeJsonl(eyeF, eye.map((w) => ({ id: w.id, title: w.title, author: w.author, lang: w.lang, eye_ident: null, eye_note: '' })));
  const c = (f) => works.filter(f).length;
  const summ = { works: works.length, identifiable: c((w) => w.ident), by_class: Object.fromEntries([...new Set(works.map((w) => w.cls))].map((k) => [k, c((w) => w.cls === k)])),
    author_scorable: c((w) => w.author_scorable), author_why: Object.fromEntries([...new Set(works.map((w) => w.author_why))].map((k) => [k, c((w) => w.author_why === k)])),
    identifiable_and_scorable: c((w) => w.ident && w.author_scorable), author_in_title_masked: c((w) => w.author_in_title),
    genre: Object.fromEntries([...new Set(works.map((w) => w.genre))].map((k) => [k, c((w) => w.genre === k)])),
    century: Object.fromEntries([...new Set(works.map((w) => w.century))].sort().map((k) => [k, c((w) => w.century === k)])),
    obscure_pool: pool.length, obscure_tier: obscure.length, controls: controls.length, nalanda: nal.length, nalanda_by_master: nal.filter((n) => n.nalanda_master).length };
  fs.writeFileSync(path.join(OUT, 'prep-summary.json'), JSON.stringify(summ, null, 1) + '\n');
  console.log(summ);
}

// ---------- prompts ----------
const PV_NEUTRAL = 'ai-exposure-r2-6038-neutral';
const PV_VERIFY = 'ai-exposure-r2-6038-verify';
// Run 1's prompt with ONE sentence removed ('Be honest: "no" and "unknown" are good answers.').
function neutralPrompt(items) {
  return `You are helping a library find out which of its historical books are already known to AI models. Answer each question from your own memory only. Never invent a quotation.

For each numbered book below, give:
- "knows_of": do you know OF this work — who wrote it and roughly what it is? "yes", "no" or "unsure".
- "self_familiar": did you encounter the TEXT of this work in your training data, not just references to it? Distinguish knowing OF a book from having seen its text. "yes", "no" or "unsure".
- "opening": one sentence from the opening of the work, verbatim, in its original language and script, exactly as you remember it — or the string "unknown" if you cannot quote it from memory. Do not translate, paraphrase or reconstruct.

Books:
${items.map((b, i) => bookLine(i + 1, b)).join('\n')}

Return ONLY a JSON array with one object per book, in order: [{"i":1,"knows_of":"...","self_familiar":"...","opening":"..."}, ...]`;
}
function verifyLine(i, b) {
  const parts = [`Title: ${String(b.title_masked ?? b.title).replace(/\s+/g, ' ').slice(0, 220)}`];
  if (b.year) parts.push(`Year of this edition: ${b.year}`);
  if (b.lang) parts.push(`Language: ${b.lang}`);
  return `${i}. ${parts.join(' | ')}`;
}
function verifyPrompt(items) {
  return `You are helping a library find out which of its historical works AI models know. Answer from your own memory only. Never invent a quotation.

Each numbered work below is given by its title, the year of the edition we hold and its language. The author's name is withheld; where the title printed it, it is replaced by […].

For each work give:
- "known": do you know this specific work? "yes", "no" or "unsure".
- "author": who wrote it, in Latin script (romanised if necessary), or "unknown".
- "author_native": the author's name in the work's own script if that is not the Latin script, else "".
- "author_is_guess": true if the author is your best guess rather than something you know, else false.
- "date": roughly when the work was written or first published, or "unknown".
- "about": one line on what the work is about, or "unknown".

Works:
${items.map((b, i) => verifyLine(i + 1, b)).join('\n')}

Return ONLY a JSON array with one object per work, in order: [{"i":1,"known":"...","author":"...","author_native":"...","author_is_guess":false,"date":"...","about":"..."}, ...]`;
}
function parseVerify(text, ids) {
  const m = String(text || '').match(/\[[\s\S]*\]/); if (!m) return null;
  let arr; try { arr = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const n3 = (v) => { const s = String(v ?? '').toLowerCase().trim(); return ['yes', 'no', 'unsure'].includes(s) ? s : 'invalid'; };
  return ids.map((id, k) => {
    const a = arr.find((x) => Number(x?.i) === k + 1) || arr[k];
    if (!a) return { id, missing: true };
    return { id, known: n3(a.known), author: String(a.author ?? '').slice(0, 200), author_native: String(a.author_native ?? '').slice(0, 200), author_is_guess: a.author_is_guess === true || a.author_is_guess === 'true', date: String(a.date ?? '').slice(0, 80), about: String(a.about ?? '').slice(0, 300) };
  });
}

// ---------- stage: packets ----------
function loadMeta() {
  const works = readJsonl(path.join(OUT, 'works.jsonl')); const controls = readJsonl(path.join(OUT, 'controls.jsonl')); const nal = readJsonl(path.join(OUT, 'nalanda.jsonl'));
  const r1s = new Map(readJsonl(path.join(R1, 'sample.jsonl')).map((s) => [s.id, s])); const r1c = new Map(readJsonl(path.join(R1, 'controls.jsonl')).map((c) => [c.id, c]));
  // For the neutral arm the line is run 1's (author shown); controls take run 1's fields.
  const meta = new Map();
  for (const w of [...works, ...nal]) meta.set(w.id, { ...w, ...(r1s.get(w.id) ? { author: r1s.get(w.id).author, lang: r1s.get(w.id).lang } : {}) });
  for (const c of controls) if (!meta.has(c.id) || c.control !== 'obscure') meta.set(c.id, { ...(meta.get(c.id) || {}), ...c, ...(r1c.get(c.id) ? { author: r1c.get(c.id).author } : {}) });
  return { works, controls, nal, meta };
}
function stagePackets() {
  const { arm, set } = args; const { works, controls, nal, meta } = loadMeta();
  const prompt = arm === 'neutral' ? neutralPrompt : verifyPrompt; const pv = arm === 'neutral' ? PV_NEUTRAL : PV_VERIFY;
  let groups;
  if (set === 'sub500' || (set === 'controls' && arm === 'neutral')) {
    // Run 1's exact groupings (same 25 real + 2 decoys + 1 canonical, same order).
    const dir = path.join(R1, `packets-${set}`);
    groups = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f))).ids);
  } else if (set === 'controls') {
    // Verify-arm controls: canonical + known + obscure + decoys, no two of one author in a packet.
    const rng = makeRng(SEED + 31);
    const all = controls.map((c) => ({ c, r: rng() })).sort((a, b) => a.r - b.r).map((o) => o.c);
    const nP = Math.ceil(all.length / 19); groups = Array.from({ length: nP }, () => []); const au = groups.map(() => new Set());
    let p = 0;
    for (const c of all) { const a = authorKey(c); let t = 0; while (t < nP && (groups[p].length >= 19 || (a && au[p].has(a)))) { p = (p + 1) % nP; t++; } if (t >= nP) { groups.push([]); au.push(new Set()); p = groups.length - 1; } groups[p].push(c.id); if (a) au[p].add(a); p = (p + 1) % groups.length; }
  } else if (set === 'nalanda') {
    const decoys = controls.filter((c) => c.control === 'decoy'); const pos = controls.filter((c) => c.control === 'positive');
    const byMaster = new Map(); for (const n of nal) { const k = n.nalanda_master ? fold(n.nalanda_master) : `c:${n.id}`; if (!byMaster.has(k)) byMaster.set(k, []); byMaster.get(k).push(n.id); }
    const nP = Math.max(...[...byMaster.values()].map((v) => v.length)); groups = Array.from({ length: nP }, () => []);
    let p = 0; for (const v of byMaster.values()) for (let i = 0; i < v.length; i++) groups[(p + i) % nP].push(v[i]), p = (p + 1) % nP;
    groups.forEach((g, k) => g.push(decoys[(2 * k + 7) % decoys.length].id, decoys[(2 * k + 8) % decoys.length].id, pos[(k + 5) % pos.length].id));
  } else if (set === 'single100') {
    groups = JSON.parse(fs.readFileSync(path.join(OUT, 'single100-ids.json'))).map((id) => [id]);
  } else throw new Error('--set');
  const dir = path.join(OUT, `packets-${arm}-${set}`); fs.mkdirSync(dir, { recursive: true });
  groups.forEach((ids, k) => {
    const items = ids.map((id) => { const m = meta.get(id); if (!m) throw new Error(`no meta ${id}`); return m; });
    fs.writeFileSync(path.join(dir, `packet-${String(k + 1).padStart(3, '0')}.json`), JSON.stringify({ packet: k + 1, prompt_version: pv, ids, prompt: prompt(items) }, null, 1) + '\n');
  });
  console.log(arm, set, groups.length, 'packets', groups.reduce((s, g) => s + g.length, 0), 'items');
}

// ---------- model calls ----------
const spentF = path.join(OUT, 'spend.jsonl');
const totalSpent = () => readJsonl(spentF).reduce((s, r) => s + (r.usd || 0), 0);
const answersFile = (arm, set, model, rep) => path.join(OUT, `answers-${arm}-${set}-${model.replace(/\//g, '_')}${rep && rep !== '1' ? `-rep${rep}` : ''}.jsonl`);
async function callOpenRouter(model, prompt, maxTokens = 16000) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, reasoning: { effort: args.effort || 'low' }, usage: { include: true }, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json(); if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error).slice(0, 200)}`);
  const ch = data.choices?.[0] || {}; const u = data.usage || {};
  return { text: ch.message?.content || '', inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0, thinkingTokens: u.completion_tokens_details?.reasoning_tokens || 0, usd: typeof u.cost === 'number' ? u.cost : null, finishReason: ch.finish_reason, provider: data.provider };
}
async function stageCall(kind) {
  const { arm, set, model } = args; const rep = String(args.rep || '1');
  const dir = path.join(OUT, `packets-${arm}-${set}`); const outF = answersFile(arm, set, model, rep);
  const parse = arm === 'neutral' ? parseAnswers : parseVerify;
  const done = new Set(readJsonl(outF).filter((r) => !r.error).map((r) => r.packet));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const todo = files.filter((f) => !done.has(JSON.parse(fs.readFileSync(path.join(dir, f))).packet)).slice(0, Number(args.limit || files.length));
  const conc = Number(args.conc || 4); let k = 0;
  let gem, costOf; if (kind === 'gemini') { ({ callGemini: gem } = await import('../lib/gemini-script-client.mjs')); ({ costOf } = await import('../lib/model-pricing.mjs')); }
  async function worker() {
    while (k < todo.length) {
      const f = todo[k++];
      if (totalSpent() > CAP_USD - 0.5) { console.error('cap reached'); return; }
      const pk = JSON.parse(fs.readFileSync(path.join(dir, f))); let row;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          let r;
          if (kind === 'gemini') {
            const isPro = /pro/.test(model);
            const g = await gem({ model, prompt: pk.prompt, endpoint: ENDPOINT, maxOutputTokens: isPro ? 16000 : 8000, temperature: 0, promptVersion: pk.prompt_version, ...(isPro ? { thinkingBudget: Number(args.think || 1024) } : {}) });
            r = { text: g.text, inputTokens: g.inputTokens, outputTokens: g.outputTokens, thinkingTokens: g.thinkingTokens, finishReason: g.finishReason, usd: costOf(model, g.inputTokens, g.outputTokens) };
          } else r = await callOpenRouter(model, pk.prompt);
          fs.appendFileSync(spentF, JSON.stringify({ at: new Date().toISOString(), arm, set, model, rep, packet: pk.packet, usd: r.usd || 0, route: kind }) + '\n');
          const ans = parse(r.text, pk.ids);
          row = { packet: pk.packet, model, rep, usd: r.usd, input_tokens: r.inputTokens, output_tokens: r.outputTokens, thinking_tokens: r.thinkingTokens, finish: r.finishReason, ...(ans ? { answers: ans } : { error: 'parse', raw: String(r.text).slice(0, 3000) }) };
          if (ans) break;
        } catch (e) { row = { packet: pk.packet, model, rep, error: String(e.message || e).slice(0, 300) }; await new Promise((res) => setTimeout(res, 4000 * (attempt + 1))); }
      }
      fs.appendFileSync(outF, JSON.stringify(row) + '\n');
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  const rows = readJsonl(outF);
  console.log(arm, set, model, 'rep', rep, 'ok', rows.filter((r) => !r.error).length, 'errors', rows.filter((r) => r.error).length, 'run-2 spend $', totalSpent().toFixed(3));
}
function stageIngest() {
  const { arm, set, model } = args; const dir = path.join(OUT, `packets-${arm}-${set}`); const odir = path.join(OUT, `packets-${arm}-${set}-out`, model);
  const parse = arm === 'neutral' ? parseAnswers : parseVerify; const rows = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const pk = JSON.parse(fs.readFileSync(path.join(dir, f))); const of = path.join(odir, f.replace('.json', '.out.json'));
    if (!fs.existsSync(of)) { rows.push({ packet: pk.packet, model, error: 'no output' }); continue; }
    const ans = parse(fs.readFileSync(of, 'utf8'), pk.ids);
    rows.push(ans ? { packet: pk.packet, model, answers: ans } : { packet: pk.packet, model, error: 'parse' });
  }
  writeJsonl(answersFile(arm, set, model), rows);
  console.log(arm, set, model, 'ok', rows.filter((r) => !r.error).length, 'errors', rows.filter((r) => r.error).length);
}

const stage = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ? args.stage : null;
if (stage === 'prep') await stagePrep();
else if (stage === 'packets') stagePackets();
else if (stage === 'gemini') await stageCall('gemini');
else if (stage === 'openrouter') await stageCall('openrouter');
else if (stage === 'ingest') stageIngest();
else if (stage === 'report') await (await import('./ai-exposure-r2-6038-report.mjs')).report({ OUT, R1, scoreAuthor, answersFile });
else if (stage) { console.error('--stage=prep|packets|gemini|openrouter|ingest|report'); process.exit(1); }
