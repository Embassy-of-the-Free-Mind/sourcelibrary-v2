import type { Metadata } from 'next';
import data from './provenance.json';

export const metadata: Metadata = {
  title: 'Deep Time: The First Images — prototype · Source Library',
  description:
    'A prototype gallery of Palaeolithic art — the oldest surviving images and sculptures made by human hands.',
  robots: { index: false, follow: false },
};

/**
 * PROTOTYPE ONLY — not linked from any public surface, noindex.
 *
 * Question being explored: does Palaeolithic art ("the deep time of human
 * image-making") belong in Source Library, and if so does the `artwork`
 * content-type / gallery visual language carry it?
 *
 * All metadata + provenance lives in ./provenance.json (single source of truth,
 * models how these would be stored as content_type:'artwork' DB entries). Images
 * are self-hosted on R2 (prototype/prehistoric-art/<id>.jpg), mirrored from Don
 * Hitchcock's donsmaps.com (photographs CC BY 4.0). Mirror script:
 * scripts/_tmp_mirror_prehistoric.mjs. The depicted objects are public domain
 * by age. If this graduates, source from museum open-access / Wikimedia for
 * cleaner provenance; Don's Maps stays the index, not the import target.
 */

const D = data.defaults;
const imgUrl = (id: string) => `${D.r2Base}/${id}.jpg`;

type Work = (typeof data.works)[number];

function Card({ a }: { a: Work }) {
  return (
    <figure className="group flex flex-col overflow-hidden rounded-xl bg-[#161412] ring-1 ring-white/10 transition-all hover:ring-white/25">
      <div className="relative aspect-[4/3] overflow-hidden bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgUrl(a.id)}
          alt={a.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/80 backdrop-blur">
          {a.period}
        </span>
      </div>
      <figcaption className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-lg text-stone-100">{a.title}</h3>
          <span className="shrink-0 font-mono text-xs tabular-nums text-amber-300/70">
            {a.date}
          </span>
        </div>
        <p className="mt-1 text-xs text-stone-500">
          {a.site} · {a.medium}
          {a.dimensions ? ` · ${a.dimensions}` : ''}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-stone-400">{a.blurb}</p>
        <p className="mt-3 text-[11px] uppercase tracking-wide text-stone-600">
          {a.museum}
        </p>

        {/* Provenance footer */}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.06] pt-3 text-[11px] text-stone-500">
          <a
            href={a.object.reference}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-stone-700 underline-offset-2 hover:text-stone-300"
          >
            Reference
          </a>
          <a
            href={a.image.documentationPage}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-stone-700 underline-offset-2 hover:text-stone-300"
          >
            Source
          </a>
          <span className="text-stone-600">
            Photo: {D.photographer} · CC BY 4.0
          </span>
        </div>
      </figcaption>
    </figure>
  );
}

export default function PrehistoricArtPrototype() {
  const works = data.works as Work[];
  const figurines = works.filter((w) => w.category === 'figurine');
  const caves = works.filter((w) => w.category === 'cave-painting');

  return (
    <div className="min-h-screen bg-[#0d0c0b] text-stone-200">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
        {/* Prototype banner */}
        <div className="mb-10 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-200/80">
          <span className="font-semibold text-amber-200">Prototype</span> — not
          public, not indexed. Exploring whether Palaeolithic art belongs in
          Source Library. Images © Don Hitchcock,{' '}
          <a
            href={D.photographerSite}
            className="underline hover:text-amber-100"
            target="_blank"
            rel="noopener noreferrer"
          >
            donsmaps.com
          </a>
          , reused under CC BY 4.0; depicted objects are public domain by age.
        </div>

        {/* Header */}
        <header className="mb-12 max-w-2xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
            The deep time of human image-making
          </p>
          <h1 className="font-serif text-4xl leading-tight text-stone-100 sm:text-5xl">
            Deep Time: The First Images
          </h1>
          <p className="mt-5 text-base leading-relaxed text-stone-400">
            Before writing, before the city, before the wheel — people carved
            faces, bodies, and impossible beings from ivory and stone, and
            painted living animals across the walls of caves. These are among
            the oldest surviving works of human imagination, made across forty
            thousand years of the last ice age. Source Library is built around
            the read-and-quote experience of historical texts; this asks what it
            would mean to hold the images that came before any text at all.
          </p>
        </header>

        {/* Carved figures */}
        <section className="mb-16">
          <h2 className="mb-1 font-serif text-2xl text-stone-100">
            Carved figures
          </h2>
          <p className="mb-6 text-sm text-stone-500">
            Ivory, stone and fired clay — the oldest sculptures in the world.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {figurines.map((a) => (
              <Card key={a.id} a={a} />
            ))}
          </div>
        </section>

        {/* Painted caves */}
        <section className="mb-4">
          <h2 className="mb-1 font-serif text-2xl text-stone-100">
            The painted caves
          </h2>
          <p className="mb-6 text-sm text-stone-500">
            Animals and signs drawn by firelight, deep underground.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {caves.map((a) => (
              <Card key={a.id} a={a} />
            ))}
          </div>
        </section>

        {/* Footer / provenance note */}
        <footer className="mt-14 border-t border-white/10 pt-6 text-sm text-stone-500">
          <p>
            {works.length} works. All photographs by {D.photographer}, mirrored
            with attribution under{' '}
            <a
              href={D.licenseUrl}
              className="underline hover:text-stone-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              CC BY 4.0
            </a>{' '}
            from{' '}
            <a
              href={D.photographerSite}
              className="underline hover:text-stone-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              Don’s Maps
            </a>
            , a remarkable independent archive of Palaeolithic archaeology. Each
            card links to the object’s encyclopaedia entry (“Reference”) and the
            donsmaps documentation page (“Source”). The artefacts and paintings
            depicted are public domain by virtue of age. Full machine-readable
            provenance: <code className="text-stone-400">provenance.json</code>.
          </p>
        </footer>
      </div>
    </div>
  );
}
