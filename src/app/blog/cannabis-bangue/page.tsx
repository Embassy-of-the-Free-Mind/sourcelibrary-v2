import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: "Theire Soe Admirable Herbe: How the West Forgot, and Remembered, Cannabis - Source Library",
  description:
    'In 1689 a sea-captain set a sample of "bangue" on Robert Hooke\'s coffeehouse table, and the Royal Society met cannabis. But the plant had two lives, and the West had been forgetting one of them for two thousand years. A tour through sixty books in twelve languages.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/archived/69ef286185daccce30f2ca01/390.jpg', alt: 'Botanical woodcut of the cannabis plant labelled \'Bangue\' in Cristóvão da Costa\'s Tractado de las Drogas y Medicinas de las Indias Orientales, 1578' }],
    title: 'Theire Soe Admirable Herbe: How the West Forgot, and Remembered, Cannabis',
    description:
      'A sea-captain, a coffeehouse, and the Royal Society\'s first account of cannabis — and the two-thousand-year history it forgot. Sixty books, twelve languages.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/69ef286185daccce30f2ca01/390.jpg', alt: 'Botanical woodcut of the cannabis plant labelled \'Bangue\' in Cristóvão da Costa\'s Tractado de las Drogas y Medicinas de las Indias Orientales, 1578' }],
  },
  alternates: {
    canonical: '/blog/cannabis-bangue',
  },
};

