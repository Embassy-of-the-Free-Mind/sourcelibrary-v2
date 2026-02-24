import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'The Mystic Who Discovered Planetary Motion — Press — Source Library',
  description: 'Source Library\'s AI translation of Kepler\'s Astronomia Nova reveals how mystical convictions about cosmic harmony produced the laws of planetary motion.',
};

export default function OriginsOfSciencePress() {
  return (
    <div className="min-h-screen bg-white">
      <header className="bg-stone-900 text-white py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-6 md:px-12">
          <Link href="/press" className="text-accent-gold text-sm tracking-[0.2em] uppercase mb-4 inline-block hover:text-accent-gold transition-colors">
            &larr; Press
          </Link>
          <h1
            className="text-3xl md:text-4xl lg:text-5xl mb-6 font-display"
          >
            The Mystic Who Discovered Planetary Motion: How Kepler&apos;s Occult Beliefs Led to Modern Astronomy
          </h1>
          <p className="text-lg text-white/70 max-w-2xl font-body">
            Source Library&apos;s AI translation of Kepler&apos;s Astronomia Nova reveals how mystical convictions about cosmic harmony produced the laws of planetary motion
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 md:px-12 py-16">
        <p className="text-sm text-stone-500 uppercase tracking-wider mb-8">
          FOR IMMEDIATE RELEASE
        </p>

        <div className="prose prose-stone prose-lg max-w-none leading-relaxed space-y-6">
          <p>
            <strong>Amsterdam</strong> &mdash; In 1609, Johannes Kepler published <em>Astronomia Nova</em> &mdash; the book that established that planets move in ellipses, not circles. It was one of the most important scientific discoveries in history, the foundation of modern astronomy and celestial mechanics.
          </p>
          <p>
            What most people don&apos;t know is why Kepler was looking for ellipses in the first place. He believed the planets were alive.
          </p>
          <p>
            From Kepler&apos;s <em>Astronomia Nova</em> (1609), now fully translated on{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">Source Library</a> in 388 pages of AI-assisted translation from Latin, here is Kepler defining gravity &mdash; not as a property of objects falling toward the center of the Earth, but as a mutual attraction between bodies. Eighty years before Newton:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;Gravity is a mutual material tendency between related bodies toward union or conjunction (of the same order of things as the magnetic faculty), such that the Earth attracts a stone much more than the stone seeks the Earth... If two stones were placed in some location in the world near each other, outside the sphere of influence of a third related body, those stones would come together at an intermediate place, much like two magnetic bodies; each would approach the other by a distance proportional to the other&apos;s mass.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Johannes Kepler, <em>Astronomia Nova</em> (1609),{' '}
              <a href="https://sourcelibrary.org/book/31f2d90a-88af-4414-a445-68406caca58d?page=25" className="text-accent-rust hover:text-accent-gold-dark">p. 25</a>
            </footer>
          </blockquote>

          <p>
            And in his summary of the chapters, the kernel of what would become the inverse-square law:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;It is demonstrated that the Moving Power behaves exactly like Light: it occupies space, is weakened over a larger area, and is concentrated in a smaller one.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Kepler, <em>Astronomia Nova</em>,{' '}
              <a href="https://sourcelibrary.org/book/31f2d90a-88af-4414-a445-68406caca58d?page=37" className="text-accent-rust hover:text-accent-gold-dark">p. 37</a>
            </footer>
          </blockquote>

          <p>
            Kepler described planets as having both an <em>&ldquo;animal faculty&rdquo;</em> &mdash; an internal guiding intelligence &mdash; and a <em>&ldquo;magnetic faculty&rdquo;</em> &mdash; a physical interaction with the Sun. His breakthrough was not to abandon the mystical framework but to mathematize it: to ask what shape an orbit would take if a planet were simultaneously drawn toward the Sun and guided by its own internal nature.
          </p>
          <p>
            The answer was an ellipse. And with that answer, Kepler&apos;s mysticism became Newton&apos;s physics.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            The Scientists Who Believed in Magic
          </h2>

          <p>
            Source Library&apos;s collection reveals that the line between &ldquo;science&rdquo; and &ldquo;occultism&rdquo; is a modern invention. The same thinkers who built the foundations of modern science were deeply embedded in traditions of Hermeticism, alchemy, and natural magic:
          </p>

          <ul>
            <li>
              <strong>Johannes Kepler</strong> (<em>Astronomia Nova</em>, 1609; <em>Dioptrice</em>, 1611) &mdash; 514 pages of Kepler&apos;s foundational works, fully translated. His optics and astronomy emerged from a Neoplatonic conviction that the universe was structured by divine mathematical harmonies.
            </li>
            <li>
              <strong>Robert Fludd</strong> (<em>Utriusque Cosmi Historia</em>, 1617; <em>Mosaicall Philosophy</em>, 1659) &mdash; Fludd&apos;s encyclopedic work on the macrocosm and microcosm includes extraordinary engravings showing the musical harmonies of the cosmos. His <em>Mosaicall Philosophy</em> articulates the <em>Anima Mundi</em> &mdash; the soul of the world:
            </li>
          </ul>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;They say that within all things are moved by a soul, by which they believe all things in the world live... there must be an intermediate spirit. This they call neither body nor soul, but a middle substance, participating in both, which brings these two extremes back into one.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Robert Fludd, <em>Mosaicall Philosophy</em> (1659),{' '}
              <a href="https://sourcelibrary.org/book/6952722bab34727b1f047e18?page=55" className="text-accent-rust hover:text-accent-gold-dark">p. 55</a>
            </footer>
          </blockquote>

          <ul>
            <li>
              <strong>Athanasius Kircher</strong> (<em>Ars Magna Lucis et Umbrae</em>, 1646; <em>Musurgia Universalis</em>, 1650; <em>Mundus Subterraneus</em>, 1665) &mdash; Kircher investigated magnetism, optics, acoustics, geology, and Egyptology with equal rigor. In his <em>Musurgia Universalis</em>, he argued that musical harmony was not a human invention but the fundamental structure of nature:
            </li>
          </ul>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;Trees of different sizes, between which there is a harmonic proportion, emit a harmonious sound when moved by the wind.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Athanasius Kircher, <em>Musurgia Universalis</em> (1650),{' '}
              <a href="https://sourcelibrary.org/book/69520516ab34727b1f04245b?page=46" className="text-accent-rust hover:text-accent-gold-dark">p. 46</a>
            </footer>
          </blockquote>

          <ul>
            <li>
              <strong>Giambattista della Porta</strong> (<em>Magia Naturalis</em>, 1558) &mdash; Della Porta&apos;s &ldquo;natural magic&rdquo; was essentially experimental physics under another name: optics, magnetism, hydraulics, and chemistry presented as the art of understanding nature&apos;s hidden operations.
            </li>
          </ul>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            The Missing Chapter
          </h2>

          <p>
            &ldquo;Every history of the Scientific Revolution acknowledges that Kepler, Newton, Boyle, and Leibniz were deeply involved in traditions we now call &lsquo;occult,&rsquo;&rdquo; says the Source Library editorial team. &ldquo;But you can&apos;t really understand what that means until you read their actual words. These aren&apos;t embarrassing footnotes. They&apos;re the intellectual engine of modern science.&rdquo;
          </p>
          <p>
            Source Library makes these primary sources freely available for the first time &mdash; not as curated excerpts in academic publications, but as complete works with AI translations alongside the original Latin, German, and Italian texts.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            Open for Discovery
          </h2>

          <p>
            All books in the collection are freely available at{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org</a>. The full corpus &mdash; translations, original texts, and page images &mdash; is released as open data under a Creative Commons license.
          </p>
          <p>
            &ldquo;Kepler didn&apos;t discover planetary motion despite his mysticism,&rdquo; says the Source Library team. &ldquo;He discovered it because of his mysticism. That&apos;s a fact that should inform how we think about the relationship between science and other ways of knowing &mdash; including the ones we&apos;re building into AI.&rdquo;
          </p>

          <div className="mt-12 pt-8 border-t border-stone-200 space-y-2 text-stone-600">
            <p>
              <strong>Read the texts:</strong>{' '}
              <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org</a>
            </p>
            <p>
              <strong>Read Kepler&apos;s Astronomia Nova:</strong>{' '}
              <a href="https://sourcelibrary.org/book/31f2d90a-88af-4414-a445-68406caca58d" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org/book/31f2d90a-88af...</a>
            </p>
            <p>
              <strong>Press contact:</strong>{' '}
              <a href="mailto:press@sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">press@sourcelibrary.org</a>
            </p>
          </div>
        </div>
      </div>

      <footer className="bg-stone-900 text-white/60 py-8">
        <div className="max-w-4xl mx-auto px-6 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm">
          <span>&copy; {new Date().getFullYear()} Source Library &mdash; An initiative of the Embassy of the Free Mind</span>
          <Link href="/press" className="text-accent-gold/60 hover:text-accent-gold transition-colors">
            All Press Releases
          </Link>
        </div>
      </footer>
    </div>
  );
}
