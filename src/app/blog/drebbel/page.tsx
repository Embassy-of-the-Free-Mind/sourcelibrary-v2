import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import DrebbelNetwork from '@/components/blog/DrebbelNetwork';

// Sources: the research dossier for #5898 (sourcelibrary-ops research/drebbel-blog:
// associates.md, primary-sources.md, our-holdings.md). Every Source Library quote below was
// checked against the page's stored translation on 2026-10-06. Claims the dossier could not
// document are listed in "What we could not confirm", not asserted. Catalogue problems found
// along the way are #6025.

const TITLE = 'The Engraver Who Went Under the Thames';
const DESCRIPTION =
  'Cornelis Drebbel built a perpetual-motion clock, a submarine, early microscopes and the first thermostat, and wrote almost nothing. What we know comes from the people around him. A map of his circle, with every tie marked by how well it is attested, and the passages in his own book.';

export const metadata: Metadata = {
  title: `${TITLE} - Research Notes - Source Library`,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: '/blog/drebbel' },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const A = 'text-accent-rust hover:underline';
const Q = 'border-l-2 border-accent-rust/40 pl-5 my-6 font-body text-primary leading-relaxed';
const CITE = 'block mt-2 text-sm text-muted not-italic';

const TREATISES = '/book/9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4';

function Quote({ children, cite }: { children: React.ReactNode; cite: React.ReactNode }) {
  return (
    <blockquote className={Q}>
      <p className="italic">{children}</p>
      <cite className={CITE}>{cite}</cite>
    </blockquote>
  );
}

