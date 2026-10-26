/**
 * PRIOR ART: scripts/lib/ocr-loop-guard.mjs — finds a page that repeats one unit across most
 * of its body (a degeneration loop). It cannot see one copied table row or one wrong cell in a
 * fluent table, which is the error this module checks. scripts/audit/detect-fabricated-ocr.mjs
 * needs the page image; this needs none.
 *
 * Checks stored page text against structure the text itself must obey (#7274).
 *
 * WHY
 * ---
 * On the Book of Wonders (6953b56577f38f6761bd979d) p.140, the stored Arabic and English gave
 * 10 of the 12 Friday planetary hours the wrong planet. The page reads fluently, and a model
 * judge was the only check, until we noticed planetary hours follow a fixed order: Saturn,
 * Jupiter, Mars, Sun, Venus, Mercury, Moon, repeating. A rule like that is a ground truth no
 * model has to supply. On p.64 a row of digits was a copy of the row above.
 *
 * Two checks, both pure functions of the text:
 *   sequenceFindings(text) — a column of 7+ planet names that mostly follows one fixed step
 *     through the order (+1 for planetary hours, +3 for day rulers) and breaks it somewhere.
 *   repeatedRowFindings(text) — two adjacent rows of 8+ digits that are identical.
 *
 * A finding is a CANDIDATE for a by-eye look, not a verdict: a column can legitimately jump
 * where one day's table ends and the next begins, and some tables do repeat a row.
 */

/** Chaldean order. A planetary-hours column steps +1 through it; a day-ruler list steps +3. */
export const PLANETS = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];

const NAMES = [
  // English, Latin (common case forms), German, Arabic, astronomical symbols.
  ['Saturn', 'Saturnus', 'Saturni', 'Saturno', 'Saturnum', 'زحل', '♄'],
  ['Jupiter', 'Iupiter', 'Iuppiter', 'Iovis', 'Jovis', 'Iove', 'Jove', 'المشتري', 'المشترى', '♃'],
  ['Mars', 'Martis', 'Marte', 'المريخ', '♂'],
  ['Sun', 'Sol', 'Solis', 'Sole', 'Sonne', 'الشمس', '☉'],
  ['Venus', 'Veneris', 'Venere', 'الزهرة', 'الزهره', '♀'],
  ['Mercury', 'Mercurius', 'Mercurii', 'Mercurio', 'Merkur', 'عطارد', 'العطارد', '☿'],
  ['Moon', 'Luna', 'Lunae', 'Mond', 'القمر', '☽', '☾'],
];

const NAME_TO_INDEX = new Map();
for (const [i, names] of NAMES.entries()) for (const n of names) NAME_TO_INDEX.set(n, i);

const PLANET_RE = new RegExp(
  `(?<![\\p{L}\\p{M}])(${[...NAME_TO_INDEX.keys()].sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{M}])`,
  'gu',
);

/** Planet indices in order of appearance. */
export function findPlanets(s) {
  return [...String(s).matchAll(PLANET_RE)].map((m) => NAME_TO_INDEX.get(m[1]));
}

const MIN_COLUMN = 7; // a full cycle; shorter runs agree with a step by chance too often
const MIN_STEP_SHARE = 0.6; // share of pairs on the dominant step for the column to count as ordered
const MAX_LINE = 160; // longer lines are prose, where planet mentions are in no order

const isTableLine = (l) => l.trim().startsWith('|');
const isSeparatorRow = (l) => /^\|?[\s:|-]+\|?$/.test(l.trim());
const cellsOf = (l) => l.trim().replace(/^\||\|$/g, '').split('|');

/**
 * Columns of planet names. A markdown table yields one column per cell index (cells naming
 * exactly one planet). Runs of short plain lines that each name a planet yield one column per
 * position within the line, so a two-day table set as "First Jupiter … First Venus" gives two.
 */
