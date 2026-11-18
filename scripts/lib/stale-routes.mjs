// PRIOR ART: scripts/maintenance/router-board-push.mjs (the board: per-cell status, evidence, waivers, lanes; it says
// whether a decision SHIPPED, not whether the decision is still good) and src/lib/router-board.ts (reads that document
// for /admin/router). Neither asks "is this route stale?" (v3#460), so the rules live here, pure over the board
// document, and the push stores their output on it for the page and the daily mail.
/**
 * Stale routes (v3#460). A route is stale when the decision behind it should be looked at again, not when it is broken.
 * One finding per (cell, rule); pure over a router-board document (router-board-push.mjs routerBoard + the newer-build
 * fields it adds), so the hourly push, the 07:00 mail and the tests all compute the same list.
 *
 * Rules, each with its threshold (Derek, v3#460, 2026-11-17):
 *   waiver      a live waiver expires within WAIVER_DAYS (the lane falls back to a mismatch then)
 *   evidence    the newest build after the pointer (it pools the evidence judged since) reaches another decision or
 *               route for the cell than the one it runs on; more pages for the same decision leave it standing
 *   thin        the decided route rests on fewer than THIN_N judged pages while more than BIG_CELL pages wait
 *   production  a cron lane runs another route with no waiver, or runs a route the table does not name at all,
 *               or a decided cell with pages waiting has no lane (unshipped)
 *   undecided   a cell with more than BIG_CELL pages waiting has no decision (HOLD, UNTESTED, planned, held)
 *   tables      scripts/lib routing tables older than the pointer
 *   pointer     the pointer has not moved for POINTER_DAYS while newer builds exist (one finding for the table)
 * Ordered: production, waiver, evidence, thin, then undecided and the table-wide ones, biggest queue first in each.
 */

export const WAIVER_DAYS = 7;
export const THIN_N = 50;
export const BIG_CELL = 50_000;
export const POINTER_DAYS = 14;
export const RULES = ['production', 'waiver', 'evidence', 'thin', 'undecided', 'tables', 'pointer'];

const day = (s) => (s ? String(s).slice(0, 10) : null);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const k = (n) => (n == null ? '?' : n >= 10_000 ? `${Math.round(n / 1000)}K` : Number(n).toLocaleString('en-US'));

/**
 * @param {object} board  the router-board document (cells[], routing_tables[], pointer_set, table, newest_build?)
 * @param {{ today?: string }} opts  today = YYYY-MM-DD (UTC)
 * @returns {{ cell: string|null, rule: string, why: string, pages_waiting: number }[]}
 */
