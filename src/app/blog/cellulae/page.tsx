import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Cellulae: What Two Pages of a Medieval Manuscript Reveal About Biology, Law, and the Dangers of Careful Reasoning - Source Library',
  description:
    'A word on page 32 of a medieval manuscript launched modern biology. The argument on page 33 helped criminalize rape victims for eight centuries. They were written by the same man.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/archived/695677fdbe7c607c5f03b2d9/717.jpg', alt: 'Scientific plate from Philosophical Transactions of the Royal Society, 1694' }],
    title: 'Cellulae: Biology, Law, and the Dangers of Careful Reasoning',
    description: 'A word on page 32 launched modern biology. The argument on page 33 helped criminalize rape victims for eight centuries. Written by the same man, in the same manuscript.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/695677fdbe7c607c5f03b2d9/717.jpg', alt: 'Scientific plate from Philosophical Transactions of the Royal Society, 1694' }],
  },
  alternates: {
    canonical: '/blog/cellulae',
  },
};

export default function CellulaePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Cellulae"
          subtitle="What two pages of a medieval manuscript reveal about biology, law, and the dangers of careful reasoning"
          image="https://images.sourcelibrary.org/archived/695677fdbe7c607c5f03b2d9/717.jpg"
          imageAlt="Scientific plate from Philosophical Transactions of the Royal Society, 1694"
        >
          <p className="text-stone-400 text-sm mt-4">16 April 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          We were reading a fifteenth-century manuscript of the <em>Secretum Secretorum</em> &mdash; the most
          widely copied text of the medieval period, framed as a letter from Aristotle to Alexander the Great
          on how to rule, eat, and live. Somewhere around{' '}
          <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c5" className="text-accent-rust hover:text-accent-rust underline">
            page 32
          </Link>
          , the text describes the anatomy of the womb:
        </p>

        <figure className="my-12">
          <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/archived/6952306aab34727b1f0446a5/32.jpg"
              alt="Page 32 of the Secretum Secretorum manuscript showing the cellulae passage in medieval Latin two-column format"
              className="w-full max-w-lg mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Page 32 of the manuscript. The word <em>cellulas</em> appears in the left column, describing seven chambers of the womb.
            Biblioth&egrave;que nationale de France.{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c5" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <div className="border-l-4 border-accent-rust pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;It has seven cells [<em>cellulas</em>], impressed with the human figure like a coin-mold.
            It is for this reason that a woman can bear seven children in a single birth, but no more.&rdquo;
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          The word caught our attention. <em>Cellulas</em> &mdash; small chambers. The same Latin word
          that Robert Hooke would use in 1665 when he looked at cork through a microscope and saw
          &ldquo;a great many little Boxes,&rdquo; launching the concept that would become the foundation
          of modern biology.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          But then we turned the page. And what followed the <em>cellulae</em> was far darker than etymology.
        </p>

        <hr className="border-border-light my-12" />

        {/* I. The Seven Chambers */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            I. The Seven Chambers
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The doctrine that the uterus contained seven chambers &mdash; three on the right producing
            males, three on the left producing females, one in the center producing hermaphrodites &mdash;
            was a widespread medieval medical belief. It first appears in the pseudo-Galenic{' '}
            <em>De Spermate</em>, a twelfth-century Latin compilation that circulated under Galen&apos;s name.
            It entered the European medical canon through figures like Michael Scot (c. 1180&ndash;1250),
            scientific advisor to Emperor Frederick II, and persisted through Mondino de Luzzi&apos;s
            influential <em>Anathomia</em> of 1316 into at least the seventeenth century, when cadaver
            dissection by Leonardo da Vinci and Vesalius finally demonstrated a single uterine cavity.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The word <em>cellula</em> &mdash; diminutive of <em>cella</em>, a small room &mdash; was already
            standard anatomical terminology before Hooke ever touched a microscope. Medieval physicians
            spoke of the three <em>cellae</em> of the brain (the ventricles, each housing a cognitive
            faculty: imagination in the front, reason in the middle, memory in the rear), the{' '}
            <em>cellulae</em> of the colon, and the <em>cellulae</em> of the seminal vesicle.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            In a 2024 paper in the Royal Society&apos;s <em>Notes and Records</em>, Winfried S. Peters
            argues that when Hooke described the &ldquo;cells&rdquo; of cork, he was not thinking of
            monks&apos; rooms at all &mdash; he was drawing on this existing anatomical vocabulary, where{' '}
            <em>cellulae</em> meant linearly arranged compartments for the storage, modification, and
            transport of materials.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            If Peters is right, the word &ldquo;cell&rdquo; in biology descends not from monastery
            architecture but from exactly this tradition of medieval anatomy &mdash; the tradition that
            produced the <em>cellulae</em> in our manuscript. The seven chambers of the womb, the three
            chambers of the brain, the compartments of cork: it is the same word doing the same conceptual
            work across five centuries.
          </p>

          <p className="text-sm text-muted mt-8 font-body">
            <strong>Source:</strong>{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle" className="text-accent-rust hover:text-accent-rust underline">
              <em>Aristotelis Secretum Secretorum</em>
            </Link>, 15th century. The <em>cellulae</em> passage appears on{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c5" className="text-accent-rust hover:text-accent-rust underline">
              page 32
            </Link>.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* II. Turn the Page */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            II. Turn the Page
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The <em>cellulae</em> passage is part of a longer dialogue on reproduction, structured as a
            series of questions from a Disciple to a Philosopher. On the same page, the Disciple asks
            why prostitutes rarely conceive. The Philosopher explains that conception requires pleasure &mdash;
            the emission of female &ldquo;seed&rdquo; &mdash; and prostitutes &ldquo;experience no pleasure
            in the act but are moved only by the fee, so they emit nothing.&rdquo;
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Then the Disciple raises an objection. If pleasure is required for conception, what about rape?
          </p>

          <figure className="my-12">
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.sourcelibrary.org/archived/6952306aab34727b1f0446a5/33.jpg"
                alt="Page 33 of the manuscript showing the continuation of the reproductive dialogue including the rape argument and infertility discussion"
                className="w-full max-w-lg mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Page 33. The rape argument and the infertility discussion that contradicts it &mdash; both on the same page.{' '}
              <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c6" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
            </figcaption>
          </figure>

          <div className="border-l-4 border-stone-300 pl-6 my-10">
            <p className="text-lg text-secondary italic font-body leading-relaxed">
              &ldquo;Even if the act is displeasing at first to those who are seized, at the end it
              nonetheless becomes pleasing through the friction of the flesh.&rdquo;
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Philosopher distinguishes two kinds of will: the <em>voluntas rationis</em> (rational will)
            and the <em>delectatio carnis</em> (delight of the flesh). Even in rape, he argues, the body
            experiences its own involuntary pleasure, independent of consent. And since conception requires
            female seed, and female seed requires pleasure, any pregnancy that results from rape proves
            that pleasure &mdash; and therefore a kind of consent &mdash; was present.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The argument is circular. It protects the two-seed theory from falsification by asserting
            that the counterevidence (pregnancy from rape) actually confirms the theory, because pleasure
            must have been secretly present. But the text contains its own contradiction: just a few lines
            later, the Philosopher notes that wives who have intercourse &ldquo;with great pleasure&rdquo;
            with their husbands also frequently never conceive. If pleasure were truly sufficient for
            conception, this should not happen. The text simply moves on.
          </p>

          <p className="text-sm text-muted mt-8 font-body">
            <strong>Source:</strong> The rape argument spans{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c5" className="text-accent-rust hover:text-accent-rust underline">
              pages 32&ndash;33
            </Link>. The infertility discussion that undermines it is on{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c6" className="text-accent-rust hover:text-accent-rust underline">
              page 33
            </Link>.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* III. A Most Harmful Doctrine */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            III. A Most Harmful Doctrine
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The argument in our manuscript did not stay in our manuscript. The medical claim that
            conception requires female pleasure, and therefore that pregnancy from rape implies consent,
            entered European law and stayed there for centuries.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The chain of transmission runs through <strong>Galen</strong> (2nd century CE), who argued
            in <em>De Semine</em> that both men and women produce generative seed and that the emission
            of female seed is accompanied by pleasure. The <strong>Salernitan medical school</strong>{' '}
            (12th&ndash;13th century) transmitted these ideas through scholastic question-and-answer texts
            that circulated across the universities. <strong>Henry de Bracton</strong>, writing English
            law around 1235, codified the principle:
          </p>

          <div className="border-l-4 border-stone-300 pl-6 my-10">
            <p className="text-lg text-secondary italic font-body leading-relaxed">
              &ldquo;If, however, the woman should have conceived at the time, it abates the appeal,
              for without the will of the woman she could not conceive.&rdquo;
            </p>
            <p className="text-sm text-muted mt-3 not-italic font-body">
              &mdash; Bracton, <em>De Legibus et Consuetudinibus Angliae</em>, Book III, on the appeal of rape
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            This effectively made pregnancy a defense against a rape charge. The doctrine persisted
            in English common law through the early modern period. While Blackstone (1765) did not
            repeat it in exactly the same terms, the structural assumptions &mdash; that the female body
            is a reliable witness to consent &mdash; remained embedded in how rape was prosecuted and how
            juries were instructed.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The echo reached 2012, when U.S. Representative Todd Akin{' '}
            <a href="https://www.washingtonpost.com/news/the-fix/wp/2012/08/19/todd-akin-gop-senate-candidate-legitimate-rape-rarely-causes-pregnancy/" className="text-accent-rust hover:text-accent-rust underline" target="_blank" rel="noopener noreferrer">
              stated that in cases of &ldquo;legitimate rape, the female body has ways to try to shut
              that whole thing down&rdquo;
            </a>.
            The American College of Obstetricians and Gynecologists immediately refuted the claim.
            Historians recognized it as a direct descendant of the medieval two-seed theory &mdash; the
            same theory articulated in our manuscript, on the page after the <em>cellulae</em>.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* IV. Not Aristotle */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            IV. Not Aristotle &mdash; and Not the <em>Secretum</em>
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            When we checked the passage against the other copies of the <em>Secretum Secretorum</em> in
            Source Library &mdash;{' '}
            <Link href="/search?q=secretum+secretorum" className="text-accent-rust hover:text-accent-rust underline">
              seven copies in total
            </Link>, spanning Latin, Arabic, and German &mdash; we discovered something unexpected. The{' '}
            <em>cellulae</em> passage, the rape argument, the infertility discussion: none of it appears
            in any other copy.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The reason is that our sixty-eight-page manuscript is a <strong>composite codex</strong>. The{' '}
            <em>Secretum Secretorum</em> proper &mdash; pseudo-Aristotle&apos;s advice to Alexander on
            governance, diet, and astrology &mdash; ends on{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446bf" className="text-accent-rust hover:text-accent-rust underline">
              page 26
            </Link>{' '}
            with a colophon. What follows, without announcement, is a different text entirely: the{' '}
            <em>Philosophia Mundi</em> of <strong>William of Conches</strong> (c. 1125), a twelfth-century
            natural philosopher from the Cathedral School of Chartres.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Disciple/Philosopher dialogue format is William&apos;s signature. He was not hiding behind
            Aristotle&apos;s name or claiming ancient authority. He was writing openly as a contemporary
            thinker, synthesizing Galen, Plato&apos;s <em>Timaeus</em>, and Salernitan medicine into a
            systematic account of the natural world. The <em>cellulae</em>, the two-seed theory, the rape
            argument &mdash; these are the work of a named twelfth-century author doing what he believed
            was rigorous natural philosophy.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Which makes the passage not &ldquo;ancient wisdom gone wrong&rdquo; but something arguably
            worse: <strong>a smart man following correct logical form from wrong premises to a monstrous
            conclusion</strong>. William of Conches was not being cynical. The body/will distinction
            (<em>delectatio carnis</em> versus <em>voluntas rationis</em>) is genuinely sophisticated &mdash;
            it anticipates later mind-body debates by centuries. He was recognizing that the flesh has
            responses independent of rational consent. But the legal system did not preserve the nuance.
            It took &ldquo;pleasure was present&rdquo; and made it a rule of evidence.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The accident of bookbinding &mdash; William&apos;s <em>Philosophia Mundi</em> stitched into
            a codex alongside the most popular text of the Middle Ages &mdash; was the transmission vector.
            A Chartres schoolmaster&apos;s thought experiment traveled under Aristotle&apos;s authority
            across Europe.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* V. Between the Horror and the Beauty */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            V. Between the Horror and the Beauty
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            There is one more passage worth noting. Two pages after the <em>cellulae</em>, two pages
            after the rape argument, on{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c7" className="text-accent-rust hover:text-accent-rust underline">
              page 34
            </Link>, William of Conches writes:
          </p>

          <figure className="my-12">
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c7">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.sourcelibrary.org/archived/6952306aab34727b1f0446a5/34.jpg"
                alt="Page 34 of the manuscript containing William of Conches' passage on memory and anticipation as the defining features of human cognition"
                className="w-full max-w-lg mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Page 34. Two pages after the rape argument, a striking formulation of human temporal consciousness.{' '}
              <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c7" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
            </figcaption>
          </figure>

          <div className="border-l-4 border-accent-rust pl-6 my-10">
            <p className="text-lg text-secondary italic font-body leading-relaxed">
              &ldquo;In this, man differs from the other animals: because they possess only the present,
              but man has, along with the present, the memory of things past and the conjecture of things
              future.&rdquo;
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            It is a striking formulation of what cognitive scientists now call &ldquo;mental time
            travel&rdquo; &mdash; the capacity to project consciousness backward and forward in time,
            which many researchers consider the defining feature of human cognition. William uses it
            to explain why pregnant humans still desire sex while other animals do not: because we can
            remember past pleasure and anticipate future pleasure, desire persists beyond its reproductive
            function.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The passage is beautiful, and it sits two pages from the rape argument. The same mind that
            could articulate the temporal structure of human consciousness could also reason its way into
            a doctrine that would harm women for eight centuries. This is not a contradiction. It is what
            careful reasoning looks like when the framework is wrong. The logic is valid; the premises are
            catastrophic.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* VI. What a Library Makes Possible */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            VI. What a Library Makes Possible
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            None of these findings required a research grant, a plane ticket, or a reading room
            appointment. They required a digital library with multiple copies of the same text,
            machine-readable translations from the original Latin and Arabic, and the ability to search
            across them.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library holds{' '}
            <Link href="/search?q=secretum+secretorum" className="text-accent-rust hover:text-accent-rust underline">
              seven copies of the <em>Secretum Secretorum</em>
            </Link>{' '}
            spanning Latin, Arabic, and German, dated from the twelfth to the sixteenth century. By
            searching all seven for the same passages, we could determine that the <em>cellulae</em> and
            the rape argument appear in only one &mdash; and that the one is a composite codex binding
            two different texts together.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The word <em>cellula</em> traveled from William of Conches&apos; womb chambers through five
            centuries of anatomical usage to Robert Hooke&apos;s microscope, and from there to Schleiden
            and Schwann and the foundation of modern biology. The rape argument traveled from the same
            pages through Bracton and English common law to a Missouri congressman in 2012. Both journeys
            began in the same manuscript, on adjacent pages, written by a man in twelfth-century Chartres
            who thought he was doing science.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The texts are there to read. The <em>cellulae</em> are on{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c5" className="text-accent-rust hover:text-accent-rust underline">
              page 32
            </Link>. The horror is on{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c6" className="text-accent-rust hover:text-accent-rust underline">
              page 33
            </Link>. The beauty is on{' '}
            <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle/page/6952306aab34727b1f0446c7" className="text-accent-rust hover:text-accent-rust underline">
              page 34
            </Link>. All translated, all open, all waiting for the next reader to notice something we missed.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* Sources */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl text-primary mb-6">
            Sources and Further Reading
          </h2>

          <h3 className="font-serif text-lg text-primary mb-4 mt-8">Primary sources in Source Library</h3>
          <ul className="list-disc list-inside space-y-2 text-secondary font-body">
            <li>
              <Link href="/book/the-secret-of-secrets-manuscript-pseudo-aristotle" className="text-accent-rust hover:text-accent-rust underline">
                <em>Aristotelis Secretum Secretorum</em>
              </Link>{' '}
              (15th-century Latin manuscript, including William of Conches&apos; <em>Philosophia Mundi</em>)
            </li>
          </ul>

          <h3 className="font-serif text-lg text-primary mb-4 mt-8">Secondary scholarship</h3>
          <ul className="list-disc list-inside space-y-2 text-secondary font-body text-sm">
            <li>
              Cadden, Joan. <em>Meanings of Sex Difference in the Middle Ages: Medicine, Science, and Culture.</em>{' '}
              Cambridge University Press, 1993.
            </li>
            <li>
              Kudlien, Fridolf. &ldquo;The Seven Cells of the Uterus: The Doctrine and Its Roots.&rdquo;{' '}
              <em>Bulletin of the History of Medicine</em> 39, no. 5 (1965): 415&ndash;423.
            </li>
            <li>
              Peters, Winfried S. &ldquo;The Cells of Robert Hooke: Wombs, Brains and Ammonites.&rdquo;{' '}
              <em>Notes and Records: The Royal Society Journal of the History of Science</em> (2024).
            </li>
            <li>
              Williams, Steven J. <em>The Secret of Secrets: The Scholarly Career of a Pseudo-Aristotelian
              Text in the Latin Middle Ages.</em> University of Michigan Press, 2003.
            </li>
            <li>
              Greenblatt, Samuel H. &ldquo;Where Did the Ventricular Localization of Mental Faculties
              Come From?&rdquo; <em>Journal of the History of the Behavioral Sciences</em> 39, no. 2
              (2003): 131&ndash;142.
            </li>
            <li>
              Lawn, Brian. <em>The Prose Salernitan Questions.</em> Oxford University Press, 1979.
            </li>
          </ul>
        </section>

      </article>
    </ContentPageLayout>
  );
}
