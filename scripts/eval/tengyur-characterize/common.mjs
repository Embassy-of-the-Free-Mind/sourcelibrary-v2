// PRIOR ART: none — searched scripts/eval/tengyur-*/ and scripts/eval/lib/; the section map and verse
// heuristics below are specific to the Derge Tengyur titles and Esukhia e-text (#5829).
// Shared helpers for the #5829 Tengyur characterization.

// Derge Tengyur divisions, from the Tibetan section word in each volume's title
// ("བསྟན་འགྱུར། སྡེ་དགེ། <section>། <letter> (Derge Tengyur, vol. N)").
const SECTIONS = {
  'བསྟོད་ཚོགས': 'Praises', 'རྒྱུད་འགྲེལ': 'Tantra commentary', 'ཤེར་ཕྱིན': 'Prajñāpāramitā', 'དབུ་མ': 'Madhyamaka',
  'མདོ་སྡེ': 'Sūtra commentary', 'སེམས་ཙམ': 'Cittamātra', 'མངོན་པ': 'Abhidharma', 'འདུལ་བ': 'Vinaya',
  'སྐྱེས་རབས': 'Jātaka', 'འཁྲི་ཤིང': 'Jātaka', 'སྤྲིང་ཡིག': 'Letters', 'ཚད་མ': 'Pramāṇa', 'སྒྲ་མདོ': 'Grammar & sciences',
  'གསོ་རིག': 'Grammar & sciences', 'སྣ་ཚོགས': 'Miscellaneous', 'དཀར་ཆག': 'Catalogue',
};
export function sectionOf(title) {
  const seg = (title.split('།')[2] || '').trim();
  for (const [k, v] of Object.entries(SECTIONS)) if (seg.startsWith(k)) return v;
  return 'Other';
}

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(arr, R) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Text in effect on a page: the last {D####} at or before it in the volume; opensHere if one is on the page.
export function openingAt(marks, pageNumber) {
  let current = null, opensHere = false;
  for (const r of marks) {
    if (r.page_number > pageNumber) break;
    if (r.marks.length) current = r.marks[r.marks.length - 1];
    if (r.page_number === pageNumber && r.marks.length) opensHere = true;
  }
  return { current, opensHere };
}

// Colophon: the closing formula of a text ("…rdzogs so", "…bsgyur cing zhus te gtan la phab pa").
export function isColophon(bo) {
  return /རྫོགས་སོ|རྫོགས་སྷོ|བསྒྱུར་ཅིང་ཞུས་ཏེ|ཞུས་ཏེ་གཏན་ལ་ཕབ/.test(bo);
}

// Verse share: syllables in runs of >= 2 consecutive shad-delimited segments of equal length 7, 9 or 11
// syllables (the metres of Tengyur verse), over all syllables. A heuristic, good to about a line.
export function verseShare(bo) {
  const clean = bo.replace(/\{[^}]*\}|\[[^\]]*\]|#|\([^)]*,/g, '').replace(/\)/g, '');
  const segs = clean.split(/།+/).map((s) => s.split('་').filter((x) => /[ཀ-ྼ]/.test(x)).length).filter((n) => n > 0);
  const total = segs.reduce((s, n) => s + n, 0);
  if (!total) return 0;
  let verse = 0;
  for (let i = 0; i < segs.length; i++) {
    const n = segs[i];
    if (![7, 9, 11].includes(n)) continue;
    if (segs[i - 1] === n || segs[i + 1] === n) verse += n;
  }
  return Math.round((verse / total) * 100) / 100;
}

// What a reader of the review packet sees: our markup rendered one way for every item.
export function renderEnglish(en) {
  return en
    .replace(/<(summary|keywords|meta)[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<term>([\s\S]*?)<\/term>/g, '($1)')
    .replace(/<note>([\s\S]*?)<\/note>/g, '[note: $1]')
    .replace(/<\/?[a-z][a-z-]*(\s[^>]*)?>/g, '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
