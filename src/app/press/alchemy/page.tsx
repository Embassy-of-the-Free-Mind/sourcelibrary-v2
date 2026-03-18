import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Before Chemistry Had a Name — Press — Source Library',
  description: 'Newly translated texts from Paracelsus, Sendivogius, and their contemporaries show how the quest to transmute matter became the science of understanding it.',
};

export default function AlchemyPress() {
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
            Before Chemistry Had a Name: AI Reveals the Alchemical Roots of Modern Science
          </h1>
          <p className="text-lg text-white/70 max-w-2xl font-body">
            Newly translated texts from Paracelsus, Sendivogius, and their contemporaries show how the quest to transmute matter became the science of understanding it
          </p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 md:px-12 py-16">
        <p className="text-sm text-stone-500 uppercase tracking-wider mb-8">
          FOR IMMEDIATE RELEASE
        </p>

        <div className="prose prose-stone prose-lg max-w-none leading-relaxed space-y-6">
          <p>
            <strong>Amsterdam</strong> &mdash; In 1650, an English publisher released a book called <em>A New Light of Alchemy</em> by the Polish alchemist Michael Sendivogius, bundled with writings by Paracelsus. The book promised to reveal the secrets of the Philosopher&apos;s Stone.
          </p>
          <p>
            What it actually contained was something more remarkable: a theory of matter that anticipated modern chemistry by 150 years. Sendivogius described a &ldquo;universal spirit&rdquo; in the air that sustained life &mdash; a substance we now call oxygen, identified formally by Lavoisier in 1778.
          </p>
          <p>
            This text, along with hundreds of other alchemical works, is now freely readable in English for the first time through{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">Source Library</a>, the AI-powered digital library created by the Embassy of the Free Mind in Amsterdam.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            The Alchemists Were Scientists
          </h2>

          <p>
            The standard history of chemistry begins with Lavoisier and Boyle, treating everything before them as superstition. But the texts themselves tell a different story.
          </p>
          <p>
            From Sendivogius&apos;s <em>A New Light of Alchemy</em> (1650), now translated on Source Library in 390 pages:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;Art imitates Nature. Whatever is not in Nature cannot succeed by Art; for water, as I said before, does not ascend higher than the place from which it was taken.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Michael Sendivogius, <em>A New Light of Alchemy</em> (1650),{' '}
              <a href="https://sourcelibrary.org/book/695906d14953388fe7ac6e34?page=216" className="text-accent-rust hover:text-accent-gold-dark">p. 216</a>
            </footer>
          </blockquote>

          <p>
            And in his concluding treatise on the operations of nature:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;The seed is nothing else but the air congealed... everything that has seed is multiplied in it, but without the help of Nature, it is not accomplished.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Sendivogius, <em>A New Light of Alchemy</em>,{' '}
              <a href="https://sourcelibrary.org/book/695906d14953388fe7ac6e34?page=341" className="text-accent-rust hover:text-accent-gold-dark">p. 341</a>
            </footer>
          </blockquote>

          <p>
            Edward Kelly, the controversial English alchemist who worked alongside John Dee, described the alchemist&apos;s art as a collaboration with nature itself:
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;Art assists Nature and Nature assists Art. A vessel like an urinal presupposes a substance created by Nature alone, in which Art assists Nature and Nature assists Art.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Edward Kelly, <em>The Stone of the Philosophers</em> (1650),{' '}
              <a href="https://sourcelibrary.org/book/6952d13377f38f6761bc5e29?page=199" className="text-accent-rust hover:text-accent-gold-dark">p. 199</a>
            </footer>
          </blockquote>

          <p>
            Thomas Vaughan, the Welsh alchemist and twin brother of the metaphysical poet Henry Vaughan, wrote in his <em>Lumen de Lumine</em> (1651):
          </p>

          <blockquote className="border-l-4 border-accent-gold pl-6 py-2 my-8 bg-accent-gold/5 rounded-r-lg">
            <p className="italic text-stone-700">
              &ldquo;Salvation itself is nothing else but transmutation.&rdquo;
            </p>
            <footer className="text-sm text-stone-500 mt-3">
              &mdash; Thomas Vaughan, <em>Lumen de Lumine</em> (1651),{' '}
              <a href="https://sourcelibrary.org/book/69525855ab34727b1f045072?page=113" className="text-accent-rust hover:text-accent-gold-dark">p. 113</a>
            </footer>
          </blockquote>

          <p>
            These weren&apos;t metaphors to their authors. Vaughan and his contemporaries believed that understanding the transformation of matter was the same project as understanding the transformation of the soul &mdash; and that both required careful observation of nature.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            What&apos;s in the Collection
          </h2>

          <p>
            Source Library&apos;s alchemical holdings include over 200 works spanning three centuries:
          </p>

          <ul>
            <li>
              <strong>Paracelsus</strong> (1493&ndash;1541): Medical and alchemical treatises that transformed European medicine, arguing that diseases had specific chemical causes and chemical remedies &mdash; a radical departure from Galenic humoral theory.
            </li>
            <li>
              <strong>Michael Sendivogius</strong> (1566&ndash;1636): <em>A New Light of Alchemy</em> &mdash; 390 pages now fully translated, containing his theory of the <em>aerial nitre</em> (atmospheric oxygen) and the role of air in combustion and respiration.
            </li>
            <li>
              <strong>The <em>Crowning of Nature</em></strong> (<em>Coronatio Naturae</em>, c. 1600): A stunning illustrated alchemical manuscript from Cambridge University Library, with emblems depicting the stages of the alchemical work.
            </li>
            <li>
              <strong>Kirchweger&apos;s <em>La nature d&eacute;voil&eacute;e</em></strong> (1772): A late alchemical compendium that bridges the transition from alchemy to modern chemistry, showing how alchemical concepts were gradually translated into chemical language.
            </li>
          </ul>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            Why This Matters for the History of Science
          </h2>

          <p>
            &ldquo;The boundary between &lsquo;alchemy&rsquo; and &lsquo;chemistry&rsquo; was invented retroactively,&rdquo; says the Source Library editorial team. &ldquo;When you read these texts in the original, you see continuous experimentation, careful observation, and theoretical sophistication. The alchemists weren&apos;t failed chemists. They were chemists before the word existed.&rdquo;
          </p>
          <p>
            Robert Boyle, often called the &ldquo;father of chemistry,&rdquo; owned extensive alchemical manuscripts and conducted alchemical experiments throughout his life. Isaac Newton wrote more pages on alchemy than on physics. These facts are well known to historians of science &mdash; but the primary sources they relied on have largely remained inaccessible to the public.
          </p>
          <p>
            Source Library changes that. Every alchemical text in the collection is freely available with AI translation, original text, and high-resolution page images.
          </p>

          <h2
            className="text-2xl text-stone-900 mt-12 mb-4 font-display"
          >
            Open Data for Research
          </h2>

          <p>
            All translations are released as open data under a Creative Commons license. Researchers, educators, and AI developers can access the full corpus for any purpose.
          </p>
          <p>
            &ldquo;We&apos;re not just translating old books,&rdquo; says the Source Library team. &ldquo;We&apos;re restoring a missing chapter in the history of science. The alchemists&apos; questions &mdash; What is matter? How does it change? What makes life possible? &mdash; are still our questions.&rdquo;
          </p>

          <div className="mt-12 pt-8 border-t border-stone-200 space-y-2 text-stone-600">
            <p>
              <strong>Read the texts:</strong>{' '}
              <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org</a>
            </p>
            <p>
              <strong>Explore alchemy texts:</strong>{' '}
              <a href="https://sourcelibrary.org/search?q=alchemy" className="text-accent-rust hover:text-accent-gold-dark">sourcelibrary.org/search?q=alchemy</a>
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
