#!/usr/bin/env node
/**
 * PRIOR ART: `books.faceted_tags.tradition` covers 143 of the 304 pool books
 * and has no label for Chinese, Tibetan, Indic or Islamic material beyond a
 * handful; `books.tradition` (#4773) is a proposal. scripts/lib/
 * wikidata-tradition-occupation.mjs labels AUTHORS from Wikidata occupations.
 * None gives one tradition per pool book.
 *
 * The pool is drawn by collection slug (build-pool.mjs), and shelves are loose:
 * the Summa Theologica sits on an Islamic-philosophy shelf, the Nyāya Sūtras on
 * a Buddhist one. This applies a by-eye correction, read from the title/author
 * list, and writes DIR/labels.json { book_id: tradition }. `other` is a book
 * that belongs to none of the eight (Frege, a Greek grammar); it never counts
 * as a tradition in the diversity metric.
 */
import fs from 'node:fs';
import path from 'node:path';
import { arg } from './lib.mjs';

const DIR = arg('--dir');
const RENAME = { kabbalah: 'jewish-kabbalistic', 'sufi-islamic': 'islamic-sufi', 'daoist-confucian': 'chinese-daoist-confucian', buddhist: 'buddhist', hindu: 'hindu-indic', 'christian-mystical': 'christian', 'hermetic-alchemical': 'hermetic-esoteric', 'greek-philosophy': 'greek-roman' };
// [shelf label from build-pool, title substring, corrected tradition]
const OVERRIDES = [
  ['sufi-islamic', 'Great Compassion Mantra', 'buddhist'], ['sufi-islamic', 'Compendium of the Five Lamps', 'buddhist'],
  ['sufi-islamic', 'Alchemical and Astrological Texts', 'hermetic-esoteric'], ['sufi-islamic', 'Compendium of Shiva', 'hindu-indic'],
  ['sufi-islamic', 'De idolatria', 'jewish-kabbalistic'], ['sufi-islamic', 'Kitāb al-lamḥa', 'jewish-kabbalistic'],
  ['sufi-islamic', 'commentaries on the Torah', 'jewish-kabbalistic'], ['sufi-islamic', 'Liber Razielis', 'jewish-kabbalistic'],
  ['sufi-islamic', 'Nicomachean Ethics', 'greek-roman'], ['sufi-islamic', 'Summa Theologica', 'christian'],
  ['sufi-islamic', 'Aquinas Ethicus', 'christian'], ['sufi-islamic', 'Meister Eckhart', 'christian'], ['sufi-islamic', 'History of the Dynasties', 'christian'],
  ['kabbalah', 'Three Books of Occult Philosophy', 'hermetic-esoteric'], ['kabbalah', 'Theosophical Questions', 'christian'],
  ['kabbalah', 'Mysterium Magnum', 'christian'], ['kabbalah', 'Hyleal Chaos', 'hermetic-esoteric'], ['kabbalah', 'Amphitheatre of Eternal Wisdom', 'hermetic-esoteric'],
  ['kabbalah', 'Secret Fire of the Magi', 'hermetic-esoteric'], ['kabbalah', 'Blessing of All Nations', 'christian'], ['kabbalah', 'Telescope of Zoroaster', 'hermetic-esoteric'],
  ['kabbalah', 'Alchemical Anthology', 'hermetic-esoteric'], ['kabbalah', 'Transcendental Magic', 'hermetic-esoteric'], ['kabbalah', 'Theatrum Chemicum', 'hermetic-esoteric'],
  ['kabbalah', 'The Magus', 'hermetic-esoteric'], ['kabbalah', 'Theosophical Glossary', 'hermetic-esoteric'], ['kabbalah', 'Cosmic Meteorology', 'hermetic-esoteric'],
  ['kabbalah', 'Composite manuscript, two parts', 'hermetic-esoteric'], ['kabbalah', 'praecellentia foem', 'hermetic-esoteric'], ['kabbalah', 'Ideal Shadow of Universal Wisdom', 'hermetic-esoteric'],
  ['kabbalah', 'Teachings of the Talmud', 'christian'], ['kabbalah', 'Conjectures on Fishing', 'other'],
  ['buddhist', 'Nyaya Sutras', 'hindu-indic'], ['buddhist', 'Samkhya Philosophy', 'hindu-indic'], ['buddhist', 'Yoga-Darsana', 'hindu-indic'],
  ['buddhist', 'History of Indian Philosophy', 'hindu-indic'], ['buddhist', "Householder's Dharma", 'hindu-indic'],
  ['hindu', 'Bhilsa Topes', 'buddhist'], ['hindu', 'Initiation and Its Results', 'hermetic-esoteric'], ['hindu', 'Phyag chen rgya gzhung', 'buddhist'],
  ['hindu', 'Pahlavi Texts', 'zoroastrian'], ['hindu', 'Religious Ceremonies', 'other'],
  ['hermetic-alchemical', 'Cantong qi', 'chinese-daoist-confucian'], ['hermetic-alchemical', 'Signatura rerum', 'christian'], ['hermetic-alchemical', 'History of Jacob Boehme', 'christian'],
  ['hermetic-alchemical', 'Revelations Concerning the Last Times', 'christian'], ['hermetic-alchemical', 'Married and Unmarried Life', 'christian'], ['hermetic-alchemical', 'History of the Heavens', 'other'],
  ['hermetic-alchemical', 'Theuerdanck', 'other'],
  ['greek-philosophy', 'System of the World', 'other'], ['greek-philosophy', 'Greek Grammar', 'other'], ['greek-philosophy', 'Law and Morality', 'other'],
  ['greek-philosophy', 'Moral and Political Works', 'other'], ['greek-philosophy', 'Latin Works of Giordano Bruno', 'hermetic-esoteric'], ['greek-philosophy', 'Ikhwan al-Safa', 'islamic-sufi'],
  ['greek-philosophy', 'City of God', 'christian'], ['greek-philosophy', 'Theses on Universal Philosophy', 'other'], ['greek-philosophy', 'Dictionary of Proper Names', 'other'],
  ['greek-philosophy', 'Institutionum logicarum', 'other'], ['greek-philosophy', 'Perspective (Perspectiva)', 'other'], ['greek-philosophy', 'Foundations of Arithmetic', 'other'],
  ['greek-philosophy', 'Transition from Hellenism to Christianity', 'christian'], ['greek-philosophy', 'Complete Works of Euclid', 'other'], ['greek-philosophy', 'Minor Greek Geographers', 'other'],
  ['christian-mystical', 'Lessons in Truth', 'hermetic-esoteric'],
];
const books = JSON.parse(fs.readFileSync(path.join(DIR, 'books.json'), 'utf8'));
const labels = {}; const used = new Set();
for (const b of books) {
  const o = OVERRIDES.find(([shelf, sub]) => shelf === b.tradition && (b.title || '').includes(sub));
  if (o) used.add(o);
  labels[b.book_id] = o ? o[2] : RENAME[b.tradition];
}
const unused = OVERRIDES.filter((o) => !used.has(o));
if (unused.length) console.log('UNMATCHED overrides:', unused.map((o) => o[1]).join(' | '));
const tally = {}; for (const t of Object.values(labels)) tally[t] = (tally[t] || 0) + 1;
console.log(`${used.size} corrected of ${books.length}`, tally);
fs.writeFileSync(path.join(DIR, 'labels.json'), JSON.stringify(labels, null, 1));