export function planetColumns(text) {
  const columns = [];
  let block = null; // { kind, cols: Map<index, {planets, rows}> }
  const close = () => {
    if (block) for (const c of block.cols.values()) columns.push(c);
    block = null;
  };
  const push = (kind, idx, planet, row) => {
    if (!block || block.kind !== kind) { close(); block = { kind, cols: new Map() }; }
    if (!block.cols.has(idx)) block.cols.set(idx, { kind, index: idx, planets: [], rows: [] });
    const c = block.cols.get(idx);
    c.planets.push(planet);
    c.rows.push(row);
  };
  const lines = String(text).split('\n');
  for (const [row, line] of lines.entries()) {
    if (isTableLine(line)) {
      if (isSeparatorRow(line)) continue;
      let any = false;
      for (const [ci, cell] of cellsOf(line).entries()) {
        const p = findPlanets(cell);
        if (p.length === 1) { push('table', ci, p[0], row); any = true; }
      }
      if (!any && block?.kind !== 'table') close();
      continue;
    }
    if (!line.trim()) continue; // blank lines do not end a block
    const p = line.length <= MAX_LINE ? findPlanets(line) : [];
    if (!p.length) { close(); continue; }
    for (const [j, planet] of p.entries()) push('lines', j, planet, row);
  }
  close();
  return columns;
}

const step = (a, b) => (b - a + 7) % 7;

/** One finding per ordered column that breaks its own order. */
export function sequenceFindings(text) {
  const out = [];
  for (const col of planetColumns(text)) {
    const seq = col.planets;
    if (seq.length < MIN_COLUMN) continue;
    const steps = seq.slice(1).map((p, i) => step(seq[i], p));
    const counts = new Map();
    for (const s of steps) if (s !== 0) counts.set(s, (counts.get(s) || 0) + 1);
    const [dominant, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [0, 0];
    if (!dominant || n / steps.length < MIN_STEP_SHARE) continue; // not an ordered column
    const breaks = [];
    for (const [i, s] of steps.entries()) {
      if (s === dominant) continue;
      breaks.push({
        row: col.rows[i + 1],
        after: PLANETS[seq[i]],
        expected: PLANETS[(seq[i] + dominant) % 7],
        found: PLANETS[seq[i + 1]],
      });
    }
    if (!breaks.length) continue;
    out.push({
      kind: 'sequence', layout: col.kind, column: col.index, step: dominant,
      length: seq.length, on_step: n, breaks,
      sequence: seq.map((p) => PLANETS[p]),
    });
  }
  return out;
}

/** Ordered planet columns on the page, broken or not: the denominator for a rate. */
export function orderedColumnCount(text) {
  let n = 0;
  for (const col of planetColumns(text)) {
    const seq = col.planets;
    if (seq.length < MIN_COLUMN) continue;
    const counts = new Map();
    for (let i = 1; i < seq.length; i++) {
      const s = step(seq[i - 1], seq[i]);
      if (s) counts.set(s, (counts.get(s) || 0) + 1);
    }
    const best = Math.max(0, ...counts.values());
    if (best / (seq.length - 1) >= MIN_STEP_SHARE) n++;
  }
  return n;
}

const DIGIT = /[0-9٠-٩۰-۹]/gu;

/** Adjacent rows of 8+ digits, mostly digits, that are character-for-character identical. */
export function repeatedRowFindings(text) {
  const out = [];
  let prev = null;
  for (const [row, line] of String(text).split('\n').entries()) {
    if (isTableLine(line) && isSeparatorRow(line)) continue;
    const body = line.replace(/[|\s]/g, '');
    if (!body) continue; // a blank line keeps adjacency
    const digits = (body.match(DIGIT) || []).length;
    if (digits >= 8 && digits / body.length >= 0.7) {
      if (prev && prev.body === body) out.push({ kind: 'repeated_row', rows: [prev.row, row], text: body.slice(0, 80) });
      prev = { body, row };
    } else {
      prev = null;
    }
  }
  return out;
}
