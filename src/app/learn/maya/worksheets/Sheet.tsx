/* eslint-disable @next/next/no-img-element -- fixed-size line drawings from images.sourcelibrary.org, printed */
import type { ReactNode } from 'react';
import { CREDITS, type Block, type Sheet, type Sign } from './data';

const line = 'border-b border-stone-400 h-7';

function Glyph({ s, h = 64, label }: { s: Sign; h?: number; label?: string }) {
  return (
    <figure className="flex flex-col items-center gap-1">
      <img src={s.src} alt={label ? `Maya sign ${label}` : 'Maya sign'} style={{ height: h, width: 'auto', maxWidth: h * 1.6 }} className="object-contain" />
      {label && <figcaption className="text-xs text-stone-600 font-mono">{label}</figcaption>}
    </figure>
  );
}

function ChartCell({ s }: { s: Sign }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <img src={s.src} alt={`Maya sign ${s.value}`} style={{ height: 27, width: 'auto', maxWidth: 44 }} className="object-contain" />
      <span className="text-[10px] text-stone-600 font-mono">{s.value}</span>
    </div>
  );
}

function BlockImg({ b, h = 150 }: { b: Block; h?: number }) {
  return <img src={b.src} alt={`Glyph block ${b.coord}, ${b.monument}`} style={{ height: h, width: 'auto' }} className="object-contain mx-auto" />;
}

/** One Maya numeral, 0-19, as in the maths article's <Numeral>; static here so a printed sheet ships no client code. */
function Numeral({ value, size = 44 }: { value: number; size?: number }) {
  const bars = Math.floor(value / 5), dots = value % 5;
  const barH = 7, gap = 4, r = 4.5;
  const h = value === 0 ? 34 : (dots ? r * 2 + gap : 0) + bars * (barH + gap) - gap;
  return (
    <svg width={size} height={(h * size) / 60} viewBox={`0 0 60 ${h}`} role="img" aria-label={`Maya numeral ${value}`}>
      {value === 0 ? (
        <g fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <ellipse cx={30} cy={17} rx={24} ry={14} />
          <path d="M10 13 Q30 3 50 13" />
          <path d="M14 22 Q30 28 46 22" />
          <path d="M22 9 L24 25 M38 9 L36 25" />
        </g>
      ) : (
        <g fill="currentColor">
          {Array.from({ length: dots }, (_, i) => <circle key={i} cx={4 + (52 / dots) * (i + 0.5)} cy={r} r={r} />)}
          {Array.from({ length: bars }, (_, i) => <rect key={i} x={2} y={(dots ? r * 2 + gap : 0) + i * (barH + gap)} width={56} height={barH} rx={3} />)}
        </g>
      )}
    </svg>
  );
}

function Num({ n }: { n: number }) {
  return <span className="text-xs text-stone-500 tabular-nums w-5 shrink-0">{n}.</span>;
}

