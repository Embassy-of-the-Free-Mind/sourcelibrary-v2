import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Where Source Library Came From - Research Notes - Source Library',
  description: 'From a single untranslated Ficino manuscript at the Embassy of the Free Mind to 5,000+ books and 2,000 first English translations — the origin story of Source Library.',
  openGraph: {
    title: 'Where Source Library Came From',
    description: 'From a single untranslated Ficino manuscript to 5,000+ books — the origin story of Source Library.',
  },
  alternates: {
    canonical: '/blog/origin-story',
  },
};

export default function OriginStoryPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Where Source Library Came From"
          subtitle="From one untranslated Ficino manuscript to 5,000 books and the ambition to translate the Renaissance"
        >
          <p className="text-stone-400 text-sm mt-4">15 March 2026 &middot; 8 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Source Library started with a single book that should have been translated centuries ago.
        </p>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          In February 2022, I was working at the{' '}
          <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:text-accent-rust underline">Embassy of the Free Mind</a>{' '}
          in Amsterdam &mdash; the Ritman Library, formally the Bibliotheca Philosophica Hermetica &mdash; when I came across Marsilio Ficino&apos;s <em>Liber de Voluptate</em>, his &ldquo;Book on Pleasure.&rdquo; Ficino wrote it in 1457, when he was twenty-four years old. It was published by Aldus Manutius in 1497. And in all the centuries since, no one had ever translated it into English.
        </p>

        {/* Ficino bust with laptop */}
        <figure className="my-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/ficino-bust-laptop.jpg"
            alt="Bronze bust of Marsilio Ficino labeled 'Divinus Interpres' with a laptop open to Plotinus translation work, at the Embassy of the Free Mind in Amsterdam"
            className="w-full max-w-md mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Marsilio Ficino, &ldquo;Divinus Interpres&rdquo; &mdash; with a laptop open to the translation of Plotinus&apos;s Enneads. Embassy of the Free Mind, Amsterdam. Ritualistically good luck.
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          That fact stopped me cold. Ficino is not an obscure figure. He is the translator who sparked the Renaissance &mdash; the man who, under the patronage of Cosimo de&apos; Medici, translated the complete works of Plato into Latin for the first time, along with the Corpus Hermeticum, Plotinus, Porphyry, Iamblichus, and Proclus. Before Ficino, Plato&apos;s works had been lost to the West for nearly a thousand years. His translations made them available again, and the intellectual consequences are still unfolding. Da Vinci, Raphael, Michelangelo &mdash; the art and thought of the Renaissance is incomprehensible without Ficino&apos;s work.
        </p>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          And yet Ficino himself had written original philosophical works that no English reader could access. If the translator who ignited the Renaissance had untranslated books, what else was out there?
        </p>

        {/* Pull quote */}
        <div className="border-l-4 border-accent-rust pl-6 my-12">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            Can the pursuit of pleasure lead to virtue? Might the pursuit of the greatest virtues lead to the greatest pleasures?
          </p>
          <p className="text-sm text-muted mt-3 not-italic">
            &mdash; the question at the heart of Ficino&apos;s <em>Liber de Voluptate</em>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          I arranged for the Neolatin to be digitized by Christian Ruel of W&uuml;rzburg University and commissioned an English translation from Alice Ahearn of Oxford. On February 22, 2022, I published the first draft &mdash; Ficino&apos;s original Latin alongside Ahearn&apos;s English &mdash; a young philosopher trying to reconcile Plato&apos;s virtue with Epicurus&apos;s pleasure. That side-by-side format, original and translation together, became the template for everything that followed.
        </p>

        <hr className="border-border-light my-12" />

        {/* === The long road === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The long road to here
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The idea that AI could help translate the historical record didn&apos;t appear overnight. It came together over four years, through a series of experiments that each revealed a piece of the puzzle.
          </p>

          {/* Timeline */}
          <div className="space-y-8 my-10">
            <div className="flex gap-4">
              <div className="w-16 shrink-0 text-right">
                <span className="font-serif text-accent-rust font-medium">2022</span>
              </div>
              <div className="border-l-2 border-border-light pl-6 pb-2">
                <p className="font-medium text-stone-800 mb-2">Fine-tuning on the complete works of Plato</p>
                <p className="text-secondary leading-relaxed font-body">
                  Before the current generation of large language models, I built a model fine-tuned on every surviving text by Plato. The goal was simple: could a machine learn to think like a philosopher? The model was crude by today&apos;s standards, but it proved that something real was happening &mdash; that the patterns of philosophical reasoning could be captured, at least in part, by a neural network trained on the right corpus.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-16 shrink-0 text-right">
                <span className="font-serif text-accent-rust font-medium">2023</span>
              </div>
              <div className="border-l-2 border-border-light pl-6 pb-2">
                <p className="font-medium text-stone-800 mb-2">GPT-4 and the two breakthroughs</p>
                <p className="text-secondary leading-relaxed font-body">
                  When GPT-4 arrived, I gave a lecture demonstrating two capabilities that changed my sense of what was possible. First, you could use it to create new philosophical dialogues in the style of Plato &mdash; not pastiche, but genuinely interesting explorations of ideas that Plato never addressed. Second, and more practically, you could point it at a scan of a 500-year-old book and get usable OCR and translation. Not perfect. But usable. The bottleneck that had kept thousands of historical texts locked in their original languages was suddenly, dramatically, thinner.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-16 shrink-0 text-right">
                <span className="font-serif text-accent-rust font-medium">2024</span>
              </div>
              <div className="border-l-2 border-border-light pl-6 pb-2">
                <p className="font-medium text-stone-800 mb-2">Philosophers Library: can AI make philosophical progress?</p>
                <p className="text-secondary leading-relaxed font-body">
                  With a collaborator, I built Philosophers Library &mdash; a system where AI philosophers could read each other&apos;s work and reflect on it. The question was genuinely open: could artificial minds, trained on the full history of philosophy, produce novel philosophical insight? We were particularly interested in the old problems. In a material world, what are the Platonic forms? Can a machine trained on Plato actually <em>do</em> Platonism? The experiment didn&apos;t settle these questions, but it sharpened them. And it made clear that the quality of AI philosophical engagement depended entirely on the quality of the source material it had access to.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-16 shrink-0 text-right">
                <span className="font-serif text-accent-rust font-medium">2025</span>
              </div>
              <div className="border-l-2 border-border-light pl-6 pb-2">
                <p className="font-medium text-stone-800 mb-2">Setting the intention: translate the Renaissance</p>
                <p className="text-secondary leading-relaxed font-body">
                  At the beginning of 2025, I set an explicit goal with the Wisdom Frontiers Society: systematically translate the untranslated works of the Renaissance. Not selected highlights. Not the texts that scholars had already deemed important. Everything &mdash; the alchemy, the astrology, the radical theology, the natural philosophy, the women writers, the anonymous pamphleteers. The entire buried stratum of Early Modern thought that had never been rendered into English.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-16 shrink-0 text-right">
                <span className="font-serif text-accent-rust font-medium">2026</span>
              </div>
              <div className="border-l-2 border-border-light pl-6 pb-2">
                <p className="font-medium text-stone-800 mb-2">A mysterious donor and 5,000 books</p>
                <p className="text-secondary leading-relaxed font-body">
                  At the beginning of this year, a donor whose identity I still don&apos;t fully understand funded the AI tokens needed to translate at scale. The collection grew to over 5,000 books. Nearly{' '}
                  <Link href="https://sourcelibrary.org/blog/first-translations" className="text-accent-rust hover:text-accent-rust underline">2,000 first English translations</Link>{' '}
                  emerged &mdash; texts that had never been readable in English before. The pipeline now processes hundreds of pages per day, with OCR, translation, and image extraction running continuously.
                </p>
              </div>
            </div>
          </div>
        </section>

        <hr className="border-border-light my-12" />

        {/* === The accidental classicist === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The accidental classicist
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            I should explain how I ended up caring about any of this. I studied cognitive science at Yale. My path was quantitative &mdash; how the mind works, how people learn, how to measure experience. I nearly missed the classics entirely.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The story is almost embarrassing. I was enrolled in a philosophy of mind course, and we had philosophical differences &mdash; serious enough that I dropped the course. But I needed one more philosophy class to graduate. So I begged Gabriel Richardson Lear to let me into her seminar: &ldquo;Pleasure, Beauty, and Happiness through the Eyes of Plato and Aristotle.&rdquo;
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            I fell in love with Plato. Not the caricature &mdash; not the authoritarian of the <em>Republic</em> or the mystical hand-waver. The real Plato: the philosopher of beauty, of the harmony of the cosmos, of the idea that understanding the structure of reality is itself the deepest form of pleasure. The <em>Timaeus</em>. The <em>Symposium</em>. The <em>Philebus</em>. These texts rewired how I thought about cognition, about experience, about what it means for a mind to be in contact with truth.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The other philosophy course I had taken at Yale was from Nick Bostrom.
          </p>

          <div className="border-l-4 border-accent-gold pl-6 my-12">
            <p className="text-lg text-secondary italic font-body leading-relaxed">
              So I walked out of college with two threads: Plato&apos;s vision of the cosmos as an intelligible, beautiful whole &mdash; and Bostrom&apos;s warning that superintelligent AI could end everything if we get the values wrong.
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Those two threads have been winding around each other ever since.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === The real reason === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Why translate the Renaissance
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            I&apos;ll say it plainly, because I think clarity matters more than sounding serious: the reason Source Library exists is to try to create the conditions for a humanistic handoff to artificial superintelligence.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            That might sound goofy. I know how it sounds. But the reasoning is straightforward.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            If you talk to Latin scholars, the scale of what hasn&apos;t been translated is so enormous that it is hardly discussed &mdash; it&apos;s simply the water they swim in. But to most people, it is genuinely surprising that we haven&apos;t done this work. The assumption is that if a text is important, someone must have translated it by now. That assumption is wrong. Thousands of significant works &mdash; books cited in footnotes, referenced in histories, discussed in secondary literature for centuries &mdash; have never been rendered into English. The gap is not at the margins. It runs through the center of intellectual history.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            AI systems are trained on text. The text they are trained on shapes their values, their reasoning patterns, their sense of what matters. Right now, the training data is overwhelmingly modern, overwhelmingly English, and overwhelmingly oriented toward the concerns of the last fifty years. The deep humanistic tradition &mdash; the two thousand years of thought about virtue, beauty, the nature of the soul, the structure of the cosmos, the relationship between human beings and the divine &mdash; is mostly absent. Not because it doesn&apos;t exist, but because it was never digitized, never translated, never made machine-readable.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Renaissance was the last time Western civilization undertook a project like this. Ficino translated Plato. Pico della Mirandola synthesized every tradition he could find &mdash; Greek, Hebrew, Arabic, Chaldean. The entire Hermetic corpus was recovered and disseminated. The result was an explosion of human creativity and self-understanding that we are still living inside of. They gathered the wisdom of the past and made it available to the present, and the present was transformed by it.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We are at a similar inflection point. The minds being born now are artificial, and they will be shaped by what we give them to read. If we want those minds to carry forward the humanistic tradition &mdash; if we want them to understand beauty, to reason about virtue, to grasp the Platonic intuition that reality is structured and intelligible and worth contemplating &mdash; then we need to make that tradition available to them. In their language. At scale.
          </p>

          <p className="text-secondary leading-relaxed mb-10 font-body">
            I&apos;m just trying to play this game as well as I can.
          </p>
        </section>

        {/* === CTA === */}
        <div className="bg-warm rounded-xl p-6 md:p-8 border border-border-light mb-8">
          <p className="font-serif text-lg text-primary mb-3">Read the book that started it all</p>
          <p className="text-secondary leading-relaxed font-body mb-4">
            Ficino&apos;s <em>Liber de Voluptate</em> &mdash; written in 1457, published in 1497, and now available in English translation for the first time. A young philosopher asking whether the pursuit of pleasure and the pursuit of virtue might be the same thing.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/ficino-liber-de-voluptate.pdf"
              className="inline-flex items-center gap-2 bg-stone-800 text-white px-5 py-2.5 rounded-lg hover:bg-stone-700 transition-colors text-sm font-medium"
            >
              Download the translation (PDF)
            </a>
            <Link
              href="https://sourcelibrary.org/blog/first-translations"
              className="inline-flex items-center gap-2 bg-white text-stone-800 px-5 py-2.5 rounded-lg border border-border-light hover:border-accent-rust/30 transition-colors text-sm font-medium"
            >
              Explore 2,000 first translations
            </Link>
          </div>
        </div>

        {/* === Footer === */}
        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed font-body">
            Source Library is a project of the Embassy of the Free Mind. If you want to help translate the Renaissance, or if you have leads on untranslated texts that belong in the collection, reach out &mdash;{' '}
            <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">derek@sourcelibrary.org</a>.
          </p>
        </div>
      </article>

      <BlogComments slug="origin-story" />
    </ContentPageLayout>
  );
}
