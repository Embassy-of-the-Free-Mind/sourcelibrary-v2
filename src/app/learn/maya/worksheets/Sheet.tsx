/* eslint-disable @next/next/no-img-element -- vector glyph traces and line drawings, printed at fixed sizes */
import type { ReactNode } from 'react';
import { CREDITS, type Block, type Sheet, type Sign } from './data';

function Glyph({ s, h = 64, label }: { s: Sign; h?: number; label?: string }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <img src={s.src} alt={label ? `Maya sign ${label}` : 'Maya sign'} style={{ height: h, width: 'auto', maxWidth: h * 1.6 }} className="object-contain" />
      {label && <figcaption className="ts-glyph-label">{label}</figcaption>}
    </figure>
  );
}

function BlockImg({ b, h = 110 }: { b: Block; h?: number }) {
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
  return <span className="ts-label ts-suave tabular-nums w-5 shrink-0">{n}</span>;
}

function Tile({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ts-tile p-3 ws-avoid ${className}`}>{children}</div>;
}

function Bank({ words }: { words: string[] }) {
  return (
    <div className="ts-tile-flat px-4 py-2 mb-6 flex flex-wrap gap-x-5 gap-y-1 ts-body ws-avoid">
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
              {['a', 'e', 'i', 'o', 'u'].map((v) => <th key={v} className="ts-display text-lg px-2 pb-1">{v}</th>)}
            </tr>
          </thead>
          <tbody>
            {sheet.chart.map((row) => (
              <tr key={row.consonant || 'vowel'} className="ws-avoid">
                <th className="ts-glyph-label pr-3 text-right align-middle">{row.consonant || 'vowel'}</th>
                {row.cells.map((c) => (
                  <td key={c.value} className="border ts-hair px-1.5 py-0.5 align-middle w-[86px]">
                    {c.missing ? <span className="block text-center ts-suave">–</span> : (
                      <div className="flex items-center justify-between gap-1">
                        <img src={c.src} alt={`Maya sign ${c.value}`} style={{ height: 28, width: 'auto', maxWidth: 46 }} className="object-contain" />
                        <span className="text-[12px] font-bold">{c.value}</span>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'write': {
      const dense = sheet.items.length > 16;
      return (
        <div className={`grid grid-cols-3 ${dense ? 'gap-3 sm:grid-cols-6 print:grid-cols-6' : 'gap-4 sm:grid-cols-4 print:grid-cols-4'}`}>
          {sheet.items.map((it, i) => (
            <Tile key={i}>
              <Num n={i + 1} />
              <Glyph s={it} h={dense ? 46 : 62} />
              <div className="ts-line mt-1" />
            </Tile>
          ))}
        </div>
      );
    }
    case 'trace':
      return (
        <div className="space-y-2">
          {sheet.items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 ws-avoid">
              <Num n={i + 1} />
              <div className="ts-tile-flat w-28 h-[60px] flex items-center justify-center gap-2 px-2">
                <img src={it.src} alt={`Maya sign ${it.value}`} style={{ height: 40, width: 'auto', maxWidth: 56 }} className="object-contain" />
                <span className="ts-glyph-label w-8">{it.value}</span>
              </div>
              {[0, 1, 2].map((k) => <div key={k} className="ts-empty flex-1 h-[60px]" />)}
            </div>
          ))}
        </div>
      );
    case 'circle':
      return (
        <div className="space-y-2">
          {sheet.items.map((it, i) => (
            <div key={i} className="flex items-center gap-4 ws-avoid border-b ts-hair pb-2">
              <Num n={i + 1} />
              <span className="ts-display text-xl w-16">{it.prompt}</span>
              {it.options.map((o, k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="ts-label ts-suave">{'ABCD'[k]}</span>
                  <Glyph s={o} h={46} />
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
                <div className="ts-tile-flat flex items-center gap-2 px-3 py-2 w-64">{it.signs.map((s, k) => <Glyph key={k} s={s} h={50} />)}</div>
                <div className="flex-1 grid grid-cols-2 gap-4 ts-label ts-suave">
                  <div>syllables<div className="ts-line" /></div>
                  <div>word and meaning<div className="ts-line" /></div>
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
                <div className="text-xl font-bold">{it.word}</div>
                <div className="text-sm ts-suave">“{it.gloss}”, {it.parts.length} syllables</div>
              </div>
              {it.parts.map((_, k) => <div key={k} className="ts-empty w-20 h-20" />)}
            </div>
          ))}
        </div>
      );
    case 'pairs':
      return (
        <div className="grid grid-cols-2 gap-5">
          {sheet.items.map((it, i) => (
            <Tile key={i}>
              <Num n={i + 1} />
              <div className="flex justify-around">
                {it.signs.map((s, k) => (
                  <div key={k} className="w-28">
                    <Glyph s={s} h={66} />
                    <div className="ts-line mt-1" />
                  </div>
                ))}
              </div>
            </Tile>
          ))}
        </div>
      );
    case 'match': {
      const dense = sheet.items.length > 12;
      return (
        <>
          <Bank words={sheet.bank} />
          <div className={`grid grid-cols-3 gap-4 ${dense ? 'sm:grid-cols-5 print:grid-cols-5' : 'sm:grid-cols-4 print:grid-cols-4'}`}>
            {sheet.items.map((it, i) => (
              <Tile key={i}>
                <Num n={i + 1} />
                <Glyph s={it} h={dense ? 54 : 76} />
                <div className="ts-line mt-1" />
              </Tile>
            ))}
          </div>
        </>
      );
    }
    case 'numerals':
      return (
        <>
          <h3 className="text-[22px] leading-7 font-bold mb-3">A. Write the number</h3>
          <div className="grid grid-cols-5 gap-4 mb-8">
            {sheet.read.map((n, i) => (
              <Tile key={i}>
                <Num n={i + 1} />
                <div className="flex justify-center items-end h-16"><Numeral value={n} size={52} /></div>
                <div className="ts-line mt-1" />
              </Tile>
            ))}
          </div>
          <h3 className="text-[22px] leading-7 font-bold mb-3">B. Draw the number in bars and dots</h3>
          <div className="grid grid-cols-3 gap-4">
            {sheet.draw.map((n, i) => (
              <Tile key={i}>
                <div className="flex items-baseline gap-2"><Num n={i + 1} /><span className="ts-display text-2xl">{n}</span></div>
                <div className="h-24" />
              </Tile>
            ))}
          </div>
        </>
      );
    case 'blocks-number':
      return (
        <div className="grid grid-cols-2 sm:grid-cols-5 print:grid-cols-5 gap-3">
          {sheet.items.map((b, i) => (
            <Tile key={b.id}>
              <Num n={i + 1} />
              <BlockImg b={b} h={100} />
              <div className="ts-label ts-suave mt-2">number<div className="ts-line" /></div>
            </Tile>
          ))}
        </div>
      );
    case 'blocks-word':
      return (
        <>
          <div className="ts-tile-flat px-3 py-2 mb-5 flex flex-wrap gap-3 justify-center ws-avoid">
            {sheet.helper.map((s) => <Glyph key={s.value} s={s} h={32} label={s.value} />)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3">
            {sheet.items.map((b, i) => (
              <Tile key={b.id}>
                <Num n={i + 1} />
                <BlockImg b={b} h={110} />
                <div className="ts-label ts-suave mt-2">syllables<div className="ts-line" /></div>
                <div className="ts-label ts-suave mt-1">word<div className="ts-line" /></div>
              </Tile>
            ))}
          </div>
        </>
      );
  }
}

function Answers({ sheet }: { sheet: Sheet }) {
  const list = (xs: ReactNode[]) => (
    <ol className="grid grid-cols-2 gap-x-8 gap-y-1.5 ts-body">
      {xs.map((x, i) => <li key={i} className="flex gap-3"><Num n={i + 1} /><span>{x}</span></li>)}
    </ol>
  );
  const blockAnswer = (b: Block, lead?: string) => (
    <span>
      {lead && <strong>{lead} · </strong>}
      <span className="font-bold">{b.transliteration}</span> · <em>{b.transcription}</em> · “{b.translation}”
      <span className="ts-suave"> ({blockSource(b)}; Stuart 2006, p. {b.page})</span>
    </span>
  );
  switch (sheet.layout) {
    case 'chart': case 'trace': return null;
    case 'write': case 'circle': case 'spell-read': case 'pairs': case 'match':
      return list(sheet.items.map((it) => <span className="font-bold">{it.answer}</span>));
    case 'spell-write':
      return (
        <ol className="space-y-2 ts-body">
          {sheet.items.map((it, i) => (
            <li key={i} className="flex items-center gap-3">
              <Num n={i + 1} />
              <span className="w-28">{it.word}</span>
              <span className="font-bold w-32">{it.parts.join('-')}</span>
              {it.answerSigns.map((s, k) => <Glyph key={k} s={s} h={30} />)}
            </li>
          ))}
        </ol>
      );
    case 'numerals':
      return (
        <div className="ts-body space-y-3">
          <p><strong>A.</strong> {sheet.read.join(', ')}</p>
          <div className="flex flex-wrap items-end gap-6"><strong>B.</strong>
            {sheet.draw.map((n) => <span key={n} className="flex flex-col items-center gap-1"><Numeral value={n} size={34} /><span className="text-sm">{n}</span></span>)}
          </div>
        </div>
      );
    case 'blocks-number':
      return list(sheet.items.map((b) => blockAnswer(b, String(b.number))));
    case 'blocks-word':
      return <ol className="space-y-1 ts-body">{sheet.items.map((b, i) => <li key={b.id} className="flex gap-3"><Num n={i + 1} />{blockAnswer(b)}</li>)}</ol>;
  }
}

export default function SheetView({ sheet }: { sheet: Sheet }) {
  const hasKey = sheet.layout !== 'chart' && sheet.layout !== 'trace';
  return (
    <article className="ws-page ts-paper max-w-[820px] mx-auto px-8 py-8 print:px-1 print:py-0 print:max-w-none">
      <div className="flex items-end justify-between gap-6 pb-3 mb-4 ts-rule">
        <div>
          <p className="ts-label ts-kicker uppercase">Maya glyphs · Sheet {sheet.number} · {sheet.level}</p>
          <h2 className="ts-display text-[32px] leading-9 mt-1">{sheet.title}</h2>
        </div>
        <div className="ts-label ts-suave w-52 space-y-2 shrink-0">
          <div>Name<div className="ts-line h-5" /></div>
        </div>
      </div>
      <p className="ts-body mb-6 max-w-[62ch]">{sheet.intro}</p>
      <Body sheet={sheet} />
      {sheet.credits.length > 0 && (
        <div className="mt-6 pt-2 border-t ts-hair text-[10px] leading-snug ts-suave space-y-0.5">
          {sheet.credits.map((c) => <p key={c}>{CREDITS[c]}</p>)}
          <p>sourcelibrary.org/learn/maya/worksheets/{sheet.slug}</p>
        </div>
      )}
      {hasKey && (
        <section className="ws-key mt-12 pt-6 border-t-2 border-dashed ts-hair print:mt-0 print:pt-0 print:border-0">
          <p className="ts-label ts-kicker uppercase">Answer key · Sheet {sheet.number}</p>
          <h3 className="ts-display text-2xl mb-4 mt-1">{sheet.title}</h3>
          <Answers sheet={sheet} />
        </section>
      )}
    </article>
  );
}
