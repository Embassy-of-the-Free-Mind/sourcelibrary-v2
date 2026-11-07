import type { ReactNode } from 'react';
import type { WorkRecord } from '@/lib/work-record';
import { PrList } from './PrList';
import { WorkBrowser } from './WorkBrowser';

const REPO = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
const LINK = 'text-accent-rust hover:underline';
const HEADING = 'font-sans !font-bold tracking-tight text-stone-950';

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-8 min-w-0 scroll-mt-6">
      <h2 className={`${HEADING} text-4xl md:text-5xl`}>{title}</h2>
      {children}
    </section>
  );
}

export function WorkRecordView({ record }: { record: WorkRecord }) {
  return (
    <main className="max-w-7xl mx-auto px-4 py-10 grid gap-16">
      <header className="grid gap-2">
        <h1 className={`${HEADING} text-5xl md:text-6xl`}>{record.name}&apos;s work</h1>
        <p className="text-lg text-stone-700 max-w-2xl leading-relaxed">{record.intro}</p>
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-500">
          <span>Updated {record.updated}</span>
          <a href="#prs" className={LINK}>Every pull request ({record.prs.length})</a>
          <a href="#limits" className={LINK}>What this leaves out</a>
        </p>
      </header>

      <WorkBrowser items={record.items} repo={REPO} />

      <Part id="prs" title="Every pull request">
        <PrList prs={record.prs} repo={REPO} />
      </Part>

      <Part id="limits" title="What this leaves out">
        <ul className="grid gap-2 text-base text-stone-800 list-disc pl-5 max-w-2xl leading-relaxed">
          {record.limits.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </Part>
    </main>
  );
}
