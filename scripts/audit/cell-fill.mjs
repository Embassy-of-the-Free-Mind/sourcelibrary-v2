// PRIOR ART: scripts/eval/error-zoo/zoo-stats.py (year_of, ybin, lang_of: the heat map's cells, mirrored here so a
// draw and the map agree on what a cell is) and scripts/audit/convergent-audit-weekly.mjs (the random stratum this
// tops up). Neither picks books BY cell; the random stratum leaves most language × half-century cells under the map's
// 8-page floor (#244: 25 of 60 cells after 1,344 pages).
/**
 * Cell fill (#244): pick random books from the language × half-century cells the weekly audit has read least, so the
 * heat map on /quality fills in. Within a cell the pick is uniform, so a cell's serious share stays an unbiased
 * estimate when fill pages join the random ones; across cells it is NOT uniform, so fill pages never enter the
 * headline rate or the predictor's uniform frame (zoo-stats.py keeps `uniform` = random only).
 */

export const MIN_CELL_PAGES = 8;

const BINS = [[0, 1450, 'before 1450'], [1450, 1500, '1450–99'], [1500, 1550, '1500–49'], [1550, 1600, '1550–99'], [1600, 1650, '1600–49'],
  [1650, 1700, '1650–99'], [1700, 1750, '1700–49'], [1750, 1800, '1750–99'], [1800, 1850, '1800–49'], [1850, 3000, '1850 on']];
const LANGFOLD = { 'Ancient Greek': 'Greek', 'Classical Chinese': 'Chinese', 'Literary Chinese': 'Chinese', 'Middle French': 'French', 'Early Modern German': 'German', 'Middle High German': 'German' };

/** First plausible year in year / published / est_year, as zoo-stats.py year_of. */
export function yearOf(b) {
  for (const v of [b?.year, b?.published, b?.est_year]) {
    const m = String(v ?? '').match(/1[0-9]{3}|20[0-2][0-9]/);
    if (m) return Number(m[0]);
  }
  return null;
}

export function halfCentury(y) {
  if (y == null) return null;
  const bin = BINS.find(([a, b]) => a <= y && y < b);
  return bin ? bin[2] : null;
}

/** The map's language: first of a list, folded, as zoo-stats.py lang_of. */
export function cellLang(language) {
  const L = String(language ?? '').split(/[,;/(]| and /)[0].trim();
  return LANGFOLD[L] ?? (L || null);
}

/** 'Latin|1550–99', or null for a book with no language or no usable date (the map leaves those out). */
export function cellOf(book) {
  const lang = cellLang(book?.language), bin = halfCentury(yearOf(book));
  return lang && bin ? `${lang}|${bin}` : null;
}

/**
 * Choose up to n book ids. A cell qualifies if the frame holds at least `target` books in it (so one page per book can
 * reach the floor) and fewer than `target` pages have been read there. Thinnest cells first; one book per cell per
 * pass, round-robin, so one round spreads over many cells. `shuffle` is the draw's seeded shuffle.
 */
export function pickFill({ frame, counts, n, target = MIN_CELL_PAGES, exclude = new Set(), shuffle }) {
  const byCell = new Map();
  for (const b of frame) {
    if (exclude.has(b.id)) continue;
    const c = cellOf(b);
    if (!c) continue;
    if (!byCell.has(c)) byCell.set(c, []);
    byCell.get(c).push(b.id);
  }
  const cells = [...byCell.entries()]
    .filter(([c, ids]) => ids.length >= target && (counts.get(c) ?? 0) < target)
    .map(([c, ids]) => ({ cell: c, have: counts.get(c) ?? 0, queue: shuffle(ids) }))
    .sort((a, b) => a.have - b.have || b.queue.length - a.queue.length || (a.cell < b.cell ? -1 : 1));
  const picks = [];
  while (picks.length < n && cells.some((c) => c.queue.length && c.have < target)) {
    for (const c of cells) {
      if (picks.length >= n) break;
      if (!c.queue.length || c.have >= target) continue;
      picks.push({ id: c.queue.shift(), cell: c.cell });
      c.have += 1;
    }
  }
  return picks;
}
