#!/usr/bin/env node
/**
 * Build a curated NON-LATIN translation-catalog seed for Tier-0 (issue #2899).
 *
 * WHY CURATED, not scraped: the Tier-0 matcher
 * (scripts/eval/ft-catalog-match.mjs) is author-surname + title-token anchored.
 * The big open non-Latin catalogs do NOT survive that join (documented in
 * .claude/docs/ft-tier0-nonlatin-catalog.md):
 *   - 84000 (Tibetan): CC0 RDF carries ONLY translator creators (role
 *     R0ER0017) — no ancient-author field at all — so every row is anonymous
 *     and the surname index drops it; its titles are Tibetan-script / Sanskrit
 *     IAST, which don't token-match our Wylie/English book titles.
 *   - Sefaria (Hebrew): the canonical Kabbalah works are pseudepigraphic
 *     (`authors: []` — Zohar, Bahir, Sefer Yetzirah), so they're anonymous to
 *     the matcher; and few have a COMPLETE published English (so they should
 *     NOT carry completeness:'complete' anyway).
 *   - work_id can't bridge either: our books carry internal `local:slug` ids,
 *     not Wikidata/BDRC ids the external catalogs key on.
 *
 * WHAT DOES join: famous NAMED-author works whose author appears in Latin
 * script in BOTH the external catalog and our corpus — Sanskrit (Manu, Vyasa,
 * Patanjali, Shankara, Vasubandhu, Nagarjuna) and Chinese (Laozi, Zhuangzi,
 * Confucius). For these there are well-known COMPLETE English translations
 * (mostly Sacred Books of the East / Legge's Chinese Classics, plus a few
 * standard scholarly editions). Those are exactly the priors that should defeat
 * an over-claimed "first complete English translation" badge.
 *
 * Each row cites a SPECIFIC real complete translation as its evidence. Rows are
 * deliberately conservative: completeness:'complete' only where a genuinely
 * complete English of the whole work exists. `canonical_work` packs the
 * romanization variants that appear in our book titles so the title-token guard
 * (≥60% book-token coverage) can fire.
 *
 * Output: JSONL on stdout (or to --out <file>), consumed by
 * scripts/enrichment/ingest-translation-catalog-records.mjs.
 *
 * Usage:
 *   node scripts/import/build-nonlatin-catalog-seed.mjs --out scripts/data/nonlatin-translation-catalog-seed.jsonl
 */
import fs from 'fs';

// ── Sanskrit (sa) ────────────────────────────────────────────────────────────
const SANSKRIT = [
  {
    author: 'Manu', canonical_work: 'Manu Smriti Manusmriti Manava Dharma Shastra Laws of Manu',
    english_title: 'The Laws of Manu',
    translator: 'Georg Bühler', pub_year: 1886, publisher: 'Clarendon Press (Sacred Books of the East, Vol. 25)',
    source: 'sacred_books_east', source_url: 'https://archive.org/details/lawsofmanu25mluoft',
  },
  {
    author: 'Vyasa', canonical_work: 'Bhagavad Gita Bhagavadgita Srimad Bhagavad Gita',
    english_title: 'The Bhagavadgîtâ, with the Sanatsujâtîya and the Anugîtâ',
    translator: 'Kâshinâth Trimbak Telang', pub_year: 1882, publisher: 'Clarendon Press (Sacred Books of the East, Vol. 8)',
    source: 'sacred_books_east', source_url: 'https://archive.org/details/bhagavadgtwith08telauoft',
  },
  {
    author: 'Patanjali', canonical_work: 'Yoga Sutra Yogasutra Yoga Sutras of Patanjali',
    english_title: 'The Yoga-System of Patañjali',
    translator: 'James Haughton Woods', pub_year: 1914, publisher: 'Harvard University Press (Harvard Oriental Series, Vol. 17)',
    source: 'scholarly_pd', source_url: 'https://archive.org/details/yogasystemofpata00pata',
  },
  {
    author: 'Shankaracharya', canonical_work: 'Brahma Sutra Bhashya Vedanta Sutras Brahmasutra',
    english_title: "The Vedânta-Sûtras with the Commentary by Śaṅkarâkârya",
    translator: 'George Thibaut', pub_year: 1890, publisher: 'Clarendon Press (Sacred Books of the East, Vols. 34 & 38)',
    source: 'sacred_books_east', source_url: 'https://archive.org/details/vedantasutraswit34bada',
  },
  {
    author: 'Vasubandhu', canonical_work: 'Abhidharmakosa Bhashya Abhidharmakosabhasyam',
    english_title: 'Abhidharmakośabhāṣyam (4 vols)',
    translator: 'Leo M. Pruden (from Louis de La Vallée Poussin)', pub_year: 1988, publisher: 'Asian Humanities Press',
    source: 'scholarly_complete', source_url: 'https://www.worldcat.org/title/abhidharmakosabhasyam/oclc/18051289',
  },
  {
    author: 'Nagarjuna', canonical_work: 'Mulamadhyamakakarika',
    english_title: 'Nāgārjuna: A Translation of his Mūlamadhyamakakārikā',
    translator: 'Kenneth K. Inada', pub_year: 1970, publisher: 'Hokuseido Press',
    source: 'scholarly_complete', source_url: 'https://www.worldcat.org/title/nagarjuna/oclc/137109',
  },
];

// ── Chinese (zh) ─────────────────────────────────────────────────────────────
const CHINESE = [
  {
    author: 'Laozi', canonical_work: 'Tao Te Ching Dao De Jing Daodejing Tao Teh King',
    english_title: 'The Tâo Teh King (Texts of Taoism, Part I)',
    translator: 'James Legge', pub_year: 1891, publisher: 'Clarendon Press (Sacred Books of the East, Vol. 39)',
    source: 'sacred_books_east', source_url: 'https://archive.org/details/sacredbooksofch01legg',
  },
  {
    author: 'Zhuangzi', canonical_work: 'Zhuangzi Chuang Tzu Kwang Tze Nanhua Jing',
    english_title: 'The Writings of Kwang-ʒze (Texts of Taoism, Parts I–II)',
    translator: 'James Legge', pub_year: 1891, publisher: 'Clarendon Press (Sacred Books of the East, Vols. 39 & 40)',
    source: 'sacred_books_east', source_url: 'https://archive.org/details/sacredbooksofch01legg',
  },
  {
    author: 'Confucius', canonical_work: 'Analects Confucian Analects Lunyu Chinese Classics',
    english_title: 'Confucian Analects (The Chinese Classics, Vol. I)',
    translator: 'James Legge', pub_year: 1861, publisher: 'Trübner & Co.',
    source: 'legge_chinese_classics', source_url: 'https://archive.org/details/chineseclassics01legggoog',
  },
];

function rows() {
  const out = [];
  for (const r of SANSKRIT) out.push({ ...r, source_language: 'sa', completeness: 'complete' });
  for (const r of CHINESE) out.push({ ...r, source_language: 'zh', completeness: 'complete' });
  return out;
}

function main() {
  const all = rows();
  const jsonl = all.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], jsonl);
    console.error(`Wrote ${all.length} records → ${process.argv[outIdx + 1]}`);
  } else {
    process.stdout.write(jsonl);
  }
}

main();
