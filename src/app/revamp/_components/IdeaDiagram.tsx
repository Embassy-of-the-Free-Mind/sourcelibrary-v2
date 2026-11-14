/* eslint-disable @next/next/no-img-element */
import MakerBadge, { SOURCE_LIBRARY, type Maker } from './MakerBadge';

// The five ways in, one colour each (validated: lightness band, chroma, CVD ΔE ≥ 9 adjacent, 3:1 on cream).
export const WAYS = [
  { key: 'subject', label: 'Subject', color: '#7c5db5', q: 'What is it about?', std: 'FAST, Wikidata' },
  { key: 'time', label: 'Time', color: '#c4552b', q: 'When was it written?', std: 'Centuries' },
  { key: 'place', label: 'Place', color: '#1f8a6e', q: 'Where is it from?', std: 'Wikidata, Getty' },
  { key: 'language', label: 'Language', color: '#b07d12', q: 'What language?', std: 'ISO 639' },
  { key: 'type', label: 'Type', color: '#3a6bc4', q: 'What kind of thing?', std: 'LCGFT, Getty' },
] as const;
type Way = (typeof WAYS)[number]['key'] | 'set';
const C: Record<Way, string> = { ...Object.fromEntries(WAYS.map((w) => [w.key, w.color])), set: '#1a1612' } as Record<Way, string>;
const L: Record<Way, string> = { ...Object.fromEntries(WAYS.map((w) => [w.key, w.label])), set: 'Chosen set' } as Record<Way, string>;

// Real old collections, tagged with what each one really is.
const OLD: [string, Way[]][] = [
  ['Alchemy', ['subject']],
  ['Early Modern Medicine', ['subject', 'time']],
  ['Renaissance Architecture', ['subject', 'time']],
  ['East Asia', ['place']],
  ['Middle East & Africa', ['place']],
  ['Maps & Cartography', ['type']],
  ['Portraits', ['type']],
  ['Music of the Spheres', ['set']],
];

const ROWS: { key: Way; chips: string[]; on: string }[] = [
  { key: 'subject', chips: ['Alchemy', 'Medicine', 'Astronomy', 'Kabbalah'], on: 'Alchemy' },
  { key: 'time', chips: ['1500s', '1600s', '1700s'], on: '1600s' },
  { key: 'place', chips: ['Western Europe', 'Middle East', 'East Asia'], on: 'Western Europe' },
  { key: 'language', chips: ['Latin', 'German', 'Arabic'], on: 'Latin' },
  { key: 'type', chips: ['Treatise', 'Emblem', 'Woodcut', 'Map'], on: 'Emblem' },
];

const Tag = ({ w }: { w: Way }) => (
  <span className="inline-flex items-center gap-1.5 text-[12px] text-secondary"><span className="w-2.5 h-2.5 shrink-0" style={{ background: C[w], borderRadius: w === 'set' ? 0 : '50%' }} />{L[w]}</span>
);

/** Before and after, drawn: old collections each fixing one combination, against five ways in that combine. */
export default function IdeaDiagram({ pics, sets }: { pics: string[]; sets: { name: string; maker: Maker }[] }) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,0.9fr)_auto_minmax(0,1.4fr)] gap-6 lg:gap-8 items-start">
      {/* BEFORE */}
      <div>
        <p className="text-[12px] uppercase tracking-[0.14em] text-muted mb-1">Before</p>
        <p className="text-[15px] text-primary mb-4">617 groupings, all called collections. Each one fixed a single combination in advance.</p>
        <div className="space-y-2">
          {OLD.map(([name, ways]) => (
            <div key={name} className="bg-white border border-border-light px-3.5 py-2.5 flex items-center justify-between gap-3">
              <span className="text-[14.5px] text-primary">{name}</span>
              <span className="flex gap-3 shrink-0">{ways.map((w) => <Tag key={w} w={w} />)}</span>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-muted mt-3">Each dot is what the grouping really was: a subject, a period, a place, a kind of picture, or a set someone chose.</p>
      </div>

      {/* ARROW */}
      <div className="hidden lg:flex flex-col items-center justify-center self-stretch text-muted">
        <svg width="56" height="120" viewBox="0 0 56 120" aria-hidden><path d="M4 60 H44" stroke="currentColor" strokeWidth="2" /><path d="M36 50 L48 60 L36 70" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        <span className="text-[12px] text-center max-w-[90px] leading-snug">split by what each really is</span>
      </div>

      {/* AFTER */}
      <div>
        <p className="text-[12px] uppercase tracking-[0.14em] text-muted mb-1">After</p>
        <p className="text-[15px] text-primary mb-4">Five ways in, each named after a standard. Pick one on each and they combine.</p>
        <div className="space-y-2">
          {ROWS.map((r) => {
            const w = WAYS.find((x) => x.key === r.key)!;
            return (
              <div key={r.key} className="grid grid-cols-[96px_minmax(0,1fr)] sm:grid-cols-[110px_minmax(0,1fr)] items-center gap-3">
                <span className="text-[14px] font-medium" style={{ color: w.color }}>{w.label}<span className="block text-[11.5px] font-normal text-muted">{w.std}</span></span>
                <span className="flex flex-wrap gap-1.5">
                  {r.chips.map((c) => (
                    <span key={c} className="h-8 px-3 inline-flex items-center text-[13.5px] border"
                      style={c === r.on ? { background: w.color, borderColor: w.color, color: '#fff' } : { borderColor: '#d9d2c6', color: '#5c544a', background: '#fff' }}>{c}</span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        {/* the combination lands on real pictures */}
        <div className="mt-4 border-l-4 pl-4 py-1" style={{ borderColor: '#1a1612' }}>
          <p className="text-[14px] text-primary mb-2">
            {ROWS.map((r, i) => <span key={r.key}>{i > 0 && <span className="text-muted"> · </span>}<span style={{ color: C[r.key] }} className="font-medium">{r.on}</span></span>)}
            <span className="text-muted">: a combination of filters, not a page someone had to make</span>
          </p>
          <p className="text-[12px] text-muted mb-1.5">For example, pictures from Alchemy:</p>
          <div className="flex gap-1.5 overflow-hidden h-20">{pics.slice(0, 8).map((src) => <img key={src} src={src} alt="" className="h-full w-auto object-cover" loading="lazy" />)}</div>
        </div>
        {/* collections: what only a person can do */}
        <div className="mt-6">
          <p className="text-[14px] text-primary mb-2"><Tag w="set" /> <span className="ml-1">Collections keep what only a person can do: choose, order, annotate and sign.</span></p>
          <div className="grid sm:grid-cols-3 gap-2">
            {sets.map((s) => (
              <div key={s.name} className="bg-[#1a1612] text-white px-3.5 py-3">
                <span className="block text-[14.5px] leading-snug mb-2">{s.name}</span>
                <span className="text-[12.5px]"><MakerBadge maker={s.maker} color="rgba(255,255,255,.8)" size={20} /></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { SOURCE_LIBRARY };
