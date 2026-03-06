import { readFileSync, writeFileSync } from 'fs';

const lines = readFileSync('src/data/shwep-crawled.jsonl', 'utf8').trim().split('\n');
const epMap = new Map();

for (const line of lines) {
  try {
    const ep = JSON.parse(line);
    if (ep.n === undefined || !ep.citedWorks) continue;
    const existing = epMap.get(ep.n) || new Set();
    for (const w of ep.citedWorks) existing.add(w);
    epMap.set(ep.n, existing);
  } catch {}
}

const NOISE_WORDS = new Set([
  'should', 'were', 'born', 'himself', 'just', 'every', 'highly',
  'lower', 'simple', 'under', 'words', 'Idem', 'Trans-', 'Repres-',
  'entations', 'Strom', 'Corrigendum', 'Apud', 'apud',
  'dedicated to', 'discursus', 'kosmos', 'Kosmos', 'pistis', 'Pistis',
  'prima materia', 'symbola', 'Symbola', 'dedicated', 'Anonymous',
  'Compendium', 'Fragments', 'Letters', 'Histories', 'Interpretation',
  'Second Century', 'Visions', 'Religion', 'Culture', 'Review', 'Response',
  'ANRW', 'magos', 'goês', 'mantis', 'aoidos', 'barbaroi',
  'voces magicæ', 'psychagogos', 'agourtês', 'engastrimythos',
  'Ethnos', 'Dionysius', 'Psuchê',
  'Commentary', 'Historia', 'Antiquities', 'Genesis', 'Theology',
  'testimonia', 'theologos', 'Palingenesia', 'passim',
  'et passim', 'et sæp',
]);

const JOURNAL_PREFIXES = [
  'Journal', 'Proceedings', 'Transactions', 'Bulletin', 'American',
  'Harvard', 'Zeitschrift', 'Revue', 'Southwestern', 'Classical',
  'Annual', 'Numen', 'Studies in', 'Current Anthropology',
  'History of Religions', 'Studia Philonica', 'Hebrew Union',
  'Index Philonicus', 'Vigiliae', 'Latomus',
];

const MODERN_SCHOLAR_PATTERNS = [
  /: A (Reader|Guide|Sourcebook|History|Study|Survey|Companion|Brief|Concise|Critical|Introduction)/i,
  /: (Rejected Knowledge|Secret Knowledge|An (Introduction|Exegete|Inquiry|Annotated))/i,
  /^(Making|Defining|Understanding|Introducing|Reading|Rethinking|Interpreting|Explaining)/,
  / (Reader|Sourcebook|Companion|Guide|Handbook|Bibliography)$/,
  / in (the )?(History|Study) of /i,
  /^(Self:|Reasons and|Black Athena|Making Magic|For Lust|Persecution and)/,
  /(Afterlife|Reincarnation in|Etymology in|La tradition de|Writes Back)/i,
  /Jewish Views/i,
  /philosophorum graecorum/i,
  /Languages of Unsaying/i,
  /opera quæ supersunt/i,
  /Philosophic Silence/i,
  /Esotericism and the Academy/i,
  /Hermetic Tradition$/i,
  /Western Esotericism/i,
  /Dictionary of Gnosis/i,
  /Hidden Intercourse/i,
  /Three Perspectives on/i,
  /Secret Knowledge/i,
  /Secrets of Heaven/i,
  /Lore and Science in/i,
  /: Orientalists and/i,
  /Writes Back/i,
  /Ancient Egyptian Science/i,
  /Early Greek Philosophy and/i,
  /Universe and Inner Self/i,
  /Ancient Philosophy, Mystery/i,
  /Ancient Science/i,
  /^Also sprach/i,
];

function cleanWork(w) {
  return w.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/[.,;:]+$/, '').trim();
}

function isNoise(w) {
  // Must be at least 6 chars
  if (w.length < 6) return true;
  // Latin abbreviation patterns (e.g. "Opif.", "Post.", "L.A. i. ii.")
  if (/^[A-Z][a-z]{0,5}\.$/.test(w)) return true;
  if (/^[A-Z]\.[A-Z]\.?$/.test(w)) return true;
  if (/^De [A-Z][a-z]{0,5}$/.test(w)) return true;
  // Contains " = " (abbreviation key)
  if (w.includes(' = ')) return true;
  // Contains "i. ii." (volume refs)
  if (/\bi{1,3}\./.test(w)) return true;
  // All lowercase + short = common English word
  if (/^[a-z]/.test(w) && w.length < 12) return true;
  if (NOISE_WORDS.has(w)) return true;
  if (w.includes('&#')) return true;
  for (const p of JOURNAL_PREFIXES) {
    if (w.startsWith(p + ' ') || w === p) return true;
  }
  for (const pat of MODERN_SCHOLAR_PATTERNS) {
    if (pat.test(w)) return true;
  }
  return false;
}

// Build output
const entries = [];
const allWorks = new Set();

for (const [n, works] of [...epMap.entries()].sort((a, b) => a[0] - b[0])) {
  const cleaned = [...works]
    .map(cleanWork)
    .filter(w => !isNoise(w))
    .sort();
  if (cleaned.length > 0) {
    for (const w of cleaned) allWorks.add(w);
    const worksStr = cleaned.map(w => `'${w.replace(/'/g, "\\'")}'`).join(', ');
    entries.push(`  ${n}: [${worksStr}],`);
  }
}

const output = `/**
 * Cited works per SHWEP episode, extracted from shwep.net bibliographies.
 * Used for direct matching against the book collection — replaces manual tags.
 * Generated from src/data/shwep-crawled.jsonl
 */
export const EPISODE_CITED_WORKS: Record<number, string[]> = {
${entries.join('\n')}
};

/** Get all unique cited works across all episodes */
export function getAllCitedWorks(): string[] {
  const works = new Set<string>();
  for (const ws of Object.values(EPISODE_CITED_WORKS)) {
    for (const w of ws) works.add(w);
  }
  return Array.from(works).sort();
}
`;

writeFileSync('src/data/shwep-cited-works.ts', output);
console.log('Generated cited works module:');
console.log('  Episodes with cited works:', entries.length);
console.log('  Total unique works:', allWorks.size);
