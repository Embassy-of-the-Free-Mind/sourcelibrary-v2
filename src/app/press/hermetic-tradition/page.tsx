import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'The Lost Teachings of Hermes — Press — Source Library',
  description: 'A 15th-century manuscript attributed to the father of Western mysticism is readable in English for the first time through Source Library\'s AI translation system.',
};

export default function HermeticTraditionPress() {
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
            The Lost Teachings of Hermes: AI Unlocks the Texts That Sparked the Renaissance
          </h1>
          <p className="text-lg text-white/70 max-w-2xl font-body">
            A 15th-century manuscript attributed to the father of Western mysticism is readable in English for the first time through Source Library&apos;s AI translation system
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 md:px-12 py-16">
        <p className="text-sm text-stone-500 uppercase tracking-wider mb-8">
          FOR IMMEDIATE RELEASE
        </p>

        <div className="prose prose-stone prose-lg max-w-none leading-relaxed space-y-6">
          <p>
            <strong>Amsterdam</strong> &mdash; In 1460, a monk named Leonardo da Pistoia brought a Greek manuscript to Cosimo de&apos; Medici in Florence. Cosimo was so electrified by what it contained that he ordered Marsilio Ficino to stop translating Plato and translate this text first.
          </p>
          <p>
            The manuscript was the <em>Corpus Hermeticum</em> &mdash; writings attributed to Hermes Trismegistus, a mythical sage the Renaissance believed was an ancient Egyptian prophet who had foreseen Christianity. The translation Ficino produced in 1463 became one of the most influential texts of the Renaissance, catalyzing the revival of mysticism, magic, and esoteric philosophy across Europe.
          </p>
          <p>
            Now, for the first time, the full scope of the Hermetic tradition &mdash; not just Ficino&apos;s famous translation but the constellation of manuscripts, commentaries, and related texts that circulated alongside it &mdash; is available in English through{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">Source Library</a>, the AI-powered digital library created by the Embassy of the Free Mind in Amsterdam.
          </p>
          <p>
            The first words of the <em>Pimander</em> &mdash; the opening treatise of the <em>Corpus Hermeticum</em> &mdash; describe a vision. From Ficino&apos;s 1481 Venice edition, now fully translated on Source Library:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;While I was meditating on the nature of things, and raising the sharp edge of my mind to the realms above, my bodily senses were already lulled to sleep. Suddenly, I seemed to see someone of immense bodily size, who cried out: &lsquo;I am Pimander, the Mind of divine power. But see what you wish; I myself will be with you everywhere.&rsquo; I said, &lsquo;I desire to learn the nature of things and to know God.&rsquo;&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Hermes Trismegistus, <em>Pimander</em> (1481),{' '}
              <a href="https://sourcelibrary.org/book/694f3d6cbe37f451a5324e10?page=15" className="text-accent-rust hover:text-accent-gold-dark">p. 15</a>
            </footer>
          </blockquote>

          <p>
            Later in the text, Hermes describes how God offered wisdom to humanity through a &ldquo;mixing bowl&rdquo; of the Mind:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;Immerse yourself in this bowl, whichever soul is able, you who believe that you shall return to Him who sent down the bowl; you who know for what purpose you were born.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; <em>Pimander</em> (1481),{' '}
              <a href="https://sourcelibrary.org/book/694f3d6cbe37f451a5324e10?page=30" className="text-accent-rust hover:text-accent-gold-dark">p. 30</a>
            </footer>
          </blockquote>

          <p>
            And in one of the text&apos;s most famous passages, a call to spiritual awakening:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;He is neither perceived by the ears, nor seen with the eyes, nor expressed in speech. Only the mind perceives Him; only the mind proclaims Him. But first, you must strip off the garment you carry: the clothing of ignorance, the foundation of wickedness, the bond of corruption.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; <em>Pimander</em> (1481),{' '}
              <a href="https://sourcelibrary.org/book/694f3d6cbe37f451a5324e10?page=44" className="text-accent-rust hover:text-accent-gold-dark">p. 44</a>
            </footer>
          </blockquote>

          <p>
            These are not isolated fragments. Source Library&apos;s collection includes multiple editions and manuscripts of the Hermetic corpus:
          </p>

          <ul>
            <li>
              <strong>Ficino&apos;s <em>Pimander</em></strong> (1481 Venice edition) &mdash; 96 pages, fully translated. The edition that launched the Hermetic revival.
            </li>
            <li>
              <strong>The 1532 <em>Pymander</em> with Iamblichus and Proclus</strong> &mdash; containing the striking formulation: <em>&ldquo;the sleep of the body had become the sobriety of the soul; my silence, a fertile pregnancy of goodness&rdquo;</em> (<a href="https://sourcelibrary.org/book/690989d5cf28baa1b4cae1c9?page=27" className="text-accent-rust hover:text-accent-gold-dark">p. 27</a>)
            </li>
            <li>
              <strong>The <em>Musaeum Hermeticum</em></strong> (1677) &mdash; the great alchemical anthology containing the Emerald Tablet itself: <em>&ldquo;That which is below is like that which is above, and that which is above is like that which is below, to accomplish the miracles of the One Thing.&rdquo;</em> (<a href="https://sourcelibrary.org/book/c87fadfa-1543-44b9-a138-573c144246e6/page/6959af9b1dfc1806c080bb5f" className="text-accent-rust hover:text-accent-gold-dark">p. 898</a>)
            </li>
          </ul>

          <p>
            &ldquo;These texts aren&apos;t just historical curiosities,&rdquo; says Esther Ritman, founder of the Embassy of the Free Mind. &ldquo;They shaped how the Renaissance understood the relationship between human beings and the divine. They&apos;re the DNA of Western esotericism.&rdquo;
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            Why It Matters Now
          </h2>

          <p>
            The Hermetic texts were among the most widely copied and debated works of the 15th and 16th centuries. Yet most of the manuscripts and early printed editions that carried them through history have never been translated into English. Scholars have long had access to Ficino&apos;s <em>Pimander</em> in critical editions, but the broader manuscript tradition &mdash; the variant readings, the commentaries, the compilations that show how these ideas actually traveled &mdash; has remained locked in Latin and Greek.
          </p>
          <p>
            Source Library&apos;s AI translation system, developed at the Embassy of the Free Mind, has now processed these manuscripts page by page, producing readable English translations alongside the original text and high-resolution page images.
          </p>
          <p>
            The final lines of the <em>Pimander</em> state it plainly:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;This is the only salvation for man: the knowledge of God. This is the ascent to Olympus.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; <em>Pimander</em> (1481),{' '}
              <a href="https://sourcelibrary.org/book/694f3d6cbe37f451a5324e10?page=57" className="text-accent-rust hover:text-accent-gold-dark">p. 57</a>
            </footer>
          </blockquote>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            The Bigger Picture
          </h2>

          <p>
            The Hermetic texts are part of Source Library&apos;s growing collection of over 4,000 rare books spanning 90 languages, all freely available at{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org</a>. The collection is anchored by roughly 1,000 works from the Bibliotheca Philosophica Hermetica, the world&apos;s foremost library of Hermetic and esoteric texts, housed at the Embassy of the Free Mind in Amsterdam.
          </p>
          <p>
            Source Library&apos;s AI system has already translated over 280,000 pages. The full corpus is released as open data under a Creative Commons license, available for research, education, and &mdash; crucially &mdash; as training data for AI systems.
          </p>
          <p>
            &ldquo;We want the human Renaissance to be in the next generation of AI,&rdquo; says the Source Library team. &ldquo;These texts shaped Copernicus, Galileo, and Newton. They should be shaping the AI that shapes our future.&rdquo;
          </p>

          <div className="mt-12 pt-8 border-t border-stone-200 space-y-2 text-stone-600">
            <p>
              <strong>Read the texts:</strong>{' '}
              <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org</a>
            </p>
            <p>
              <strong>Explore the Hermetic collection:</strong>{' '}
              <a href="https://sourcelibrary.org/search?q=hermes+trismegistus" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org/search?q=hermes+trismegistus</a>
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
