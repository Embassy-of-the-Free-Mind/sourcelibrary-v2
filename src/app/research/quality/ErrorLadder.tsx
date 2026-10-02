/**
 * ErrorLadder — what a character error rate or a judge rating looks like on a real page (#5576).
 *
 * PRIOR ART: page.tsx SPECIMENS / ScanCrop (one scan crop beside transcription and English, for
 * defect types). This shows LEVELS instead: one page per OCR error rate and per judge rating, with
 * the differing characters marked. Data and provenance: src/data/quality-error-ladder.json; method:
 * scripts/eval/experiments/2026-10-01-error-ladder-5576.md. Server component; no client state.
 */
import type { ReactNode } from 'react';
import ladder from '@/data/quality-error-ladder.json';

export type Kind = 'same' | 'wrong' | 'missing' | 'variant' | 'invented';
export type Seg = { text: string; kind: string };
type Crop = { x: number; y: number; w: number; h: number };
type Scan = { image: string; size: number[]; crop: Crop; alt: string };

/** Shared with /research/page-errors (its specimens use the same marks). */
export const KIND_CLASS: Record<Kind, string> = {
  same: '',
  wrong: 'text-accent-rust font-semibold underline decoration-2 underline-offset-4',
  missing: 'bg-amber-100 text-primary line-through decoration-accent-rust decoration-2',
  variant: 'underline decoration-dotted decoration-2 underline-offset-4 decoration-gray-400',
  invented: 'text-accent-rust bg-amber-50 underline decoration-wavy decoration-1 underline-offset-4',
};

export function Segments({ segs, lang, dir }: { segs: Seg[]; lang?: string; dir?: string }) {
  return (
    <p lang={lang} dir={dir} className="text-secondary text-sm leading-relaxed break-words">
      {segs.map((s, i) => (
        <span key={i} className={KIND_CLASS[(s.kind as Kind)] ?? ''}>{s.text}</span>
      ))}
    </p>
  );
}