export function staleRoutes(board, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const out = [];
  const add = (cell, rule, why, pages = 0) => out.push({ cell, rule, why, pages_waiting: pages || 0 });
  for (const c of board?.cells ?? []) {
    const decided = c.status !== 'undecided';
    const n = c.evidence?.n ?? null;
    const routeIds = new Set((c.routes || []).map((r) => r.id));
    // production: what runs is not what was decided
    const mismatched = (c.lanes || []).filter((l) => l.status === 'mismatch');
    if (mismatched.length) add(c.cell, 'production', `${mismatched.map((l) => `${l.box} ${l.lane}`).join(', ')} runs ${[...new Set(mismatched.map((l) => l.runs))].join(', ')}, decided ${c.route}, no live waiver`, c.pages_waiting);
    const unnamed = (c.lanes || []).filter((l) => l.runs && routeIds.size && !routeIds.has(l.runs));
    if (unnamed.length) add(c.cell, 'production', `cron line runs ${[...new Set(unnamed.map((l) => l.runs))].join(', ')}, a route the table does not name for this cell`, c.pages_waiting);
    if (c.status === 'unshipped') add(c.cell, 'production', `decided ${c.decision} ${c.route} on ${day(c.decided_set) ?? '?'}, but no cron lane runs it`, c.pages_waiting);
    // waiver: a live one about to lapse
    for (const w of (c.waivers || []).filter((x) => x.live)) {
      const left = daysBetween(today, w.until);
      if (left <= WAIVER_DAYS) add(c.cell, 'waiver', `waiver${w.lane ? ` for ${w.lane}` : ''} ends ${w.until} (${left <= 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`})`, c.pages_waiting);
    }
    // a waived cell whose every waiver is dead runs as a mismatch; the push grades it so, but say why
    if (c.status === 'waived' && (c.waivers || []).length && !(c.waivers || []).some((x) => x.live)) add(c.cell, 'waiver', `every waiver has expired (last ${c.waivers.map((x) => x.until).sort().pop()})`, c.pages_waiting);
    if (decided) {
      // evidence: a newer build knows more about the decided route
      // A newer build that pools more pages but lands on the same decision and route leaves the decision standing.
      const nb = c.newest_build;
      const differs = nb?.decision && /^(keep|switch|HOLD)$/.test(nb.decision) && (nb.decision !== c.decision || (nb.route && nb.route !== c.route));
      if (nb && nb.table && nb.table !== c.table && differs && c.status !== 'idle') {
        const more = nb.n != null && n != null && nb.n > n ? ` on ${nb.n} pages of it (the decision had ${n})` : '';
        add(c.cell, 'evidence', `decided ${c.decision} ${c.route} on ${day(c.decided_set) ?? '?'}; ${nb.table} decides ${nb.decision}${nb.route && nb.route !== c.route ? ` ${nb.route}` : ''}${more}`, c.pages_waiting);
      }
      // thin: a big queue on a small test
      if (c.pages_waiting > BIG_CELL && (n == null || n < THIN_N) && c.status !== 'idle') add(c.cell, 'thin', `${k(c.pages_waiting)} pages waiting on ${n == null ? 'no judged pages' : `${c.evidence.k_of_n} judged pages`} (${c.route}, decided ${day(c.decided_set) ?? '?'})`, c.pages_waiting);
    } else if (c.pages_waiting > BIG_CELL) {
      const nb = c.newest_build;
      const hint = nb?.decision && /^(keep|switch)$/.test(nb.decision) ? `; ${nb.table} would ${nb.decision} ${nb.route}` : '';
      add(c.cell, 'undecided', `${k(c.pages_waiting)} pages waiting, decision ${c.decision || 'none'}${n != null ? ` (best route ${c.evidence.k_of_n})` : ''}${hint}`, c.pages_waiting);
    }
  }
  for (const t of board?.routing_tables ?? []) {
    if (t.days_behind_pointer != null && t.days_behind_pointer > 0) add(null, 'tables', `${String(t.file).split('/').pop()} is ${t.days_behind_pointer} days older than the pointer (${board.pointer_set})`);
  }
  const ps = day(board?.pointer_set);
  const newer = (board?.builds_since_pointer ?? []);
  if (ps && newer.length && daysBetween(ps, today) >= POINTER_DAYS) add(null, 'pointer', `the pointer (${board.table}, set ${ps}) has not moved for ${daysBetween(ps, today)} days; ${newer.length} newer build${newer.length === 1 ? '' : 's'} not adopted (${newer.slice(-3).join(', ')})`);
  const rank = Object.fromEntries(RULES.map((r, i) => [r, i]));
  return out.sort((a, b) => rank[a.rule] - rank[b.rule] || b.pages_waiting - a.pages_waiting || String(a.cell).localeCompare(String(b.cell)));
}

/** A stale list grouped for a short read: { rule: [findings] } in RULES order, empty rules dropped. */
export function groupStale(list) {
  const g = {};
  for (const r of RULES) { const xs = list.filter((x) => x.rule === r); if (xs.length) g[r] = xs; }
  return g;
}

export const RULE_LABEL = {
  production: 'production runs another route', waiver: 'waiver ending', evidence: 'newer evidence than the decision',
  thin: 'thin evidence for a big queue', undecided: 'big cell, no decision', tables: 'routing tables behind the pointer',
  pointer: 'pointer not moved',
};
