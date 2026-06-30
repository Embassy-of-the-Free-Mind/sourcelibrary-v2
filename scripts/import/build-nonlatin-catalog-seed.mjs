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
  // ── Epics & classical treatises with genuinely COMPLETE public-domain English ──
  {
    author: 'Vyasa', canonical_work: 'Mahabharata Maha Bharata',
    english_title: 'The Mahabharata of Krishna-Dwaipayana Vyasa (complete, 12 vols)',
    translator: 'Kisari Mohan Ganguli', pub_year: 1896, publisher: 'Bharata Press',
    source: 'scholarly_pd', source_url: 'https://archive.org/details/mahabharata01ramauoft',
  },
  {
    author: 'Valmiki', canonical_work: 'Ramayana Ramayan',
    english_title: 'The Rámáyan of Válmíki (complete, 5 vols)',
    translator: 'Ralph T. H. Griffith', pub_year: 1874, publisher: 'Trübner & Co.',
    source: 'scholarly_pd', source_url: 'https://archive.org/details/rmyanofvlmki01valm',
  },
  {
    author: 'Kautilya', canonical_work: 'Arthashastra Arthasastra Kautilya',
    english_title: "Kautilya's Arthaśāstra",
    translator: 'R. Shamasastry', pub_year: 1915, publisher: 'Government Press, Bangalore',
    source: 'scholarly_pd', source_url: 'https://archive.org/details/arthasastra00kautuoft',
  },
  {
    author: 'Vatsyayana', canonical_work: 'Kama Sutra Kamasutra',
    english_title: 'The Kama Sutra of Vatsyayana',
    translator: 'Richard Burton & F. F. Arbuthnot', pub_year: 1883, publisher: 'Kama Shastra Society',
    source: 'scholarly_pd', source_url: 'https://archive.org/details/kamasutraofvatsy00vatsyaya',
  },
];

// ── Pali (pli) ───────────────────────────────────────────────────────────────
const PALI = [
  {
    author: 'Nagasena', canonical_work: 'Milinda Panha Questions of King Milinda',
    english_title: 'The Questions of King Milinda (complete, 2 vols, SBE 35–36)',
    translator: 'T. W. Rhys Davids', pub_year: 1890, publisher: 'Clarendon Press (Sacred Books of the East, Vols. 35 & 36)',
    source: 'sacred_books_east', source_url: 'https://archive.org/details/questionsofkingm01davi',
  },
];

// ── Tamil (ta) ───────────────────────────────────────────────────────────────
const TAMIL = [
  {
    author: 'Tiruvalluvar', canonical_work: 'Tirukkural Kural Thirukkural Tiruvalluvar',
    english_title: 'The Sacred Kurral of Tiruvalluva-Nayanar',
    translator: 'G. U. Pope', pub_year: 1886, publisher: 'W. H. Allen & Co.',
    source: 'scholarly_pd', source_url: 'https://archive.org/details/sacredkurraloft00popeuoft',
  },
];

// NOTE: deliberately NO Hebrew seed rows. Our Hebrew corpus is obscure Kabbalah
// (commentaries, manuscript miscellanies, misattributions) where prior complete
// English is genuinely scarce — verified case-by-case in #2899's ft-verify round,
// not by catalog rows. And the one famous candidate, Maimonides' Guide for the
// Perplexed, was written in Judeo-Arabic (source-language ambiguity), so it does
// not belong in a Hebrew-tagged seed. Hebrew over-claims go through ft-verify.

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
  {
    author: 'Mencius', canonical_work: 'Mencius Mengzi Meng Tzu Chinese Classics',
    english_title: 'The Works of Mencius (The Chinese Classics, Vol. II)',
    translator: 'James Legge', pub_year: 1861, publisher: 'Trübner & Co.',
    source: 'legge_chinese_classics', source_url: 'https://archive.org/details/chineseclassics00legggoog',
  },
  {
    author: 'Sunzi', canonical_work: 'Art of War Sunzi Sun Tzu Bingfa',
    english_title: 'Sun Tzu on the Art of War',
    translator: 'Lionel Giles', pub_year: 1910, publisher: 'Luzac & Co.',
    source: 'scholarly_pd', source_url: 'https://archive.org/details/suntzuonartofwar00suntuoft',
  },
  {
    author: 'Confucius', canonical_work: 'I Ching Yi Jing Book of Changes Yijing Zhouyi',
    english_title: 'The Yî King (Book of Changes, SBE Vol. 16)',
    translator: 'James Legge', pub_year: 1882, publisher: 'Clarendon Press (Sacred Books of the East, Vol. 16)',
    source: 'sacred_books_east', source_url: 'https://archive.org/details/sacredbooksofch16conf',
  },
];

function rows() {
  const out = [];
  for (const r of SANSKRIT) out.push({ ...r, source_language: 'sa', completeness: 'complete' });
  for (const r of CHINESE) out.push({ ...r, source_language: 'zh', completeness: 'complete' });
  for (const r of PALI) out.push({ ...r, source_language: 'pli', completeness: 'complete' });
  for (const r of TAMIL) out.push({ ...r, source_language: 'ta', completeness: 'complete' });
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