function Crop({ s }: { s: Scan }) {
  const { x, y, w, h } = s.crop;
  const W = s.size[0];
  const vertical = h > w;
  return (
    <div className={vertical ? 'w-16 sm:w-20' : 'w-full'}>
      <div className="relative overflow-hidden rounded border border-light bg-white" style={{ aspectRatio: `${w} / ${h}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={s.image}
          alt={s.alt}
          loading="lazy"
          className="absolute max-w-none"
          style={{ width: `${(W / w) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-xs uppercase tracking-wider text-muted mb-1.5">{children}</div>;
}

function Legend() {
  const items: [Kind, string, string][] = [
    ['wrong', 'abc', 'misread: the scan shows something else'],
    ['missing', 'abc', 'on the page, missing from the output'],
    ['variant', 'abc', 'differs from the reference, but the scan agrees with the output'],
    ['invented', 'abc', 'in the English, not on the page'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted mb-6">
      {items.map(([k, sample, text]) => (
        <li key={k}><span className={`${KIND_CLASS[k]} text-sm`}>{sample}</span> {text}</li>
      ))}
    </ul>
  );
}

function Rung({ level, title, href, children, scan, credit }: {
  level: string; title: string; href: string; children: ReactNode; scan: Scan; credit?: { text: string; href: string };
}) {
  const vertical = scan.crop.h > scan.crop.w;
  return (
    <div className="border-t border-light pt-5 mt-5 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3">
        <span className="text-2xl text-primary font-semibold tabular-nums">{level}</span>
        <a href={href} className="text-sm text-accent-rust hover:underline">{title}</a>
      </div>
      <div className={vertical ? 'grid grid-cols-[auto_1fr] gap-4' : 'grid gap-4'}>
        <div>
          <Label>Scan</Label>
          <Crop s={scan} />
        </div>
        <div className="min-w-0">{children}</div>
      </div>
      {credit && (
        <p className="text-xs text-muted mt-2">
          <a href={credit.href} className="hover:underline">{credit.text}</a>
        </p>
      )}
    </div>
  );
}

export default function ErrorLadder() {
  return (
    <div>
      <h3 className="text-lg text-primary font-semibold mb-2">What an error rate looks like</h3>
      <p className="text-secondary leading-relaxed mb-4">
        Each rung is one real page from our benchmark, read by the engine we use in production. The excerpt shows the
        reference text and the engine&rsquo;s read, with the differences marked. We checked every excerpt against the scan
        by eye. The percentage is the measured character error rate for the whole page; the excerpt is a few lines of it.
      </p>
      <Legend />

      {ladder.ocr.map(r => (
        <Rung key={r.key} level={r.level} title={r.book} href={r.href} scan={r} credit={r.credit}>
          <div className="text-xs text-muted mb-3">{r.language} &middot; {r.script}{r.year ? ` · ${r.year}` : ''}</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Reference</Label>
              <Segments segs={r.reference} dir={'dir' in r ? (r as { dir?: string }).dir : undefined} />
              <p className="text-xs text-muted mt-1">{r.reference_source}</p>
            </div>
            <div>
              <Label>Engine read</Label>
              <Segments segs={r.engine} dir={'dir' in r ? (r as { dir?: string }).dir : undefined} />
            </div>
          </div>
          <p className="text-sm text-muted leading-relaxed mt-3">{r.note}</p>
          <p className="text-sm text-primary leading-relaxed mt-2"><span className="font-semibold">What this level allows.</span> {r.allows}</p>
        </Rung>
      ))}

      <h3 className="text-lg text-primary font-semibold mt-10 mb-2">What a judge rating looks like</h3>
      <p className="text-secondary leading-relaxed mb-4">
        One served page for each rating from 5 to 2, from the audit of 30 September 2026. The marks show the defect the
        judge named.
      </p>
      {ladder.translation.map(r => (
        <Rung key={r.key} level={`${r.rating} of 5`} title={r.book} href={r.href} scan={r} credit={r.credit}>
          <div className="text-xs text-muted mb-3">{r.language} &middot; {r.year}</div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Transcription</Label>
              <Segments segs={r.transcription} lang={r.transcriptionLang} />
            </div>
            <div>
              <Label>English</Label>
              <Segments segs={r.english} lang="en" />
            </div>
          </div>
          <p className="text-sm text-muted leading-relaxed mt-3"><span className="font-semibold">Judge.</span> {r.defect}</p>
          <p className="text-sm text-primary leading-relaxed mt-2"><span className="font-semibold">What this level allows.</span> {r.allows}</p>
        </Rung>
      ))}

      <h3 className="text-lg text-primary font-semibold mt-10 mb-2">What is acceptable</h3>
      <p className="text-secondary leading-relaxed mb-3">
        At 0.5% the Latin page can be quoted as it stands; the one difference is a spelling convention. At 2% the Hebrew
        page reads well, but a word lost at a line end changes a verse, so a quotation needs the scan. At 4% the Armenian
        differences in our excerpt are old spellings, not misreads. At 10% a Chinese reader follows the sense, but a rare
        character in a name is wrong. At 18% the Greek has non-words, and it is a finding aid, not a text. For translation,
        pages rated 4 or 5 can be read as working translations; a 3 gives the gist with real errors; a 2 cannot be used
        without the original.
      </p>
      <p className="text-secondary leading-relaxed mb-3">
        These lines agree with a convention from newspaper digitisation. Holley (2009) gives working bands of good OCR at
        98&ndash;99% accuracy (1&ndash;2% incorrect), average at 90&ndash;98%, and poor below 90%. She also notes that
        there was no consensus on whether such figures meant characters or words. Our rates are characters.
      </p>
      <p className="text-secondary leading-relaxed">
        Two cautions. A measured rate includes the reference&rsquo;s own spellings and edition differences, so on the
        Armenian and Chinese pages the real misreading is lower than the number. And one error can matter more than many:
        the Hebrew page scores 2% because of one dropped word, &ldquo;let there be&rdquo;.
      </p>
      <p className="text-xs text-muted mt-3">
        Holley, R. (2009). How Good Can It Get? Analysing and Improving OCR Accuracy in Large Scale Historic Newspaper
        Digitisation Programs. <em>D-Lib Magazine</em> 15(3/4).{' '}
        <a href="https://www.dlib.org/dlib/march09/holley/03holley.html" className="text-accent-rust hover:underline">dlib.org</a>
      </p>
    </div>
  );
}
