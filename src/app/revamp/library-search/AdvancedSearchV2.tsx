'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import FilterChips from '@/components/search-kit/FilterChips';
import { pill } from '@/components/search-kit/controls';
import { WAYS } from '../_components/IdeaDiagram';

export type Opt = { value: string; label: string };
type Group = { label: string; options: Opt[] };

const input = 'w-full h-10 border border-border-medium bg-white px-3 text-base text-primary focus:outline-none focus:border-primary';
const label = 'block text-[13px] font-semibold text-primary mb-1.5';
const hint = 'font-normal text-muted';
const colour = (k: string) => WAYS.find((w) => w.key === k)!.color;
type LangLook = 'menu' | 'type' | 'pills';

/** One way in: a coloured heading with its question, then its fields. */
function Block({ way, children, note }: { way: string; children: React.ReactNode; note?: string }) {
  const w = WAYS.find((x) => x.key === way)!;
  return (
    <fieldset className="border-t-[3px] pt-3" style={{ borderColor: w.color }}>
      <legend className="sr-only">{w.label}</legend>
      <p className="text-[15px] font-semibold mb-0.5" style={{ color: w.color }}>{w.label} <span className="font-normal text-muted text-[13px]">{w.q}</span></p>
      {note && <p className="text-[12px] text-muted mb-2">{note}</p>}
      <div className="space-y-3 mt-2">{children}</div>
    </fieldset>
  );
}