export default function DrebbelPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={TITLE}
          subtitle="Cornelis Drebbel (1572–1633) in his own words and in the words of the people who knew him."
        >
          <p className="text-stone-400 text-sm mt-4">October 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-6 font-body">
          In the spring of 1620 a candle maker in Middelburg wrote to his son with news from England. The
          son, Isaac Beeckman, copied it into his journal on 15 March:
        </p>
        <Quote
          cite={
            <>
              Isaac Beeckman, <em>Journal</em>, ed. de Waard, vol. 2 (
              <a href="https://www.dbnl.org/tekst/beec002jour02_01/" className={A}>DBNL</a>). &ldquo;That Drebbel in England has
              made a boat with which he can travel under and above the water as he likes.&rdquo;
            </>
          }
        >
          dat DREBBEL in Engelandt een schuyte gepractiseert heeft, daermede hy onder ende boven water varen kan als hy wilt
        </Quote>
        <p className={P}>
          It is the earliest dated report of the submarine. Beeckman then worked out how such a boat might
          work, with a sealed ballast tank and a tap.
        </p>
        <p className={P}>
          Cornelis Drebbel is remembered for the submarine, a perpetual-motion clock, an early microscope and
          a self-regulating oven that counts as the first thermostat. He wrote very little. Most of what we
          know comes from the people around him, who bought his instruments, paid his salary, translated his
          one book and repeated stories about him for a century after his death. Here they are, 57 of them.
          Solid lines are ties with a document behind them, dashed lines are reports at second hand, and dotted
          lines are claims we could not confirm. Press Play to watch the circle form year by year, or click a
          name for the evidence.
        </p>

        <DrebbelNetwork />

        <section className="mb-14">
          <h2 className={H2}>Alkmaar and Haarlem</h2>
          <p className={P}>
            Drebbel was born in Alkmaar and trained as an engraver under Hendrick Goltzius in Haarlem. In 1595
            he married Goltzius&rsquo;s younger sister, Sophia. Two years later he engraved a large plan of his
            home town, and we hold it:{' '}
            <Link href="/book/69b525de2f891867c1ae5d21" className={A}>the 1597 map of Alkmaar</Link>, signed
            &ldquo;Cornelius Drebbel sculptor&rdquo;.
          </p>
          <p className={P}>
            By 1598 he had turned to machines. That year the States General of the Dutch Republic granted him a
            patent for an engine to raise fresh water &ldquo;like a fountain &hellip; to a height of twenty,
            thirty, forty, fifty and more feet through pipes&rdquo;, and for &ldquo;a clock or time-pointer that
            one may use for fifty, sixty, yes a hundred or more years in a row, without winding&rdquo;. In 1602
            they gave &ldquo;Cornelis Jacobsz Drebbel, burgher of Alkmaar&rdquo; another, for making smoking
            chimneys draw.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The perpetual motion</h2>
          <p className={P}>
            The clock that never needed winding made his name. He took it to England around 1605, where James I
            and Prince Henry lodged him at Eltham. In 1612 the clergyman Thomas Tymme published the first picture
            of it, describing &ldquo;a most strange and wittie invention of another Archimedes &hellip; as it was
            presented to the Kings most royall hands, by Cornelius Drebble of Alchmar in Holland&rdquo; (
            <Link href="/book/6ac3ade2864e04424c043050" className={A}>Tymme, <em>A Dialogue Philosophicall</em></Link>).
            Tymme used it as an argument that the earth stands still. Thirty-six years later John Wilkins found
            that absurd.
          </p>
          <p className={P}>
            What drove it? Drebbel&rsquo;s answer, in a letter to King James printed with his treatise, is that
            he found the cause by watching fire:
          </p>
          <Quote
            cite={
              <>
                Drebbel, letter to James I, in <em>Two Treatises</em> (1621),{' '}
                <Link href={`${TREATISES}?page=65`} className={A}>page 65</Link>. Source Library translation.
              </>
            }
          >
            Seeking with skillful inquiry that hidden cause which always forced water downward, I finally
            discovered it through the observation of the wonderful nature of fire. &hellip; I understood how the
            earth is carried in the middle of the air, how the water encircles the earth like a ring, and how all
            things seek the center, except for fire.
          </Quote>
          <p className={P}>
            Others guessed at the mechanism. Beeckman heard in 1622 that it was two glass half-rings holding a
            liquid that went up and down with the tide. The Jesuit Gaspar Schott wrote in 1657 that Drebbel
            &ldquo;is said to have enclosed two opposing and highly antipathetic liquids in a glass ring, which
            fought against each other in a perpetual struggle&rdquo; (
            <Link href="/book/69a5f6cd1cf742c3604142ea?page=475" className={A}>Schott, page 475</Link>). The
            likeliest explanation today is that the liquid rose and fell with changes in air temperature and
            pressure: a thermometer and barometer made into a clock.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Prague, and prison</h2>
          <p className={P}>
            In 1610 Drebbel went to Prague to work for the Emperor Rudolf II, promising Prince Henry he would be
            back within six months. Instead Rudolf&rsquo;s brother Matthias seized power and in 1611 imprisoned
            Rudolf&rsquo;s council, &ldquo;amongst others, Drebbel&rdquo;. His ovens and instruments were
            destroyed. Matthias later freed him and paid for his journey home.
          </p>
          <p className={P}>
            Many accounts add a second imprisonment in 1619&ndash;20, under Ferdinand II. We found no document
            for it, and Drebbel&rsquo;s signature in the album of Joachim Morsius puts him in London in November
            1619.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The book</h2>
          <p className={P}>
            Drebbel&rsquo;s one treatise, on the elements, came out in Dutch in 1604 and in Latin at Hamburg in
            1621, translated by Petrus Lauremberg; Morsius edited its companion treatise on the Fifth Essence.
            We hold the <Link href={TREATISES} className={A}>Latin edition with an English translation</Link>.
            Its voice is not what one expects from a court engineer. He claims nothing from the authorities:
          </p>
          <Quote
            cite={
              <>
                <em>Two Treatises</em>, <Link href={`${TREATISES}?page=11`} className={A}>page 11</Link>.
              </>
            }
          >
            I share those things which I myself have drawn and received from Nature.
          </Quote>
          <Quote
            cite={
              <>
                Letter to James I, <Link href={`${TREATISES}?page=67`} className={A}>page 67</Link>.
              </>
            }
          >
            For (I call God to witness) I have used here neither the writings of the ancients nor the help of any
            man&hellip;
          </Quote>
          <p className={P}>And he describes the elements as something he can arrange by hand:</p>
          <Quote
            cite={
              <>
                Letter to James I, <Link href={`${TREATISES}?page=66`} className={A}>page 66</Link>.
              </>
            }
          >
            I can suspend earth in the middle of water, water in the middle of air, and air in the middle of fire
            within a closed glass vessel &hellip; And in this way, I make the high low, the low high, the light
            heavy, and the heavy light.
          </Quote>
          <p className={P}>
            Athanasius Kircher took that glass &ldquo;sphere of elements&rdquo; seriously enough to argue about
            how it could be made (
            <Link href="/book/69527376ab34727b1f04948a?page=727" className={A}>Kircher, <em>Magnes</em>, page 727</Link>).
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Under the Thames</h2>
          <p className={P}>
            Back in London, around 1620, Drebbel built the boat Beeckman heard about. Robert Boyle, forty years
            later, had the story from Drebbel&rsquo;s own family:
          </p>
          <Quote
            cite={
              <>
                Boyle, <em>New Experiments Physico-Mechanicall</em> (1660) (
                <a href="https://archive.org/details/bim_early-english-books-1641-1700_new-experiments-physico-_boyle-robert_1660" className={A}>Internet Archive</a>).
              </>
            }
          >
            &hellip;a Vessel to go under Water; of which, tryal was made in the Thames, with admired successe, the
            Vessel carrying twelve Rowers, besides Passengers; one of which is yet alive.
          </Quote>
          <p className={P}>
            How did the rowers breathe? Boyle&rsquo;s informant, &ldquo;an Ingenious Physitian that marry&rsquo;d
            his daughter&rdquo;, said Drebbel held that it was not the whole air but &ldquo;a certain Quintessence
            (as Chymists speake) or spirituous part of it, that makes it fit for respiration&rdquo;, and that he
            restored it from &ldquo;a Chymicall liquor&rdquo; carried in the boat. The French traveller Balthasar
            de Monconys heard much the same in London in 1663: Drebbel &ldquo;knew how to extract a subtle spirit
            from the air&rdquo; (
            <Link href="/book/6a44359d0235c9147000dd12?page=43" className={A}>Monconys, page 43</Link>).
          </p>
          <p className={P}>
            By 1648 Wilkins could write in{' '}
            <Link href="/book/69aebe60c0472fef6455a8f3" className={A}><em>Mathematicall Magick</em></Link> that a
            submarine was &ldquo;beyond all Question, because it hath been already experimented here in England by
            Cornelius Dreble&rdquo;. In Paris, Marin Mersenne called it &ldquo;well known that a small ship was
            constructed by Cornelius Drebbel in England, which swam while submerged under the waters&rdquo; (
            <Link href="/book/69af0dab9f13b61d0a6c6105?page=309" className={A}>Mersenne, page 309</Link>).
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The young Huygens</h2>
          <p className={P}>
            In 1621 a young Dutch diplomat, Constantijn Huygens, met Drebbel in London. In appearance, he wrote,
            Drebbel was a Dutch farmer, but his learned talk recalled the sages of Samos and Sicily. Huygens came
            back that December and saw him constantly for a year: &ldquo;We possessed Drebbel for a whole year,
            and he possessed me too.&rdquo; He bought a camera obscura from him, showed it to the painters Jacques
            de Gheyn and Torrentius in The Hague, and wrote to his worried parents that Drebbel was no sorcerer.
          </p>
          <p className={P}>
            His son Christiaan, born four years before Drebbel died, later credited him with the compound
            microscope:
          </p>
          <Quote
            cite={
              <>
                Christiaan Huygens, <em>Opuscula postuma</em> (1703),{' '}
                <Link href="/book/69b6c2618566c838146599f0?page=245" className={A}>page 245</Link>.
              </>
            }
          >
            As for the year 1621, those who were present have often told me that such microscopes were seen in
            London, England, at the home of our countryman, Drebelius, and that he was then considered the first
            inventor of them.
          </Quote>
          <p className={P}>
            The microscopes travelled fast. In 1622 Drebbel sent Jacob Kuffler, brother of his future
            sons-in-law, to sell them abroad. Kuffler demonstrated one in Paris before Marie de&rsquo; Medici,
            and the collector Peiresc bought one. Peiresc&rsquo;s instruments went on to Rome, where they would
            not work until Galileo got them going in 1624 and began making his own.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Home, and war</h2>
          <p className={P}>
            The Dutch had not forgotten him. On 5 January 1624 two members of the States General were asked to
            consult Prince Maurice on whether to invite &ldquo;Mr Cornelis Drebbel &hellip; to come over from
            England, to speak with him&rdquo;. He stayed in England. Under Charles I he worked for the Navy and
            the Duke of Buckingham, building fireships and &ldquo;water-petards&rdquo; for the expeditions to La
            Rochelle in 1627 and 1628, reportedly at &pound;150 a month. The expeditions failed. Drebbel died in
            London in 1633.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The heirs</h2>
          <p className={P}>
            His inventions outlived him because his family kept them. Two of his daughters married the brothers
            Abraham and Johannes Sibertus Kuffler. Johannes Sibertus, a physician trained at Padua, ran a dye
            works in Leiden with a new tin-based scarlet, and carried the self-regulating oven into Samuel
            Hartlib&rsquo;s circle in the 1630s. In 1662 Jonathan Goddard suggested to the new Royal Society
            &ldquo;Drebbel&rsquo;s method of governing a furnace by a thermometer of quicksilver&rdquo;.
            Christopher Wren built a furnace &ldquo;like Mr Kuffler&rsquo;s&rdquo;, and a grandson&rsquo;s recipe
            book preserved the oven&rsquo;s design.
          </p>
          <p className={P}>
            One secret did not survive. Kuffler told Beeckman in 1634 that on his deathbed Drebbel said he could
            make perfect telescopes, with which his children could all become rich, but he died before he wrote
            it down.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>What we could not confirm</h2>
          <ul className="list-disc pl-6 space-y-2 text-secondary font-body mb-6">
            <li><strong>Ferdinand II.</strong> The 1619&ndash;20 tutoring and imprisonment have no document behind them.</li>
            <li><strong>Francis Bacon.</strong> Often linked to Drebbel; we found no passage in which Bacon names him.</li>
            <li><strong>Michael Maier, Simon Stevin, the Rosicrucians.</strong> No documented tie. Morsius is the only bridge to Rosicrucian circles.</li>
            <li><strong>James I in the submarine.</strong> The story that the king rode in it is not attested.</li>
            <li><strong>Jacob Kuffler</strong> was the brother of the two sons-in-law, not a son-in-law himself.</li>
          </ul>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Reading Drebbel in Source Library</h2>
          <ul className="list-disc pl-6 space-y-2 text-secondary font-body mb-6">
            <li>Drebbel, <Link href={TREATISES} className={A}><em>Two Treatises on the Nature of the Elements and the Fifth Essence</em></Link> (Latin, 1621, with English translation)</li>
            <li>Drebbel, <Link href="/book/6a9058b07f6818cc17cd5a93" className={A}><em>Ein kurtzer Tractat von der Natur der Elementen</em></Link> (German, 1608)</li>
            <li>Drebbel, <Link href="/book/69b525de2f891867c1ae5d21" className={A}>map of Alkmaar</Link> (1597)</li>
            <li>Tymme, <Link href="/book/6ac3ade2864e04424c043050" className={A}><em>A Dialogue Philosophicall</em></Link> (1612)</li>
            <li>Wilkins, <Link href="/book/69aebe60c0472fef6455a8f3" className={A}><em>Mathematicall Magick</em></Link> (1648)</li>
            <li>Boyle, <Link href="/book/6ac3af023b2f03f7e59cba4e" className={A}><em>The General History of the Air</em></Link> (1692)</li>
            <li>Monconys, <Link href="/book/6a44359d0235c9147000dd12" className={A}><em>Journal of the Voyages</em></Link> (1666)</li>
          </ul>
          <p className="text-sm text-muted font-body">
            Translations quoted from Source Library editions are machine translations made with AI, and each page
            says so.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