function Box({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-stone-300 rounded-lg p-3 ws-avoid ${className}`}>{children}</div>;
}

function Bank({ words }: { words: string[] }) {
  return (
    <div className="border border-stone-400 rounded-lg px-4 py-2 mb-5 text-sm flex flex-wrap gap-x-5 gap-y-1 ws-avoid">
      {words.map((w) => <span key={w}>{w}</span>)}
    </div>
  );
}

const blockSource = (b: Block) => `${b.monument}, block ${b.coord}`;

function Body({ sheet }: { sheet: Sheet }) {
  switch (sheet.layout) {
    case 'chart':
      return (
        <table className="mx-auto border-collapse">
          <thead>
            <tr>
              <th />
              {['a', 'e', 'i', 'o', 'u'].map((v) => <th key={v} className="font-mono text-sm px-2 pb-1">{v}</th>)}
            </tr>
          </thead>
          <tbody>
            {sheet.chart.map((row) => (
              <tr key={row.consonant || 'vowel'} className="ws-avoid">
                <th className="font-mono text-sm pr-3 text-right align-middle">{row.consonant || '–'}</th>
                {row.cells.map((c) => (
                  <td key={c.value} className="border border-stone-200 px-1 py-0.5 align-middle w-20">
                    {c.missing ? null : <ChartCell s={c} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'write':
      return (
        <div className={`grid grid-cols-3 gap-3 ${sheet.items.length > 16 ? 'sm:grid-cols-5 print:grid-cols-5' : 'sm:grid-cols-4 print:grid-cols-4'}`}>
          {sheet.items.map((it, i) => (
            <Box key={i}>
              <div className="flex"><Num n={i + 1} /></div>
              <Glyph s={it} h={sheet.items.length > 16 ? 52 : 64} />
              <div className={`${line} mt-2`} />
            </Box>
          ))}
        </div>
      );
    case 'trace':
      return (
        <div className="space-y-2">
          {sheet.items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 ws-avoid">
              <Num n={i + 1} />
              <div className="w-28 flex items-center justify-center gap-2"><Glyph s={it} h={44} /><span className="font-mono text-sm text-stone-600 w-8">{it.value}</span></div>
              {[0, 1, 2].map((k) => <div key={k} className="flex-1 h-16 border border-dashed border-stone-400 rounded-lg" />)}
            </div>
          ))}
        </div>
      );
    case 'circle':
      return (
        <div className="space-y-2">
          {sheet.items.map((it, i) => (
            <div key={i} className="flex items-center gap-4 ws-avoid border-b border-stone-200 pb-2">
              <Num n={i + 1} />
              <span className="font-mono text-xl w-14">{it.prompt}</span>
              {it.options.map((o, k) => (
                <div key={k} className="flex items-center gap-1">
                  <span className="text-xs text-stone-500">{'ABCD'[k]}</span>
                  <Glyph s={o} h={48} />
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    case 'spell-read':
      return (
        <>
          <Bank words={sheet.bank} />
          <div className="space-y-4">
            {sheet.items.map((it, i) => (
              <div key={i} className="flex items-center gap-4 ws-avoid">
                <Num n={i + 1} />
                <div className="flex items-center gap-2 w-64">{it.signs.map((s, k) => <Glyph key={k} s={s} h={56} />)}</div>
                <div className="flex-1 grid grid-cols-2 gap-4 text-xs text-stone-500">
                  <div>syllables<div className={line} /></div>
                  <div>word and meaning<div className={line} /></div>
                </div>
              </div>
            ))}
          </div>
        </>
      );
    case 'spell-write':
      return (
        <div className="space-y-5">
          {sheet.items.map((it, i) => (
            <div key={i} className="flex items-center gap-4 ws-avoid">
              <Num n={i + 1} />
              <div className="w-48">
                <div className="font-serif text-lg">{it.word}</div>
                <div className="text-xs text-stone-600">“{it.gloss}”, {it.parts.length} syllables</div>
              </div>
              {it.parts.map((_, k) => <div key={k} className="w-20 h-20 border border-dashed border-stone-400 rounded-lg" />)}
            </div>
          ))}
        </div>
      );
    case 'pairs':
      return (
        <div className="grid grid-cols-2 gap-4">
          {sheet.items.map((it, i) => (
            <Box key={i}>
              <div className="flex"><Num n={i + 1} /></div>
              <div className="flex justify-around">
                {it.signs.map((s, k) => (
                  <div key={k} className="w-24">
                    <Glyph s={s} h={72} />
                    <div className={`${line} mt-2`} />
                  </div>
                ))}
              </div>
            </Box>
          ))}
        </div>
      );
    case 'match':
      return (
        <>
          <Bank words={sheet.bank} />
          <div className="grid grid-cols-3 sm:grid-cols-4 print:grid-cols-4 gap-4">
            {sheet.items.map((it, i) => (
              <Box key={i}>
                <div className="flex"><Num n={i + 1} /></div>
                <Glyph s={it} h={88} />
                <div className={`${line} mt-2`} />
              </Box>
            ))}
          </div>
        </>
      );
    case 'numerals':
      return (
        <>
          <h3 className="font-serif text-lg mb-3">A. Write the number</h3>
          <div className="grid grid-cols-5 gap-4 mb-8">
            {sheet.read.map((n, i) => (
              <Box key={i}>
                <div className="flex"><Num n={i + 1} /></div>
                <div className="flex justify-center items-end h-16"><Numeral value={n} size={52} /></div>
                <div className={`${line} mt-2`} />
              </Box>
            ))}
          </div>
          <h3 className="font-serif text-lg mb-3">B. Draw the number in bars and dots</h3>
          <div className="grid grid-cols-3 gap-4">
            {sheet.draw.map((n, i) => (
              <Box key={i}>
                <div className="flex items-baseline gap-2"><Num n={i + 1} /><span className="font-serif text-2xl">{n}</span></div>
                <div className="h-24" />
              </Box>
            ))}
          </div>
        </>
      );
    case 'blocks-number':
      return (
        <div className="grid grid-cols-2 sm:grid-cols-5 print:grid-cols-5 gap-3">
          {sheet.items.map((b, i) => (
            <Box key={b.id}>
              <div className="flex"><Num n={i + 1} /></div>
              <BlockImg b={b} h={100} />
              <div className="text-xs text-stone-500 mt-2">number<div className={line} /></div>
              <div className="text-[10px] text-stone-500 mt-1">{blockSource(b)}</div>
            </Box>
          ))}
        </div>
      );
    case 'blocks-word':
      return (
        <>
          <div className="border border-stone-400 rounded-lg px-3 py-2 mb-5 flex flex-wrap gap-3 justify-center ws-avoid">
            {sheet.helper.map((s) => <Glyph key={s.value} s={s} h={32} label={s.value} />)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3">
            {sheet.items.map((b, i) => (
              <Box key={b.id}>
                <div className="flex"><Num n={i + 1} /></div>
                <BlockImg b={b} h={110} />
                <div className="text-xs text-stone-500 mt-2">syllables<div className={line} /></div>
                <div className="text-xs text-stone-500 mt-1">word<div className={line} /></div>
              </Box>
            ))}
          </div>
        </>
      );
  }
}

function Answers({ sheet }: { sheet: Sheet }) {
  const list = (xs: ReactNode[]) => (
    <ol className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
      {xs.map((x, i) => <li key={i} className="flex gap-2"><Num n={i + 1} /><span>{x}</span></li>)}
    </ol>
  );
  const blockAnswer = (b: Block, lead?: string) => (
    <span>
      {lead && <strong>{lead} · </strong>}
      <span className="font-mono">{b.transliteration}</span> · <em>{b.transcription}</em> · “{b.translation}”
      <span className="text-stone-500"> ({blockSource(b)}; Stuart 2006, p. {b.page})</span>
    </span>
  );
  switch (sheet.layout) {
    case 'chart': return null;
    case 'trace': return null;
    case 'write': case 'circle': case 'spell-read': case 'pairs': case 'match':
      return list(sheet.items.map((it) => <span className="font-mono">{it.answer}</span>));
    case 'spell-write':
      return (
        <ol className="space-y-2 text-sm">
          {sheet.items.map((it, i) => (
            <li key={i} className="flex items-center gap-3">
              <Num n={i + 1} />
              <span className="w-28">{it.word}</span>
              <span className="font-mono w-32">{it.parts.join('-')}</span>
              {it.answerSigns.map((s, k) => <Glyph key={k} s={s} h={32} />)}
            </li>
          ))}
        </ol>
      );
    case 'numerals':
      return (
        <div className="text-sm space-y-2">
          <p><strong>A.</strong> {sheet.read.join(', ')}</p>
          <div className="flex flex-wrap items-end gap-6"><strong>B.</strong>
            {sheet.draw.map((n) => <span key={n} className="flex flex-col items-center gap-1"><Numeral value={n} size={34} /><span className="text-xs">{n}</span></span>)}
          </div>
        </div>
      );
    case 'blocks-number':
      return list(sheet.items.map((b) => blockAnswer(b, String(b.number))));
    case 'blocks-word':
      return <ol className="space-y-1 text-sm">{sheet.items.map((b, i) => <li key={b.id} className="flex gap-2"><Num n={i + 1} />{blockAnswer(b)}</li>)}</ol>;
  }
}

export default function SheetView({ sheet, withKey = true }: { sheet: Sheet; withKey?: boolean }) {
  return (
    <article className="ws-page bg-white text-stone-900 max-w-[800px] mx-auto px-8 py-8 print:p-0 print:max-w-none">
      <div className="flex items-start justify-between gap-6 mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-stone-500">Learn to read Maya · {sheet.level}</p>
          <h2 className="font-serif text-2xl">{sheet.title}</h2>
        </div>
        <div className="text-xs text-stone-500 w-56 space-y-2 shrink-0">
          <div>Name<div className="border-b border-stone-400 h-5" /></div>
          <div>Date<div className="border-b border-stone-400 h-5" /></div>
        </div>
      </div>
      <p className="text-sm leading-relaxed mb-6 max-w-[65ch]">{sheet.intro}</p>
      <Body sheet={sheet} />
      {sheet.credits.length > 0 && (
        <div className="mt-6 pt-2 border-t border-stone-200 text-[10px] leading-snug text-stone-500 space-y-0.5">
          {sheet.credits.map((c) => <p key={c}>{CREDITS[c]}</p>)}
          <p>sourcelibrary.org/learn/maya/worksheets/{sheet.slug}</p>
        </div>
      )}
      {withKey && sheet.layout !== 'chart' && sheet.layout !== 'trace' && (
        <section className="ws-key mt-10 pt-6 border-t-2 border-dashed border-stone-300">
          <h3 className="font-serif text-lg mb-3">Answer key: {sheet.title}</h3>
          <Answers sheet={sheet} />
        </section>
      )}
    </article>
  );
}