export default function CannabisBanguePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Theire Soe Admirable Herbe"
          subtitle="How the West forgot, and remembered, cannabis"
          image="https://images.sourcelibrary.org/archived/69ef286185daccce30f2ca01/390.jpg"
          imageAlt="Botanical woodcut of the cannabis plant labelled 'Bangue' in Cristóvão da Costa's Tractado de las Drogas y Medicinas de las Indias Orientales, 1578"
        >
          <p className="text-stone-400 text-sm mt-4">19 June 2026 &middot; 9 min read</p>
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
          On 18 December 1689,{' '}
          <Link href="/author/robert-hooke" className="text-accent-rust hover:text-accent-rust underline">
            Robert Hooke
          </Link>{' '}
          &mdash; curator of experiments at the Royal Society, Newton&apos;s
          rival, the man who gave biology the word <em>cell</em> &mdash; stood before the Fellows to describe
          a drug. He had been handed a sample six weeks earlier by an old friend, the sea-captain Robert Knox,
          over coffee in a London coffeehouse. Knox had spent nearly twenty years a captive in Ceylon and
          credited the plant with keeping him well on foul water during his escape. Hooke gave the Society the
          plant&apos;s names as the traders knew them:{' '}
          <Link href="/book/philosophical-experiments-and-observations-hooke/page/695595e67bd6d2cd1d620307" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;&apos;Tis call&apos;d, by the <em>Moors</em>, Gange; by the <em>Chingalese</em>, Comsa, and by
            the <em>Portugals</em>, Bangue.&rdquo;
          </Link>
        </p>

        <figure className="my-12">
          <Link href="/book/tractado-de-las-drogas-y-medicinas-de-las-indias-orientales-costa/page/69ef286185daccce30f2cb87">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/archived/69ef286185daccce30f2ca01/390.jpg"
              alt="Botanical woodcut of the cannabis plant from Cristóvão da Costa's 1578 Tractado, showing root, stem, serrated leaves, and flowering tops, labelled Bangue"
              className="w-full max-w-md mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            &ldquo;Bangue&rdquo; &mdash; cannabis as the Portuguese met it in the Indies. Cristóvão da Costa,
            <em> Tractado de las Drogas y Medicinas de las Indias Orientales</em>, 1578.{' '}
            <Link href="/book/tractado-de-las-drogas-y-medicinas-de-las-indias-orientales-costa/page/69ef286185daccce30f2cb87" className="text-accent-rust hover:text-accent-rust not-italic">View in Source Library &rarr;</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Hooke&apos;s report, printed posthumously in his{' '}
          <Link href="/book/philosophical-experiments-and-observations-hooke/page/695595e67bd6d2cd1d620307" className="text-accent-rust hover:text-accent-rust underline">
            <em>Philosophical Experiments and Observations</em>
          </Link>{' '}
          (1726), is precise and a little astonished. The dose is{' '}
          <Link href="/book/philosophical-experiments-and-observations-hooke/page/695595e67bd6d2cd1d620307" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;about as much as may fill a common Tobacco-Pipe&rdquo;
          </Link>; the patient grows{' '}
          <Link href="/book/philosophical-experiments-and-observations-hooke/page/695595e67bd6d2cd1d620307" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;unable to speak a Word of Sense, yet is he very merry, and laughs, and sings&rdquo;
          </Link>. And his verdict: it might{' '}
          <Link href="/book/philosophical-experiments-and-observations-hooke/page/695595e67bd6d2cd1d620309" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;prove as considerable a Medicine in Drugs, as any that is brought from the Indies&rdquo;
          </Link>. He even tried to grow the seeds in London.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          This is usually told as a charming first &mdash; the earliest detailed English-language scientific
          account of cannabis. But the historian Benjamin Breen, in <em>The Age of Intoxication</em> (2019),
          reads the same scene more sharply. Hooke knew nothing of this plant&apos;s effects until an imperial
          sailor handed it to him; the knowledge traveled along the arteries of the East India Company and was
          then quietly relabeled as European discovery.{' '}
          <a href="https://publicdomainreview.org/essay/how-the-english-found-cannabis" className="text-accent-rust hover:text-accent-rust underline" target="_blank" rel="noopener noreferrer">
            Breen&apos;s argument
          </a>{' '}
          is that early-modern science was built on colonial knowledge networks while erasing the non-European
          people who supplied them &mdash; and that every decision about intoxicants is, at root, a judgment
          about cultural difference. A drug is medicine or vice depending on who is holding it.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          The Source Library collection{' '}
          <Link href="/collections/cannabis-western-record" className="text-accent-rust hover:text-accent-rust underline">
            <em>An Account of the Plant</em>
          </Link>{' '}
          is, in effect, the receipts. Sixty books across twelve languages, from 200 BCE to 1925, let you watch
          that judgment get made, unmade, and made again.
        </p>

        <hr className="border-border-light my-12" />

        {/* I. Two lives */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">I. The Plant Had Two Lives</h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Read the European herbals and you would never guess cannabis could do anything to the mind. From
            Dioscorides through the hand-coloured woodcuts of the 1484{' '}
            <Link href="/book/herbarius-latinus-with-german-synonyms/page/69dbca381040d1d5e20aa2b1" className="text-accent-rust hover:text-accent-rust underline">
              <em>Herbarius latinus</em>
            </Link>, Leonhart Fuchs&apos;s{' '}
            <Link href="/book/de-historia-stirpium-commentarii-insignes-fuchs-2/page/69a5d8114d84314297c08ace" className="text-accent-rust hover:text-accent-rust underline">
              <em>De historia stirpium</em>
            </Link>{' '}
            (1542), and Mattioli&apos;s Italian <em>Discorsi</em> (1568), hemp is a sober fibre-and-seed crop:
            &ldquo;hot and dry,&rdquo; good for rope, the seed good for the ears. Europe grew the plant for two
            millennia and wrote, essentially, nothing about its high. The word itself &mdash; Greek{' '}
            <em>kánnabis</em>, Latin <em>cannabis</em>, German <em>Hanf</em>, Dutch <em>hennep</em>, Russian{' '}
            <em>konoplja</em>, all the way back to Assyrian <em>qunnabu</em> &mdash; is one ancient root that
            traveled with the crop across Eurasia.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The <em>other</em> life of the plant lived in the East, under entirely different names, and those
            texts are in the collection too. The oldest is the most startling. The Chinese{' '}
            <Link href="/book/the-divine-farmers-classic-of-materia-medica/page/69ee19caa478f461b9eb639b" className="text-accent-rust hover:text-accent-rust underline">
              <em>Shennong Bencao Jing</em>
            </Link>{' '}
            (by ~200 BCE) already warns that eating cannabis flowers &ldquo;makes people see ghosts and run
            wildly,&rdquo; and that long-term use &ldquo;connects with the divine light.&rdquo; China knew the high at
            the very dawn of its pharmacopeia &mdash; then set it aside, domesticating cannabis as a fibre
            staple. India did the opposite, sacralizing it as <em>vijayā</em>, &ldquo;the victorious&rdquo;;
            the Ayurvedic{' '}
            <a href="https://sourcelibrary.org/q/BikGhXedgmGP6zkhMFw" className="text-accent-rust hover:text-accent-rust underline">
              <em>Sushruta Saṃhitā</em>
            </a>{' '}
            files it among the fast-acting drugs, &ldquo;for example, cannabis and opium.&rdquo; The Islamic
            world made the resin a mass intoxicant and gave us, by way of the hashish-eaters, our word{' '}
            <em>assassin</em> &mdash; a story Edward Lane lays out in his{' '}
            <Link href="/book/an-account-of-the-manners-and-customs-of-the-modern-lane/page/69907936b621b177c1af5b49" className="text-accent-rust hover:text-accent-rust underline">
              <em>Modern Egyptians</em>
            </Link>.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Even this written record sits on top of something older. In 2019, archaeologists found high-THC
            cannabis residue in mortuary braziers at the Jirzankal cemetery in the Pamirs, dated to about
            500 BCE &mdash; ritual cannabis smoking that predates every text we hold. Herodotus saw a version
            of it among the Scythians: in our{' '}
            <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus/page/69937cdbc970b9f8351dd39d" className="text-accent-rust hover:text-accent-rust underline">
              <em>Histories</em>
            </Link>{' '}
            they throw hemp-seed on hot stones and howl with pleasure in the vapour-bath.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* II. The bridge word */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">II. The Bridge Word, and the Forgetting</h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The two lives met at a single word: <strong>bangue</strong>. It is the Portuguese transliteration
            (from Persian <em>bang</em>, Sanskrit <em>bhaṅgā</em>) that the Indies pharmacologists carried into
            European print &mdash; Garcia de Orta, Monardes, and Cristóvão da Costa, whose{' '}
            <Link href="/book/tractado-de-las-drogas-y-medicinas-de-las-indias-orientales-costa/page/69ef286185daccce30f2cb88" className="text-accent-rust hover:text-accent-rust underline">
              <em>Tractado de las Drogas</em>
            </Link>{' '}
            (1578) gives a chapter and a botanical plate to &ldquo;the Bangue.&rdquo; It is <em>bangue</em>{' '}
            that Knox carried to Hooke. The hinge of the whole story is a loan-word.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Then came the forgetting. When W. B. O&apos;Shaughnessy published his famous Calcutta studies of
            &ldquo;Indian hemp&rdquo; in the 1840s, and when Moreau de Tours used hashish to model madness in{' '}
            <em>Du hachisch et de l&apos;aliénation mentale</em> (1845), the Victorians hailed it as cannabis{' '}
            <em>entering</em> Western medicine. But Avicenna had catalogued <em>qinnab</em> in the{' '}
            <em>Canon</em> eight centuries earlier; Ibn al-Baytar and the Persian <em>Makhzan al-Adviyah</em>{' '}
            had it; Hooke and Knox had it in 1689. The &ldquo;discovery&rdquo; was a re-importation with the
            sources filed off. (Anna Winterbottom&apos;s study of Knox&apos;s Ceylon narrative traces exactly
            how a captive&apos;s account became a scientific source.)
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            By the time Baudelaire is dissolving a spoonful of{' '}
            <Link href="/book/les-paradis-artificiels-opium-et-haschisch-charles-baudelair/page/6a08a2b743d85a6ece189398" className="text-accent-rust hover:text-accent-rust underline">
              <em>dawamesc</em>
            </Link>{' '}
            in <em>Les Paradis Artificiels</em> (1860) and Fitz Hugh Ludlow is narrating his visions in{' '}
            <em>The Hasheesh Eater</em> (1857), the same molecule Avicenna prescribed for earache has become a
            satanic shortcut to a false paradise &mdash; and then, with the Indian Hemp Drugs Commission of
            1894, an object of imperial bureaucracy. Same plant; opposite verdict; different century.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* III. What the collection teaches */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">III. What the Collection Teaches</h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Lined up end to end, these sixty books make an argument no single one of them makes: that
            &ldquo;medicine versus vice&rdquo; is a cultural verdict, not a property of a plant; that the
            &ldquo;respectable&rdquo; seed and the &ldquo;dangerous&rdquo; flower have been split apart in
            every tradition; and that what Europe called the <em>discovery</em> of cannabis was really the
            slow, repeated rediscovery of what China, India, and the Islamic world had written down &mdash; and
            what the Pamir herders had burned in their braziers &mdash; long before a sea-captain set a sample
            on Robert Hooke&apos;s coffeehouse table.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The books are open to read, in their original Chinese, Sanskrit, Arabic, Persian, Greek, Latin,
            Italian, Dutch, French, German, Spanish, and English.{' '}
            <Link href="/collections/cannabis-western-record" className="text-accent-rust hover:text-accent-rust underline">
              Browse the whole collection &rarr;
            </Link>
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* Sources */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl text-primary mb-6">Sources and Further Reading</h2>

          <h3 className="font-serif text-lg text-primary mb-4 mt-8">Primary sources in Source Library</h3>
          <ul className="list-disc list-inside space-y-2 text-secondary font-body text-sm">
            <li>
              Robert Hooke,{' '}
              <Link href="/book/philosophical-experiments-and-observations-hooke/page/695595e67bd6d2cd1d620307" className="text-accent-rust hover:text-accent-rust underline">
                <em>Philosophical Experiments and Observations</em>
              </Link>{' '}
              (1726) &mdash; &ldquo;An Account of the Plant called Bangue&rdquo; (read to the Royal Society, 1689).
            </li>
            <li>
              Cristóvão da Costa,{' '}
              <Link href="/book/tractado-de-las-drogas-y-medicinas-de-las-indias-orientales-costa" className="text-accent-rust hover:text-accent-rust underline">
                <em>Tractado de las Drogas</em>
              </Link>{' '}
              (1578); the <em>Shennong Bencao Jing</em>; the <em>Sushruta Saṃhitā</em>; Edward Lane,{' '}
              <em>Modern Egyptians</em>; Baudelaire, <em>Les Paradis Artificiels</em> &mdash; all in the{' '}
              <Link href="/collections/cannabis-western-record" className="text-accent-rust hover:text-accent-rust underline">
                collection
              </Link>.
            </li>
          </ul>

          <h3 className="font-serif text-lg text-primary mb-4 mt-8">Secondary scholarship</h3>
          <ul className="list-disc list-inside space-y-2 text-secondary font-body text-sm">
            <li>
              Breen, Benjamin. <em>The Age of Intoxication: Origins of the Global Drug Trade.</em> University of
              Pennsylvania Press, 2019; and &ldquo;Theire Soe Admirable Herbe,&rdquo; <em>Public Domain Review</em> (2020).
            </li>
            <li>
              Winterbottom, Anna. &ldquo;Producing and Using the <em>Historical Relation of Ceylon</em>: Robert
              Knox, the East India Company and the Royal Society.&rdquo; <em>British Journal for the History of
              Science</em> 42, no. 4 (2009): 515&ndash;538.
            </li>
            <li>
              Touw, Mia. &ldquo;The Religious and Medicinal Uses of Cannabis in China, India and Tibet.&rdquo;{' '}
              <em>Journal of Psychoactive Drugs</em> 13, no. 1 (1981): 23&ndash;34.
            </li>
            <li>
              Russo, Ethan B. &ldquo;History of Cannabis and Its Preparations in Saga, Science, and Sobriquet.&rdquo;{' '}
              <em>Chemistry &amp; Biodiversity</em> 4 (2007): 1614&ndash;1648.
            </li>
            <li>
              Mills, James H. <em>Cannabis Britannica: Empire, Trade, and Prohibition 1800&ndash;1928.</em>{' '}
              Oxford University Press, 2003.
            </li>
            <li>
              Ren, Meng, et al. &ldquo;The Origins of Cannabis Smoking: Chemical Residue Evidence from the
              First Millennium BCE in the Pamirs.&rdquo; <em>Science Advances</em> 5, no. 6 (2019): eaaw1391.
            </li>
          </ul>
        </section>

      </article>
    </ContentPageLayout>
  );
}
