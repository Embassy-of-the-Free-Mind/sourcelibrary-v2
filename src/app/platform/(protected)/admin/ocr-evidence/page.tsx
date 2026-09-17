/**
 * /platform/admin/ocr-evidence — which OCR engine reads which kind of page, and how much
 * each claim can carry (#4735).
 *
 * Renders src/data/ocr-benchmark-evidence.json, written by
 * scripts/eval/benchmark-dashboard-data.mjs from the scored benchmark files. The page
 * computes nothing and touches no database: every number, interval and grade is fixed
 * by that script, so the page and the experiment log cannot disagree.
 *
 * The point of the page is the GRADE, not the score. A cell is graded by how many books
 * (one page per book) were scored against a ground-truth reference: exploratory < 30,
 * directional 30–49, decision-grade >= 50. A routing or withholding decision should
 * cite a decision-grade cell, or say plainly that it is a judgement call.
 *
 * Slice with ?by=script|language|period|script_period|language_period|stratum|…
 * Server-rendered, no client JS. Gated by the protected layout (requireSuperAdmin).
 */
import Link from 'next/link';
import evidence from '@/data/ocr-benchmark-evidence.json';

type Grade = 'exploratory' | 'directional' | 'decision-grade';
type Interval = [number | null, number | null] | null;

interface Cell {
  factor: string;
  level: string;
  engine: string;
  n_run: number;
  n_referenced: number;
  coverage: { aligned: number; of: number } | null;
  cer_vs_reference: { n: number; median: number | null; ci95: Interval } | null;
  cer_vs_proxy: { n: number; median: number | null } | null;
  catastrophic: { k: number; n: number } | null;
  loop: { k: number; n: number };
  paired_vs_production: { n: number; wins: number; losses: number; ties: number; untied: number; p_sign: number | null } | null;
  grade: Grade;
  referenced_pages_needed: number;
}

interface Sufficiency {
  factor: string;
  level: string;
  books: number;
  referenced: number;
  grade: Grade;
  referenced_books_needed: number;
}

const DATA = evidence as unknown as {
  generated_from: { file: string }[];
  production_engine: string;
  thresholds: { directional_n: number; decision_n: number; rate_n: number };
  totals: { pages: number; page_engine_rows: number };
  sufficiency: Sufficiency[];
  cells: Cell[];
};

const SLICES: [string, string][] = [
  ['script', 'Script'],
  ['language', 'Language'],
  ['period', 'Period'],
  ['script_period', 'Script × period'],
  ['language_period', 'Language × period'],
  ['stratum', 'Sealed stratum'],
  ['substratum', 'Stratum × draw'],
  ['script_class', 'Observed script class'],
];

const GRADE_STYLE: Record<Grade, { color: string; background: string; mark: string }> = {
  'decision-grade': { color: '#3fb950', background: '#12261e', mark: '●' },
  directional: { color: '#d29922', background: '#2b2111', mark: '◐' },
  exploratory: { color: '#8b949e', background: '#21262d', mark: '○' },
};

const C = {
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8 } as const,
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#8b949e', fontWeight: 500, borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' } as const,
  td: { padding: '7px 10px', borderBottom: '1px solid #21262d', fontSize: 13, color: '#e6edf3', whiteSpace: 'nowrap' } as const,
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const,
  dim: { color: '#8b949e' } as const,
};

const f3 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(3));

function GradeChip({ grade }: { grade: Grade }) {
  const g = GRADE_STYLE[grade];
  return (
    <span style={{ color: g.color, background: g.background, borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 500 }}>
      {g.mark} {grade}
    </span>
  );
}

