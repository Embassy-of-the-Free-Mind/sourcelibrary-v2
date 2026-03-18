import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'The Language That Created the World — Press — Source Library',
  description: 'The foundational texts of Jewish and Christian Kabbalah — including the Sefer Yetzirah, Kircher\'s Oedipus Aegyptiacus, and Reuchlin\'s De Arte Cabalistica — are now freely readable in English.',
};

export default function KabbalahPress() {
  return (
    <div className="min-h-screen bg-white">
      <header className="bg-stone-900 text-white py-16 md:py-24">
        <div className="max-w-5xl mx-auto px-6 md:px-12">
          <Link href="/press" className="text-accent-gold text-sm tracking-[0.2em] uppercase mb-4 inline-block hover:text-accent-gold transition-colors">
            &larr; Press
          </Link>
          <h1
            className="text-3xl md:text-4xl lg:text-5xl mb-6 font-display"
          >
            The Language That Created the World: AI Translates the Kabbalistic Texts That Shaped Renaissance Philosophy
          </h1>
          <p className="text-lg text-white/70 max-w-2xl font-body">
            The foundational texts of Jewish and Christian Kabbalah &mdash; including the Sefer Yetzirah, Kircher&apos;s Oedipus Aegyptiacus, and Reuchlin&apos;s De Arte Cabalistica &mdash; are now freely readable in English
          </p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 md:px-12 py-16">
        <p className="text-sm text-stone-500 uppercase tracking-wider mb-8">
          FOR IMMEDIATE RELEASE
        </p>

        <div className="prose prose-stone prose-lg max-w-none leading-relaxed space-y-6">
          <p>
            <strong>Amsterdam</strong> &mdash; In 1517, the same year Martin Luther nailed his theses to the door in Wittenberg, the German humanist Johannes Reuchlin published <em>De Arte Cabalistica</em> &mdash; a book arguing that the Jewish mystical tradition of Kabbalah held the key to understanding Christianity itself.
          </p>
          <p>
            It was an explosive claim. Reuchlin had already faced an Inquisition for defending Jewish books against destruction. His <em>De Arte Cabalistica</em> went further: it presented Kabbalistic ideas about the divine names of God, the emanation of creation through ten <em>sefirot</em>, and the mystical power of the Hebrew alphabet as the deepest wisdom available to humanity.
          </p>
          <p>
            This text, and the tradition it drew upon, is now freely accessible in English through{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">Source Library</a>, the AI-powered digital library created by the Embassy of the Free Mind in Amsterdam.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            What the Kabbalists Taught
          </h2>

          <p>
            The Kabbalistic tradition, rooted in medieval Jewish mysticism, proposed that reality emanated from a divine source called <em>Ein Sof</em> (the Infinite) through a series of ten emanations or attributes (<em>sefirot</em>). Language &mdash; specifically Hebrew &mdash; was not merely a way of describing reality but the instrument through which reality was created.
          </p>
          <p>
            The <em>Sefer Yetzirah</em> (Book of Formation), one of the oldest Kabbalistic texts, describes creation itself as a combinatorial explosion of Hebrew letters &mdash; anticipating modern mathematics by a millennium:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;Two stones build two houses, three stones build six houses, four stones build twenty-four houses, five stones build one hundred and twenty houses, six stones build seven hundred and twenty houses, and seven stones build five thousand and forty houses. From here onward, go and calculate what the mouth is unable to pronounce and the ear is unable to hear.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; <em>Sefer Yetzirah</em> (Book of Formation),{' '}
              <a href="https://sourcelibrary.org/book/69528666ab34727b1f04c966?page=59" className="text-accent-rust hover:text-accent-gold-dark">p. 59</a>
            </footer>
          </blockquote>

          <p>
            &ldquo;Stones&rdquo; are letters; &ldquo;houses&rdquo; are the words they form. The text is describing factorials &mdash; 2!, 3!, 4!, 5!, 6!, 7! &mdash; as the mathematics of divine creation. This is one of the earliest known discussions of combinatorial mathematics in any tradition.
          </p>

          <p>
            When Athanasius Kircher synthesized Kabbalistic thought with Egyptian and Greek philosophy in his <em>Oedipus Aegyptiacus</em> (1652), he wrestled with the Kabbalistic insight that the infinite God exceeds all categories &mdash; that unity itself is both the origin and end of all number:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;It is necessary in number to reach the minimum, than which nothing smaller can be; and this is unity: and since nothing smaller than unity can exist, this unity will be the absolute minimum, and thus will coincide with the absolute maximum.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Athanasius Kircher, <em>Oedipus Aegyptiacus</em> (1652),{' '}
              <a href="https://sourcelibrary.org/book/695273a1ab34727b1f049baf?page=13" className="text-accent-rust hover:text-accent-gold-dark">p. 13</a>
            </footer>
          </blockquote>

          <p>
            These ideas electrified Renaissance Europe. Giovanni Pico della Mirandola had introduced Kabbalah to Christian intellectuals in his famous <em>900 Theses</em> of 1486. Reuchlin systematized it in <em>De Arte Cabalistica</em> (1517). Together, they created the tradition of &ldquo;Christian Kabbalah&rdquo; that would influence thinkers from Cornelius Agrippa to Kircher to Leibniz.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            The Collection
          </h2>

          <p>
            Source Library&apos;s Kabbalistic holdings draw from the Bibliotheca Philosophica Hermetica&apos;s exceptional collection of Christian Kabbalistic texts:
          </p>

          <ul>
            <li>
              <strong>Reuchlin&apos;s <em>De Arte Cabalistica</em></strong> (1517) &mdash; the foundational text of Christian Kabbalah, presenting a dialogue between a Pythagorean philosopher, a Muslim, and a Kabbalist.
            </li>
            <li>
              <strong>Reuchlin&apos;s <em>De Verbo Mirifico</em></strong> (1494) &mdash; his earlier work on the miraculous power of the divine name, which first brought Kabbalistic ideas to a wide Christian audience.
            </li>
            <li>
              <strong>Knorr von Rosenroth&apos;s <em>Kabbala Denudata</em></strong> (1677&ndash;1684) &mdash; the massive Latin anthology that made key Zoharic texts available to Christian scholars for the first time.
            </li>
            <li>
              <strong>Athanasius Kircher&apos;s <em>Oedipus Aegyptiacus</em></strong> (1652&ndash;1654) &mdash; which placed Kabbalah within a grand synthesis of Egyptian, Greek, and Christian esoteric knowledge.
            </li>
          </ul>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            Why It Matters
          </h2>

          <p>
            &ldquo;The Kabbalistic tradition asks the most fundamental question you can ask about language,&rdquo; says the Source Library editorial team. &ldquo;Not &lsquo;What do words mean?&rsquo; but &lsquo;Do words make things real?&rsquo; In an era when AI systems are learning to generate language with unprecedented power, that question has never been more relevant.&rdquo;
          </p>
          <p>
            The <em>Sefer Yetzirah</em>&apos;s insight &mdash; that reality emerges from the combinatorial permutations of a finite set of symbols &mdash; is strikingly close to how modern computation works. The relationship between language and reality, between naming and creating, is central to both Kabbalistic thought and contemporary debates about artificial intelligence. When a large language model generates text that shapes human decisions and beliefs, is that fundamentally different from the Kabbalistic idea that divine speech creates the world?
          </p>
          <p>
            Source Library doesn&apos;t answer that question. It makes the original texts available so that anyone can engage with it.
          </p>

          <div className="mt-12 pt-8 border-t border-stone-200 space-y-2 text-stone-600">
            <p>
              <strong>Read the texts:</strong>{' '}
              <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org</a>
            </p>
            <p>
              <strong>Explore Kabbalah texts:</strong>{' '}
              <a href="https://sourcelibrary.org/search?q=kabbalah" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org/search?q=kabbalah</a>
            </p>
            <p>
              <strong>Press contact:</strong>{' '}
              <a href="mailto:press@sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">press@sourcelibrary.org</a>
            </p>
          </div>
        </div>
      </div>

      <footer className="bg-stone-900 text-white/60 py-8">
        <div className="max-w-5xl mx-auto px-6 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm">
          <span>&copy; {new Date().getFullYear()} Source Library &mdash; An initiative of the Embassy of the Free Mind</span>
          <Link href="/press" className="text-accent-gold/60 hover:text-accent-gold transition-colors">
            All Press Releases
          </Link>
        </div>
      </footer>
    </div>
  );
}
