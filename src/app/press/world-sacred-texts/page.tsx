import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '30 Traditions, One Library — Press — Source Library',
  description: 'Source Library expands beyond Europe with the world\'s sacred and esoteric texts — Buddhist, Hindu, Sufi, Daoist, Indigenous, and other wisdom traditions.',
};

export default function WorldSacredTextsPress() {
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
            30 Traditions, One Library: Source Library Expands Beyond Europe with the World&apos;s Sacred and Esoteric Texts
          </h1>
          <p className="text-lg text-white/70 max-w-2xl font-body">
            A major acquisition brings 193 books from Buddhist, Hindu, Sufi, Daoist, Indigenous, and other wisdom traditions into the open-access digital library
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 md:px-12 py-16">
        <p className="text-sm text-stone-500 uppercase tracking-wider mb-8">
          FOR IMMEDIATE RELEASE
        </p>

        <div className="prose prose-stone prose-lg max-w-none leading-relaxed space-y-6">
          <p>
            <strong>Amsterdam</strong> &mdash;{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">Source Library</a>, the AI-powered digital library created by the Embassy of the Free Mind, has expanded its collection beyond the Western esoteric tradition to encompass sacred and philosophical texts from more than 30 world traditions.
          </p>
          <p>
            The expansion adds 193 books comprising approximately 127,000 pages to the collection, drawn from libraries and archives around the world. For the first time, texts from Buddhist, Hindu, Sufi, Daoist, Shinto, Zoroastrian, Indigenous American, African, and other traditions are being made available alongside the European Hermetic, alchemical, and Kabbalistic texts that form Source Library&apos;s core.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            What the Texts Say
          </h2>

          <p>
            The power of this expansion lies not in the catalogue but in the voices. For the first time, AI translation makes these texts speak directly:
          </p>
          <p>
            From the <em>Shiva Samhita</em>, a Sanskrit tantric text on the nature of consciousness:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;All this universe, whether moving or stationary, has emerged from Intelligence. Renouncing everything else, one should take shelter in that Intelligence alone.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; <em>Shiva Samhita</em> (Sanskrit),{' '}
              <a href="https://sourcelibrary.org/book/6953c86b77f38f6761bdc210?page=14" className="text-accent-rust hover:text-accent-gold-dark">p. 14</a>
            </footer>
          </blockquote>

          <p>
            From the <em>Kitab al-Bulhan</em> (Book of Wonders), a 14th-century Arabic manuscript held at the Bodleian Library, blending Islamic theology with astrology and the science of the soul:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;Since the soul grows weary in certain situations and deviates from its balanced state of living due to some boredom, I have devised for it wondrous movements and rare tales of various kinds.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; <em>Kitab al-Bulhan</em> (Arabic, 14th c.),{' '}
              <a href="https://sourcelibrary.org/book/6953b56577f38f6761bd979d?page=9" className="text-accent-rust hover:text-accent-gold-dark">p. 9</a>
            </footer>
          </blockquote>

          <p>
            From Julian of Norwich&apos;s <em>Revelations of Divine Love</em> (c. 1395), the first book written by a woman in English:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;God, of your goodness, give me yourself, for you are enough for me; and I may ask for nothing that is less that may be full honor to you; and if I ask for anything that is less, I am always in want. But only in you do I have all.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Julian of Norwich, <em>Revelations of Divine Love</em> (Middle English, c. 1395),{' '}
              <a href="https://sourcelibrary.org/book/695289a9ab34727b1f04dab6?page=33" className="text-accent-rust hover:text-accent-gold-dark">p. 33</a>
            </footer>
          </blockquote>

          <p>
            From Marguerite Porete&apos;s <em>Mirror of Simple Souls</em> (c. 1295), for which she was burned at the stake:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;There is another life that we call the peace of charity in the annihilated life... a soul that no one can find. She saves herself by faith without external works. She is at one with love.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Marguerite Porete, <em>The Mirror of Simple Souls</em> (Old French, c. 1295),{' '}
              <a href="https://sourcelibrary.org/book/695289acab34727b1f04db44?page=81" className="text-accent-rust hover:text-accent-gold-dark">p. 81</a>
            </footer>
          </blockquote>

          <p>
            And from a Chinese divinatory cosmology, the mythical origin of the <em>He Tu</em> (River Map), the numerical grid said to have been discovered on the back of a dragon-horse rising from the Yellow River:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;In the nurturing and growth of all things, the Five Elements cannot be without Earth.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; <em>Chinese Cosmological Manual</em>,{' '}
              <a href="https://sourcelibrary.org/book/6992cac0d4d545ae73feea71?page=6" className="text-accent-rust hover:text-accent-gold-dark">p. 6</a>
            </footer>
          </blockquote>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            The Full Scope
          </h2>

          <p>
            The expansion adds texts from over 30 traditions:
          </p>

          <ul>
            <li>
              <strong>Hindu, Buddhist &amp; Tantric</strong> &mdash; Tantric manuscripts on consciousness and matter, Upanishadic commentaries, Yoga Sutras, Tibetan Buddhist meditation texts, Zen commentaries, Theravada texts from the Pali canon
            </li>
            <li>
              <strong>Islamic Mysticism (Sufism)</strong> &mdash; Persian Sufi poetry, Arabic texts on the science of letters (<em>ilm al-huruf</em>), the Akbarian tradition of Ibn Arabi
            </li>
            <li>
              <strong>Daoist &amp; Chinese</strong> &mdash; Internal alchemy (<em>neidan</em>), cosmological treatises, texts on Chinese medicine and the subtle body
            </li>
            <li>
              <strong>Christian Mysticism</strong> &mdash; Julian of Norwich, Marguerite Porete, Meister Eckhart, and other voices from the mystical traditions that the institutional Church tried to suppress
            </li>
            <li>
              <strong>Indigenous &amp; African</strong> &mdash; Mesoamerican cosmology, African spirit traditions, Southeast Asian syncretic texts
            </li>
            <li>
              <strong>Zoroastrian &amp; Ancient Near Eastern</strong> &mdash; Avestan texts, Zoroastrian cosmology, ancient Egyptian religious texts
            </li>
          </ul>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            Why the Expansion Matters
          </h2>

          <p>
            &ldquo;When we started Source Library, we focused on the Western esoteric tradition because that&apos;s what the Bibliotheca Philosophica Hermetica knows best,&rdquo; says the Source Library team. &ldquo;But the more we translated, the more we saw the same questions appearing across every tradition: What is consciousness? How is the universe structured? What is the relationship between language and reality? How do human beings participate in the divine?&rdquo;
          </p>
          <p>
            The Hermetic dictum <em>&ldquo;As above, so below&rdquo;</em> has parallels in virtually every wisdom tradition on Earth. The Kabbalistic understanding of divine emanation through language mirrors the Hindu concept of <em>shabda brahman</em> (the divine as sound/word). Daoist internal alchemy and European alchemy share not just a name but a structural logic: the transformation of base matter into spirit through disciplined practice.
          </p>
          <p>
            &ldquo;These aren&apos;t coincidences,&rdquo; says the Source Library editorial team. &ldquo;They&apos;re evidence that human beings, across cultures and centuries, have converged on similar insights about the nature of reality. Making these texts available side by side &mdash; in a single, searchable library &mdash; lets anyone see those connections for themselves.&rdquo;
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            The AI Training Data Argument
          </h2>

          <p>
            The expansion also strengthens Source Library&apos;s core mission: ensuring that the world&apos;s wisdom traditions are represented in the data that trains artificial intelligence.
          </p>
          <p>
            &ldquo;Right now, AI systems are trained overwhelmingly on modern English-language text,&rdquo; says the Source Library team. &ldquo;That means they encode the assumptions of one culture at one moment in time. If we want AI that can reason about consciousness, ethics, meaning, and the nature of reality &mdash; questions that will define the next century &mdash; it needs access to humanity&apos;s deepest thinking on those subjects.&rdquo;
          </p>
          <p>
            Source Library&apos;s full corpus &mdash; now spanning over 4,000 books in 90 languages &mdash; is released as open data under a Creative Commons license, available to researchers, educators, and AI developers worldwide.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            About the Collection
          </h2>

          <p>
            Source Library is anchored by approximately 1,000 works from the Bibliotheca Philosophica Hermetica, the world&apos;s foremost library of Western esoteric texts, housed at the Embassy of the Free Mind in Amsterdam. The collection is complemented by acquisitions from 13 partner institutions including the Bodleian Library (Oxford), Cambridge University Library, the Vatican Library, the Bavarian State Library, the Biblioth&egrave;que nationale de France, and the Library of Congress.
          </p>
          <p>
            All texts are freely available at{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org</a> with AI translations, original text, and high-resolution page images.
          </p>

          <div className="mt-12 pt-8 border-t border-stone-200 space-y-2 text-stone-600">
            <p>
              <strong>Explore the collection:</strong>{' '}
              <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org</a>
            </p>
            <p>
              <strong>Browse by tradition:</strong>{' '}
              <a href="https://sourcelibrary.org/search" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org/search</a>
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