/** Median and its 95 % interval on a shared axis for the level, so rows compare by eye. */
function IntervalBar({ cell, max }: { cell: Cell; max: number }) {
  const r = cell.cer_vs_reference;
  if (!r || r.median == null) return null;
  const W = 170;
  const x = (v: number) => 4 + Math.min(1, v / max) * (W - 8);
  const lo = r.ci95?.[0] ?? r.median;
  const hi = r.ci95?.[1] ?? r.median;
  return (
    <svg width={W} height={20} role="img" aria-label={`median ${f3(r.median)}, 95% interval ${f3(lo)} to ${f3(hi)}`}>
      <line x1={4} x2={W - 4} y1={10} y2={10} stroke="#30363d" />
      <rect x={x(lo)} y={6} width={Math.max(2, x(hi) - x(lo))} height={8} rx={4} fill="#58a6ff" fillOpacity={0.3} />
      <circle cx={x(r.median)} cy={10} r={4} fill="#58a6ff" stroke="#161b22" strokeWidth={2} />
    </svg>
  );
}

export default async function OcrEvidencePage({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  const { by } = await searchParams;
  const present = new Set(DATA.cells.map(c => c.factor));
  const slices = SLICES.filter(([k]) => present.has(k));
  const factor = slices.some(([k]) => k === by) ? (by as string) : slices[0][0];

  const sufficiency = DATA.sufficiency.filter(s => s.factor === factor);
  const enough = sufficiency.filter(s => s.grade === 'decision-grade').length;
  const cells = DATA.cells.filter(c => c.factor === factor);
  const sortKey = (c: Cell) => c.cer_vs_reference?.median ?? 5 + (c.cer_vs_proxy?.median ?? 9);

  return (
    <div style={{ padding: '24px 28px 64px', maxWidth: 1240, margin: '0 auto', color: '#e6edf3' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px' }}>OCR evidence</h1>
      <p style={{ ...C.dim, fontSize: 13.5, maxWidth: 820, margin: '0 0 18px', lineHeight: 1.55 }}>
        Which engine reads which kind of page, and how much each claim can carry. {DATA.totals.pages.toLocaleString('en-US')} sealed
        books, one page each, {DATA.totals.page_engine_rows.toLocaleString('en-US')} engine readings. A cell is graded by its books with a
        ground-truth reference: under {DATA.thresholds.directional_n} exploratory, {DATA.thresholds.decision_n} or more decision-grade.
        Period is the catalogue year, which for a reprint is the work&rsquo;s date and not the scan&rsquo;s (#4884).
      </p>

      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 22 }} aria-label="Slice">
        {slices.map(([k, label]) => (
          <Link
            key={k}
            href={`/platform/admin/ocr-evidence?by=${k}`}
            style={{ padding: '5px 12px', borderRadius: 6, fontSize: 13, textDecoration: 'none', color: k === factor ? '#f0f6fc' : '#8b949e', background: k === factor ? '#30363d' : 'transparent', border: '1px solid #30363d' }}
          >
            {label}
          </Link>
        ))}
      </nav>

      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Do we have enough?</h2>
      <p style={{ ...C.dim, fontSize: 13, margin: '0 0 10px' }}>
        {enough} of {sufficiency.length} levels on this slice can carry a decision. Counts are read off the production engine
        ({DATA.production_engine}): if it has no referenced books in a level, nothing there can be decided.
      </p>
      <div style={{ ...C.card, overflowX: 'auto', marginBottom: 30 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={C.th}>Level</th>
              <th style={{ ...C.th, ...C.num }}>Books sealed</th>
              <th style={{ ...C.th, ...C.num }}>With a reference</th>
              <th style={C.th}>Evidence</th>
              <th style={{ ...C.th, ...C.num }}>Referenced books still needed</th>
            </tr>
          </thead>
          <tbody>
            {sufficiency.map(s => (
              <tr key={s.level}>
                <td style={C.td}><a href={`#${encodeURIComponent(s.level)}`} style={{ color: '#58a6ff', textDecoration: 'none' }}>{s.level}</a></td>
                <td style={{ ...C.td, ...C.num }}>{s.books}</td>
                <td style={{ ...C.td, ...C.num, color: s.referenced ? '#e6edf3' : '#f85149' }}>{s.referenced}</td>
                <td style={C.td}><GradeChip grade={s.grade} /></td>
                <td style={{ ...C.td, ...C.num }}>{s.referenced_books_needed || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sufficiency.map(s => {
        const rows = cells.filter(c => c.level === s.level).sort((a, b) => sortKey(a) - sortKey(b));
        const medians = rows.flatMap(c => (c.cer_vs_reference?.median != null ? [c.cer_vs_reference.median] : []));
        const max = medians.length ? Math.max(0.02, Math.min(1, Math.max(...medians) * 1.6)) : 1;
        return (
          <section key={s.level} id={encodeURIComponent(s.level)} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
              {s.level}{' '}
              <span style={{ ...C.dim, fontWeight: 400, fontSize: 12.5 }}>
                {s.books} books · {medians.length ? `error axis 0 to ${max.toFixed(max < 0.1 ? 3 : 2)}` : 'no reference: proxy figures only, never graded'}
              </span>
            </h2>
            <div style={{ ...C.card, overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={C.th}>Engine</th>
                    <th style={{ ...C.th, ...C.num }}>Ref. books</th>
                    <th style={{ ...C.th, ...C.num }}>Median error</th>
                    <th style={C.th}>95 % interval</th>
                    <th style={{ ...C.th, ...C.num }}>Placed</th>
                    <th style={C.th}>vs production (win / loss / tie)</th>
                    <th style={{ ...C.th, ...C.num }}>Catastrophic</th>
                    <th style={{ ...C.th, ...C.num }}>Loops</th>
                    <th style={C.th}>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(c => {
                    const p = c.paired_vs_production;
                    const isProduction = c.engine === DATA.production_engine;
                    return (
                      <tr key={c.engine}>
                        <td style={{ ...C.td, fontWeight: 500 }}>
                          {c.engine} {isProduction && <span style={{ ...C.dim, fontWeight: 400, fontSize: 11 }}>production</span>}
                        </td>
                        <td style={{ ...C.td, ...C.num }}>{c.cer_vs_reference?.n ?? 0}</td>
                        <td style={{ ...C.td, ...C.num }}>
                          {c.cer_vs_reference ? f3(c.cer_vs_reference.median) : <span style={C.dim}>{c.cer_vs_proxy ? `proxy ${f3(c.cer_vs_proxy.median)}` : '—'}</span>}
                        </td>
                        <td style={C.td}><IntervalBar cell={c} max={max} /></td>
                        <td style={{ ...C.td, ...C.num }}>{c.coverage ? `${c.coverage.aligned}/${c.coverage.of}` : '—'}</td>
                        <td style={C.td}>
                          {isProduction ? <span style={C.dim}>baseline</span> : p && p.n ? (
                            <>
                              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{p.wins} / {p.losses} / {p.ties}</span>{' '}
                              <span style={C.dim}>p {p.p_sign == null ? '—' : p.p_sign < 0.001 ? '<0.001' : p.p_sign} · {p.untied} untied</span>
                            </>
                          ) : <span style={C.dim}>no referenced pairs</span>}
                        </td>
                        <td style={{ ...C.td, ...C.num, color: c.catastrophic?.k ? '#f85149' : '#e6edf3' }}>{c.catastrophic ? `${c.catastrophic.k}/${c.catastrophic.n}` : '—'}</td>
                        <td style={{ ...C.td, ...C.num, color: c.loop.k ? '#f85149' : '#e6edf3' }}>{c.loop.k}/{c.loop.n}</td>
                        <td style={C.td}><GradeChip grade={c.grade} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <p style={{ ...C.dim, fontSize: 12.5, maxWidth: 860, lineHeight: 1.55 }}>
        Error is character error rate against a reference (0.010 is one character in a hundred). The bar is the 95 % interval on the
        median, bootstrapped over books. &ldquo;Proxy&rdquo; is distance from the production engine&rsquo;s own reading; it cannot show
        that engine&rsquo;s errors. &ldquo;Placed&rdquo; is the pages an engine&rsquo;s output could be aligned to the reference at all.
        Loop and catastrophic (error above 0.5) are rates and need about {DATA.thresholds.rate_n} books for ±5 points. The head-to-head
        needs about 47 untied pairs to see a 70/30 split. Built from {DATA.generated_from.map(s => s.file).join(', ')}.
      </p>
    </div>
  );
}
