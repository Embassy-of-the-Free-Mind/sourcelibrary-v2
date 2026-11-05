#!/usr/bin/env node
// PRIOR ART: scripts/eval/continuation-probe-7271/draw.mjs P group (five famous passages from Gutenberg and The Latin
// Library as positive controls); this fetches two per script, for the five scripts of #7570.
/**
 * controls.mjs — the positive controls for #7570: two famous passages per script, named by work and locus, asked for
 * with NO image (prompts.mjs P). A model that knows a text writes it out, so the no-image arm can register memory in
 * that script only if the model passes this gate (score.mjs). Fetches the reference texts from public e-texts and
 * seals scripts/eval/results/read-or-recall-7570/controls.json. No model call.
 *
 *   node scripts/eval/read-or-recall-7570/controls.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../results/read-or-recall-7570/controls.json');
const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`${u} HTTP ${r.status}`); return r.text(); };
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
const between = (t, a, b) => { const i = t.indexOf(a); if (i < 0) throw new Error(`not found: ${a}`); const j = b ? t.indexOf(b, i + a.length) : -1; return t.slice(i, j > 0 ? j : undefined); };

const items = [];
const add = (slug, script, lang_name, ask, url, text) => items.push({ slug, script, lang_name, ask, source_url: url, ref: text.replace(/\s+/g, ' ').trim() });

{ const u = 'https://www.thelatinlibrary.com/caesar/gall1.shtml'; const t = strip(await get(u));
  add('P-latin-caesar-bg-1-1', 'latin', 'Latin', 'the first chapter (1.1) of Caesar, De bello Gallico, book 1', u, between(t, 'Gallia est omnis divisa', 'Apud Helvetios').replace(/\[\s*\d+\s*\]|\b\d+\b/g, ' ')); }
{ const u = 'https://www.thelatinlibrary.com/bible/genesis.shtml'; const t = strip(await get(u));
  add('P-latin-vulgate-gen-1-1-8', 'latin', 'Latin', 'Genesis 1:1-8 in the Vulgate', u, between(t, 'In principio creavit Deus', 'dies secundus').concat(' dies secundus').replace(/\[\d+\]|\d+:\d+/g, '')); }
{ const u = 'https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data/tlg0012/tlg001/tlg0012.tlg001.perseus-grc2.xml'; const x = await get(u);
  const lines = [...x.matchAll(/<l n="(\d+)"[^>]*>([\s\S]*?)<\/l>/g)].slice(0, 21).map((m) => m[2].replace(/<[^>]+>/g, ''));
  add('P-greek-iliad-1-1-21', 'greek', 'Ancient Greek', 'lines 1-21 of book 1 of the Iliad', u, lines.join(' ')); }
{ const u = 'https://raw.githubusercontent.com/LogosBible/SBLGNT/master/data/sblgnt/text/John.txt'; const x = await get(u);
  const vs = x.split('\n').filter((l) => /^John 1:([1-9]|1[0-4])\t/.test(l)).map((l) => l.split('\t')[1]);
  add('P-greek-john-1-1-14', 'greek', 'Greek of the New Testament', 'John 1:1-14', u, vs.join(' ')); }
{ const u = 'https://raw.githubusercontent.com/kanripo/KR1h0004/master/KR1h0004_001.txt'; const x = await get(u);
  const body = x.split('\n').filter((l) => !/^[#*]/.test(l)).join('').replace(/<[^>]+>/g, '').replace(/¶/g, '');
  add('P-chinese-analects-1-1-4', 'chinese', 'classical Chinese', 'Analects (論語) 1.1-1.4, 學而篇', u, between(body.replace(/\d+\.\d+/g, ''), '子曰', '子曰：「道千乘之國').slice(0, 400)); }
{ const u = 'https://raw.githubusercontent.com/kanripo/KR1h0001/master/KR1h0001_001.txt'; const x = await get(u);
  const body = x.split('\n').filter((l) => !/^[#*]/.test(l)).join('').replace(/<[^>]+>/g, '').replace(/¶/g, '').replace(/\d+\.\d+/g, '');
  add('P-chinese-mencius-1a1', 'chinese', 'classical Chinese', 'Mencius (孟子) 1A.1, the opening of 梁惠王上', u, between(body, '孟子見梁惠王', '孟子見梁惠王。王立於沼上')); }
for (const [slug, ask, ref] of [['P-hebrew-gen-1-1-8', 'Genesis 1:1-8 in Hebrew (consonants only, no vowel points)', 'Genesis.1.1-8'], ['P-hebrew-psalm-23', 'Psalm 23 in Hebrew (consonants only, no vowel points)', 'Psalms.23']]) {
  const u = `https://www.sefaria.org/api/v3/texts/${ref}?version=hebrew`; const j = JSON.parse(await get(u));
  const v = j.versions?.[0]?.text; const flat = (Array.isArray(v) ? v.flat(3) : [v]).join(' ').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\{[^}]*\}/g, ' ');
  add(slug, 'hebrew', 'Hebrew', ask, u, flat);
}
{ const u = 'https://sanskritdocuments.org/doc_giitaa/bhagvadnew.html'; const t = strip(await get(u)).replace(/॥\s*[०-९\d.\-]+\s*॥/g, '॥');
  add('P-sanskrit-gita-1-1-8', 'sanskrit', 'Sanskrit (Devanagari)', 'Bhagavad Gita 1.1-1.8', u, between(t, 'धृतराष्ट्र उवाच', 'अन्ये च बहवः शूरा'));
  add('P-sanskrit-gita-2-19-25', 'sanskrit', 'Sanskrit (Devanagari)', 'Bhagavad Gita 2.19-2.25', u, between(t, 'य एनं वेत्ति हन्तारं', 'अथ चैनं नित्यजातं')); }

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ issue: 7570, fetched_at: new Date().toISOString(), items }, null, 1));
for (const i of items) console.log(i.slug, i.ref.length, i.ref.slice(0, 80), '…', i.ref.slice(-40));