export default function AdvancedSearchV2({ subjectGroups, centuries, languages, kinds, forms, places }: {
  subjectGroups: Group[]; centuries: (Opt & { from: number; count: number })[]; languages: (Opt & { count: number })[]; kinds: Opt[]; forms: Opt[]; places: Group[];
}) {
  const [look, setLook] = useState<LangLook>('type');
  const [q, setQ] = useState(''); const [title, setTitle] = useState(''); const [author, setAuthor] = useState(''); const [not, setNot] = useState('');
  const [subject, setSubject] = useState(''); const [w1, setW1] = useState(''); const [w2, setW2] = useState('');
  const [m1, setM1] = useState(''); const [m2, setM2] = useState(''); const [place, setPlace] = useState(''); const [printedIn, setPrintedIn] = useState('');
  const [langs, setLangs] = useState<string[]>([]); const [langQ, setLangQ] = useState('');
  const [kind, setKind] = useState(''); const [form, setForm] = useState(''); const [tr, setTr] = useState(false); const [ft, setFt] = useState(false);

  const subjLabel = (v: string) => subjectGroups.flatMap((g) => g.options).find((o) => o.value === v)?.label;
  const cLabel = (v: string) => centuries.find((c) => c.value === v)?.label;
  const placeLabel = (v: string) => places.flatMap((g) => g.options).find((o) => o.value === v)?.label;
  const chips = [
    q && { key: 'q', label: `“${q}”` }, title && { key: 'title', label: `Title: ${title}` }, author && { key: 'author', label: `Author: ${author}` }, not && { key: 'not', label: `Leave out: ${not}` },
    subject && { key: 'subject', label: `Subject: ${subjLabel(subject)}` },
    (w1 || w2) && { key: 'written', label: `Written: ${cLabel(w1) ?? 'any'} to ${cLabel(w2) ?? 'any'}` },
    (m1 || m2) && { key: 'made', label: `Printed: ${m1 || '…'}–${m2 || '…'}` },
    place && { key: 'place', label: `From: ${placeLabel(place)}` }, printedIn && { key: 'printedIn', label: `Printed in: ${printedIn}` },
    ...langs.map((l) => ({ key: `lang:${l}`, label: `Language: ${l}` })),
    kind && { key: 'kind', label: `Kind: ${kinds.find((k) => k.value === kind)?.label}` }, form && { key: 'form', label: `Written on: ${forms.find((f) => f.value === form)?.label}` },
    tr && { key: 'tr', label: 'Translated into English' }, ft && { key: 'ft', label: 'First translations' },
  ].filter(Boolean) as { key: string; label: string }[];
  const clear = (k: string) => {
    const f: Record<string, () => void> = { q: () => setQ(''), title: () => setTitle(''), author: () => setAuthor(''), not: () => setNot(''), subject: () => setSubject(''), written: () => { setW1(''); setW2(''); }, made: () => { setM1(''); setM2(''); }, place: () => setPlace(''), printedIn: () => setPrintedIn(''), kind: () => setKind(''), form: () => setForm(''), tr: () => setTr(false), ft: () => setFt(false) };
    if (k.startsWith('lang:')) setLangs(langs.filter((l) => l !== k.slice(5))); else f[k]?.();
  };
  const toggleLang = (l: string) => setLangs(langs.includes(l) ? langs.filter((x) => x !== l) : [...langs, l]);
  const matches = useMemo(() => (langQ.trim() ? languages.filter((l) => l.label.toLowerCase().includes(langQ.trim().toLowerCase())).slice(0, 8) : []), [langQ, languages]);
  const top = languages.slice(0, 8);
  const maxC = Math.max(1, ...centuries.map((c) => c.count));

  const languageField = (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="sr-only" htmlFor="lang">Language of this copy</label>
      </div>
      {look === 'menu' && (
        <select id="lang" className={input} value={langs[0] ?? ''} onChange={(e) => setLangs(e.target.value ? [e.target.value] : [])}>
          <option value="">Any language</option>
          {languages.map((l) => <option key={l.value} value={l.value}>{l.label} ({l.count.toLocaleString('en-GB')})</option>)}
        </select>
      )}
      {look === 'type' && (
        <div>
          <div className="flex flex-wrap gap-1.5 mb-2">{top.map((l) => <button key={l.value} type="button" aria-pressed={langs.includes(l.value)} onClick={() => toggleLang(l.value)} className={pill(langs.includes(l.value))}>{l.label}</button>)}</div>
          <div className="relative">
            <input id="lang" className={input} placeholder={`Another of ${languages.length} languages…`} value={langQ} onChange={(e) => setLangQ(e.target.value)} />
            {matches.length > 0 && (
              <ul className="absolute z-10 left-0 right-0 top-full bg-white border border-border-medium border-t-0 max-h-60 overflow-auto">
                {matches.map((l) => <li key={l.value}><button type="button" onClick={() => { toggleLang(l.value); setLangQ(''); }} className="w-full text-left px-3 py-2 text-[14.5px] hover:bg-warm flex justify-between"><span>{l.label}</span><span className="text-muted tabular-nums">{l.count.toLocaleString('en-GB')}</span></button></li>)}
              </ul>
            )}
          </div>
        </div>
      )}
      {look === 'pills' && (
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">{languages.map((l) => <button key={l.value} type="button" aria-pressed={langs.includes(l.value)} onClick={() => toggleLang(l.value)} className={pill(langs.includes(l.value))}>{l.label}</button>)}</div>
      )}
    </div>
  );

  return (
    <>
      <div className="border border-dashed border-border-medium bg-white px-4 py-3 mb-6 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted mr-1">Prototype only. Language as:</span>
        {([['type', 'A: common ones + type to find'], ['menu', 'B: dropdown'], ['pills', 'C: every language as a button (today)']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={look === k} onClick={() => setLook(k)} className={pill(look === k)}>{l}</button>)}
      </div>

      <form onSubmit={(e) => e.preventDefault()} className="border-y border-border-light py-6" autoComplete="off">
        {/* Words first: what most people type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-4 mb-8">
          <div><label className={label} htmlFor="q">Keywords <span className={hint}>title or author</span></label><input id="q" className={input} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div><label className={label} htmlFor="title">Title contains</label><input id="title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label className={label} htmlFor="author">Author</label><input id="author" className={input} value={author} onChange={(e) => setAuthor(e.target.value)} /></div>
          <div><label className={label} htmlFor="not">Leave out</label><input id="not" className={input} value={not} onChange={(e) => setNot(e.target.value)} /></div>
        </div>

        {/* The five ways in, each with its colour and question */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-10 gap-y-9">
          <Block way="subject">
            <div><label className="sr-only" htmlFor="subject">Subject</label>
              <select id="subject" className={input} value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Any subject</option>
                {subjectGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
              </select>
            </div>
          </Block>
          <Block way="time">
            <div><span className={label}>Written <span className={hint}>the original</span></span>
              <div className="flex items-end gap-[2px] h-10 mb-2" aria-hidden>{centuries.map((c) => {
                const i = centuries.findIndex((x) => x.value === c.value), a = centuries.findIndex((x) => x.value === w1), z = centuries.findIndex((x) => x.value === w2);
                const on = (w1 || w2) && (a < 0 || i >= a) && (z < 0 || i <= z);
                return <span key={c.value} className="flex-1" style={{ height: `${Math.max(2, Math.round(40 * Math.sqrt(c.count / maxC)))}px`, background: on ? colour('time') : '#d9d2c6' }} />;
              })}</div>
              <div className="flex items-center gap-2">
                <select aria-label="Written from" className={input} value={w1} onChange={(e) => setW1(e.target.value)}><option value="">From</option>{centuries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
                <span className="text-muted">to</span>
                <select aria-label="Written to" className={input} value={w2} onChange={(e) => setW2(e.target.value)}><option value="">To</option>{centuries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              </div>
            </div>
            <div><span className={label}>Printed <span className={hint}>this copy, years</span></span>
              <div className="flex items-center gap-2">
                <input aria-label="Printed from" inputMode="numeric" placeholder="From" className={input} value={m1} onChange={(e) => setM1(e.target.value)} />
                <span className="text-muted">to</span>
                <input aria-label="Printed to" inputMode="numeric" placeholder="To" className={input} value={m2} onChange={(e) => setM2(e.target.value)} />
              </div>
            </div>
          </Block>
          <Block way="place" note="Not recorded yet: comes with the catalogue round.">
            <div><label className={label} htmlFor="place">Comes from</label>
              <select id="place" className={input} value={place} onChange={(e) => setPlace(e.target.value)}>
                <option value="">Anywhere</option>
                {places.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
              </select>
            </div>
            <div><label className={label} htmlFor="printedIn">Printed in <span className={hint}>town or city</span></label><input id="printedIn" className={input} value={printedIn} onChange={(e) => setPrintedIn(e.target.value)} placeholder="Venice, Basel…" /></div>
          </Block>
          <Block way="language">{languageField}</Block>
          <Block way="type">
            <div><label className={label} htmlFor="kind">Kind of writing</label>
              <select id="kind" className={input} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Any kind</option>{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            </div>
            <div><label className={label} htmlFor="form">Written on <span className={hint}>not recorded yet</span></label>
              <select id="form" className={input} value={form} onChange={(e) => setForm(e.target.value)}><option value="">Anything</option>{forms.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            </div>
          </Block>
        </div>

        <div className="flex flex-wrap gap-6 items-center mt-8 pt-5 border-t border-border-light">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4" checked={tr} onChange={(e) => setTr(e.target.checked)} />Translated into English</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4" checked={ft} onChange={(e) => setFt(e.target.checked)} />First translations only</label>
          <div className="ml-auto flex items-center gap-3">
            {chips.length > 0 && <button type="button" onClick={() => chips.forEach((c) => clear(c.key))} className="text-[13.5px] text-muted underline underline-offset-[3px] inline-flex items-center gap-1"><X className="w-3.5 h-3.5" />Clear all</button>}
            <button type="submit" className="h-11 px-6 bg-primary text-cream text-sm font-medium">Show results</button>
          </div>
        </div>
      </form>

      <div className="mt-5 min-h-8"><FilterChips chips={chips} onRemove={clear} onClearAll={() => chips.forEach((c) => clear(c.key))} /></div>
    </>
  );
}
