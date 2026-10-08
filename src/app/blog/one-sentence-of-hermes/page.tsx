import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Every reading of a printed or written page below was checked against the scan on 2026-10-07/08,
// and the crops in public/blog/one-sentence-of-hermes are cut from those scans. Quoted English is our
// served translation (or Scott's own English), copied verbatim from the page it links to. Where the
// hand of the manuscript could not be read with confidence, the text says so. The OCR misreads
// are logged on #4877; nothing in the stored text had been corrected when this was written.

const DIR = '/blog/one-sentence-of-hermes';
const HERO = `${DIR}/1532-asclepius-32.jpg`;
const HERO_ALT =
  'The Asclepius, chapter 32, in the Basel edition of 1532: the sentence on the intelligence of the human sense, and below it “Aeternitas, quae ſecunda est”.';

const TITLE = 'One Sentence of Hermes, Copied for Sixteen Hundred Years';
const DESCRIPTION =
  'A late-antique translator misread one Greek word in the Asclepius. We followed the sentence through a manuscript, five printed editions, a commentary and a critical edition, and found our own OCR making the copyists’ mistakes.';

export const metadata: Metadata = {
  title: `${TITLE} - Research Notes - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/one-sentence-of-hermes' },
};

const BOOK = {
  scott: '/book/69a97a1bf3f3d2fb7de26ca4',
  scottText: '/book/6953a93977f38f6761bd58f4',
  ms: '/book/69b4c08d86a5921d5bc445cf',
  basel: '/book/69c4ec33a3a4a7c546ee6123',
  rosseli: '/book/69b51e19261c58d63664f8d4',
  patrizi: '/book/69b51ebb47b06ecd5819628b',
  apuleius: '/book/6a10090bf717292950967757',
  aldine: '/book/69b51eb747b06ecd58195d39',
  tournes: '/book/6952ca2a77f38f6761bc33bf',
};

const linkClass = 'text-accent-rust underline hover:text-accent-gold-dark';

function Figure({ src, alt, children }: { src: string; alt: string; children: React.ReactNode }) {
  return (
    <figure className="my-8">
      <img src={src} alt={alt} className="w-full rounded-lg border border-stone-200" />
      <figcaption className="text-sm text-muted mt-3 leading-relaxed">{children}</figcaption>
    </figure>
  );
}

const th = 'px-3 py-2 text-left font-semibold text-stone-700 border border-stone-200';
const td = 'px-3 py-2 text-stone-600 border border-stone-200 align-top';

export default function OneSentenceOfHermesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={TITLE}
          subtitle="A translator misread one Greek word. Copyists, printers, a commentator and our own OCR did the rest."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">8 October 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          The <em>Asclepius</em> is a dialogue in which Hermes Trismegistus teaches his pupils about God, the world and
          the human soul. It was written in Greek, probably in the third century, and translated into Latin by the early fifth,
          when Augustine quoted the Latin in the <em>City of God</em>. For most of the dialogue, including the passage
          followed here, the Greek is lost. Every reader since late antiquity has known it through that one Latin
          translation.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A little of the Greek does survive. Its title was the <em>Logos teleios</em>, the &ldquo;Perfect
          Discourse&rdquo;. Lactantius, writing about 310, quotes it in Greek and refers to three different parts of it. The prayer that
          closes the dialogue is preserved in Greek in a magical papyrus now in the Louvre. A Coptic translation of
          chapters 21 to 29 and of the prayer was found at Nag Hammadi in 1945. None of these reaches chapter 32.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The Latin is not Marsilio Ficino&rsquo;s, though it is often taken for his. Ficino translated the fourteen
          Greek treatises of the <em>Pimander</em> in 1463, and their Greek survives. From the early sixteenth century
          printers bound the old Latin <em>Asclepius</em> in with his <em>Pimander</em>, as the Aldine press did in
          1516, and the two have travelled together since. The <em>Asclepius</em> translation is a thousand years
          older than Ficino. The manuscripts credit it to Apuleius, which Scott and other modern editors reject, and
          its translator is unknown.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This note follows a single sentence from chapter 32 through the copies of it we hold: a fifteenth-century
          manuscript, printed editions of 1516, 1532, 1549, 1593 and 1778, a Franciscan commentary of 1590, and Walter
          Scott&rsquo;s critical edition of the 1920s. Each copy was read against its scan. The sentence turned out to
          carry almost every kind of error a text can pick up on its way to us, including some we added ourselves this
          year.
        </p>

        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">The sentence</h2>

        <p className="text-secondary leading-relaxed mb-4">
          Hermes has been describing three kinds of mind: God&rsquo;s, the world&rsquo;s and ours. Then the Latin says:
        </p>

        <blockquote className="border-l-4 border-accent-gold/40 pl-5 my-6 italic text-stone-700">
          Intelligentia enim sensus humani qualis aut quanta sit, tota est in memoria praeteritorum. Per eam enim
          memoriae tenacitatem, gubernator effectus est terrae. Intellectus autem naturae et qualitatis sensus mundi ex
          omnibus quae in mundo sensibilia sunt, poterit pervideri.
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          Word for word: &ldquo;For the intelligence of the human sense, of what kind or how great it is, is all in the
          memory of things past. Through that tenacity of memory he was made governor of the earth. But the
          understanding of the nature and quality of the sense of the world can be seen through from all sensible things
          in the world.&rdquo; The middle sentence is clear. The first and third are not: &ldquo;the intelligence of
          the human sense, of what kind or how great it is&rdquo; has no work to do in its own sentence, and the third
          sentence repeats the oddity with the world in place of man. A few lines later it comes round a third time, for
          God.
        </p>

        <Figure src={HERO} alt={HERO_ALT}>
          The passage in the Basel edition of 1532, p. 159 (
          <Link href={`${BOOK.basel}?page=163`} className={linkClass}>
            read the page
          </Link>
          ). Copy: Bibliotheca Philosophica Hermetica, Amsterdam.
        </Figure>

        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">What went wrong in the translation</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Walter Scott, editing the Hermetica in the 1920s, said plainly that the Latin makes no sense here, and
          asked why. His argument is short. A copyist garbles a phrase once, at random. This
          phrase is wrong in the same way three times, so the fault is not in the copying of the Latin but in the
          translation itself (
          <Link href={`${BOOK.scott}?page=226`} className={linkClass}>
            Scott&rsquo;s commentary, pp. 214&ndash;15
          </Link>
          ).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          He then works backwards to the Greek. Suppose Hermes wrote <em>ἡ γνῶσις ἡ κατὰ τὸ ποιόν</em>, &ldquo;the
          knowledge that corresponds to the character of&rdquo; a given mind. The preposition <em>κατά</em> here means
          &ldquo;in keeping with&rdquo;. If the translator took it to mean &ldquo;of&rdquo;, he would turn &ldquo;the
          knowledge that fits the human mind&rdquo; into &ldquo;the knowledge <em>of the quality</em> of the human
          mind&rdquo;, and then, treating <em>ποιόν</em> and <em>ποσόν</em> (&ldquo;of what kind&rdquo;, &ldquo;how
          much&rdquo;) as questions, into <em>qualis aut quanta sit</em>. Read with <em>κατά</em> restored, the passage
          sets out three grades of knowledge, each matched to a kind of mind. This is how Scott translates it (
          <Link href={`${BOOK.scottText}?page=361`} className={linkClass}>
            p. 357
          </Link>
          ):
        </p>

        <blockquote className="border-l-4 border-accent-gold/40 pl-5 my-6 text-stone-700">
          The knowledge which corresponds to the character and extent of the human mind is based wholly on man&rsquo;s
          memory of the past; it is the retentiveness of his memory that has given him dominion over the earth. The
          knowledge which corresponds to the nature and character of the cosmic mind is such as can be procured from
          all the sensible things in the Kosmos.
        </blockquote>

        <p className="text-secondary leading-relaxed mb-8">
          Scott marks every Greek word he supplies with a question mark, and says that the sense he recovers cannot be
          considered certain. With the Greek lost, it is a reconstruction. It is also the only reading so far that
          makes the sentence mean something.
        </p>

        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">Copied faithfully, for centuries</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The broken phrase is in every copy we hold, word for word: the{' '}
          <Link href={`${BOOK.ms}?page=440`} className={linkClass}>
            fifteenth-century manuscript
          </Link>{' '}
          now in the Biblioteca Laurenziana in Florence, the{' '}
          <Link href={`${BOOK.aldine}?page=268`} className={linkClass}>
            Aldine edition of 1516
          </Link>
          , the{' '}
          <Link href={`${BOOK.basel}?page=163`} className={linkClass}>
            Basel edition of 1532
          </Link>
          , Jean de Tournes&rsquo;s{' '}
          <Link href={`${BOOK.tournes}?page=530`} className={linkClass}>
            Lyon edition of 1549
          </Link>
          , Francesco Patrizi&rsquo;s{' '}
          <Link href={`${BOOK.patrizi}?page=163`} className={linkClass}>
            <em>Magia philosophica</em> of 1593
          </Link>{' '}
          and the{' '}
          <Link href={`${BOOK.apuleius}?page=182`} className={linkClass}>
            1778 edition of Apuleius
          </Link>
          . None of them flags it or tries to mend it. Faced with a sentence they could not understand in a book
          ascribed to Hermes, these copyists and editors preserved it exactly.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          In 1590 the Calabrian Franciscan Hannibal Rosseli, teaching in Kraków, reached this sentence in his
          six-volume commentary on Hermes. He sets it as the heading of a chapter (
          <Link href={`${BOOK.rosseli}?page=367`} className={linkClass}>
            Book VI, Commentary XI
          </Link>
          ) and spends two pages explaining it through Boethius and Augustine. In our translation of his Latin:
        </p>

        <blockquote className="border-l-4 border-accent-gold/40 pl-5 my-6 text-stone-700">
          Rightly, therefore, was it said by the most wise Mercury that the intelligence of the human sense&mdash;that
          is, to understand, or the act of understanding of the human intellect&mdash;proceeds from the memory of the
          past
        </blockquote>

        <p className="text-secondary leading-relaxed mb-8">
          His gloss drops <em>qualis aut quanta sit</em> and keeps the part that makes sense. A few lines earlier on
          the same page he quotes Augustine: &ldquo;Whoever understands any thing otherwise than it is, is
          deceived.&rdquo;
        </p>

        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">Copyists and printers add their own</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The translator&rsquo;s error is consistent. The errors that came after it are not. Scott&rsquo;s apparatus
          records that the medieval manuscripts already disagree over the third sentence. One group reads{' '}
          <em>et qualitate</em>, another <em>ex qualitate</em>, a third <em>qualitate et</em>, and Scott prints the
          emendation <em>et qualitatis</em> (
          <Link href={`${BOOK.scottText}?page=360`} className={linkClass}>
            p. 356
          </Link>
          ). The printed editions inherit the split. The Aldine of 1516 has{' '}
          <em>naturae, &amp; qualitatis, &amp; sensus mundi</em>; Basel in 1532 has{' '}
          <em>naturae qualitate &amp; sensus mundi</em>; the Apuleius of 1778 has{' '}
          <em>naturae et qualitatis sensus mundi</em>.
        </p>

        <Figure
          src={`${DIR}/1516-aldine.jpg`}
          alt="The passage in the Aldine edition of 1516, set in small roman type across a folio page."
        >
          The Aldine edition (Venice, 1516), in which the <em>Asclepius</em> follows Ficino&rsquo;s translations of
          Iamblichus, Proclus and the <em>Pimander</em> (
          <Link href={`${BOOK.aldine}?page=268`} className={linkClass}>
            read the page
          </Link>
          ). Copy: Bayerische Staatsbibliothek.
        </Figure>

        <p className="text-secondary leading-relaxed mb-6">
          Sixteen years separate the Aldine from the Basel edition, and in that time a clause went missing. After{' '}
          <em>umbra dignoscitur</em> the Aldine continues <em>ubi enim quid temporum dimensione cognoscitur, ubi sunt
          mendacia</em>: &ldquo;for where anything is known by the measure of time, there are falsehoods&rdquo;. In the Basel edition <em>dignoscitur</em> is followed directly by{' '}
          <em>Vbi sunt mendacia</em>. Six words have dropped out: the eye went from <em>dignoscitur. ubi</em> to <em>cognoscitur. ubi</em>. Patrizi&rsquo;s
          edition of 1593 has the same gap, and the Lyon edition of 1549 and the Apuleius of 1778 do not. A shared
          omission of this kind is how editors work out which copy was made from which: Patrizi&rsquo;s text belongs
          to the Basel line, not the Aldine one.
        </p>

        <Figure
          src={`${DIR}/1778-asclepius-32.jpg`}
          alt="The same passage in the 1778 Apuleius: “naturae et qualitatis sensus mundi”, and “Aeternitas quae ſecunda est”."
        >
          The same lines in the 1778 edition of Apuleius, p. 175 (
          <Link href={`${BOOK.apuleius}?page=182`} className={linkClass}>
            read the page
          </Link>
          ). Compare the third sentence with the 1532 text above.
        </Figure>

        <p className="text-secondary leading-relaxed mb-6">
          Patrizi&rsquo;s 1593 edition adds a slip of its own a few lines further on. The 1778 text reads:
        </p>

        <blockquote className="border-l-4 border-accent-gold/40 pl-5 my-6 italic text-stone-700">
          Hoc autem differt intellectus a <strong>sensu</strong>, quod intellectus noster ad qualitatem{' '}
          <strong>sensus</strong> mundi intelligendam&hellip;
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">Patrizi&rsquo;s page has:</p>

        <Figure
          src={`${DIR}/1593-eye-skip.jpg`}
          alt="Patrizi 1593: “Hoc enim differt intellectus à ſenſu mundi, intelligendam, & dinoſcendam mentis præuenit intentionem.”"
        >
          Patrizi, <em>Magia philosophica</em> (Hamburg, 1593), p. 164 (
          <Link href={`${BOOK.patrizi}?page=164`} className={linkClass}>
            read the page
          </Link>
          ). Copy: Bayerische Staatsbibliothek.
        </Figure>

        <p className="text-secondary leading-relaxed mb-8">
          The words between <em>sensu</em> and the next <em>sensus</em>, &ldquo;quod intellectus noster ad
          qualitatem&rdquo;, are gone. The eye of the compositor, or of whoever made his copy, jumped from one word to the same word further on and
          carried on from there. Textual critics call this <em>saut du même au même</em>, the jump from same to same,
          and it is the commonest copying error there is. What is left reads &ldquo;the intellect differs from the
          sense of the world, to be understood and discerned&rdquo;, which is not Latin anyone wrote.
        </p>

        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">The same mistakes, in 2026</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library&rsquo;s transcriptions are made by AI models reading the page images, and its translations by
          AI models reading the transcriptions. When we checked our text of this passage against the scans, we found
          our own copies of it had picked up three of the old kinds of error.
        </p>

        <h3 className="text-xl font-serif font-semibold mt-8 mb-3 text-primary">The long s</h3>

        <p className="text-secondary leading-relaxed mb-6">
          Just after our sentence comes a phrase that Scott thinks has strayed from earlier in the chapter:{' '}
          <em>aeternitas quae secunda est</em>, &ldquo;eternity, which is second&rdquo;. Printers of the period set a
          long s, <span className="font-sans not-italic">ſ</span>, at the start and in the middle of words. It differs from <em>f</em> only by the short bar,
          which on the <span className="font-sans not-italic">ſ</span> stops at the left side of the stem and on the <em>f</em> crosses it. Misreading one as
          the other is the classic mistake of anyone new to early print.
        </p>

        <Figure
          src={`${DIR}/1532-secunda.jpg`}
          alt="Basel 1532: “Aeternitas, quæ ſecunda eſt ex ſenſibili mundo”."
        >
          Basel, 1532: <em>quae secunda est ex sensibili mundo</em>. The first letter of <em>secunda</em> has the same
          form as the two long s letters in <em>sensibili</em> beside it; compare the crossed <em>f</em> in <em>effectus</em> in the
          full passage above.
        </Figure>

        <Figure src={`${DIR}/1593-secunda.jpg`} alt="Patrizi 1593: “Æternitas quę ſecunda eſt ex ſenſibili mundo”.">
          Patrizi, 1593: the same word, the same long s.
        </Figure>

        <p className="text-secondary leading-relaxed mb-6">
          All five printed editions whose scans we checked print <em>secunda</em>, with the long s. Our OCR read
          four of them as <em>fecunda</em>, &ldquo;fruitful&rdquo;, and our translations follow it. It read the fifth
          correctly:
        </p>

        <div className="overflow-x-auto my-6">
          <table className="min-w-full border-collapse border border-stone-200 text-sm">
            <thead className="bg-stone-100">
              <tr>
                <th className={th}>Edition</th>
                <th className={th}>Printed</th>
                <th className={th}>Our OCR</th>
                <th className={th}>Our English</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>
                  <Link href={`${BOOK.aldine}?page=268`} className={linkClass}>
                    Venice, 1516
                  </Link>
                </td>
                <td className={td}><em>secunda</em> (long s)</td>
                <td className={td}><em>fecunda</em></td>
                <td className={td}>&ldquo;Eternity, which is fruitful&rdquo;</td>
              </tr>
              <tr>
                <td className={td}>
                  <Link href={`${BOOK.basel}?page=163`} className={linkClass}>
                    Basel, 1532
                  </Link>
                </td>
                <td className={td}><em>secunda</em> (long s)</td>
                <td className={td}><em>fecunda</em></td>
                <td className={td}>&ldquo;Eternity, which is fruitful&rdquo;</td>
              </tr>
              <tr>
                <td className={td}>
                  <Link href={`${BOOK.tournes}?page=530`} className={linkClass}>
                    Lyon, 1549
                  </Link>
                </td>
                <td className={td}><em>secunda</em> (long s)</td>
                <td className={td}><em>secunda</em></td>
                <td className={td}>&ldquo;Eternity, which is second in rank&rdquo;</td>
              </tr>
              <tr>
                <td className={td}>
                  <Link href={`${BOOK.patrizi}?page=164`} className={linkClass}>
                    Patrizi, 1593
                  </Link>
                </td>
                <td className={td}><em>secunda</em> (long s)</td>
                <td className={td}><em>fecunda</em></td>
                <td className={td}>&ldquo;Eternity is fruitful&rdquo;</td>
              </tr>
              <tr>
                <td className={td}>
                  <Link href={`${BOOK.apuleius}?page=182`} className={linkClass}>
                    Apuleius, 1778
                  </Link>
                </td>
                <td className={td}><em>secunda</em> (long s)</td>
                <td className={td}><em>fecunda</em></td>
                <td className={td}>&ldquo;Eternity, which is fertile&rdquo;</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          <em>Fecunda</em> is a real Latin word, and &ldquo;fruitful eternity&rdquo; sounds like something Hermes might
          say. The wrong reading is easy to accept because it is plausible.
        </p>

        <h3 className="text-xl font-serif font-semibold mt-8 mb-3 text-primary">The skipped lines</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The Aldine page is a folio set in long lines of small type, and on it our OCR made the same slip as
          Patrizi&rsquo;s compositor, in almost the same place. The last four lines of the Aldine crop shown earlier read{' '}
          <em>
            hoc autem differt intellectus a sensu, quod intellectus noster, ad qualitatem sensus mundi intelligendam
            &hellip; &amp; sic contingit nobis hominibus
          </em>
          . Our transcription has <em>hoc autem intellectus a sensu, quod intellectus noster, git nobis
          hominibus</em>. It stopped at the end of one line, at <em>noster</em>, and resumed two lines further down,
          in the middle of the word <em>contingit</em>. Two lines of Hermes are missing from our text of that page,
          and the English built on it reads &ldquo;our intellect grants us humans that we might see those things that
          are in heaven as if through a mist&rdquo;, a sentence assembled from the two ends of the gap.
        </p>

        <h3 className="text-xl font-serif font-semibold mt-8 mb-3 text-primary">The easier reading</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The Florence manuscript is written in a small, heavily abbreviated cursive hand, and it is much harder for a
          machine to read than print. Here our OCR did something different. Where it could not read the hand, it wrote
          fluent Latin that is not on the page.
        </p>

        <Figure
          src={`${DIR}/manuscript-laurenziana.jpg`}
          alt="The passage in the Laurenziana manuscript, Plut. 89 sup. 71, with the word “confundi” written in the right margin."
        >
          Biblioteca Medicea Laurenziana, Plut. 89 sup. 71 (
          <Link href={`${BOOK.ms}?page=440`} className={linkClass}>
            read the leaf
          </Link>
          ). In the right margin someone has written <em>cõfundi</em>, the word the printed editions have at that point
          in the line.
        </Figure>

        <div className="overflow-x-auto my-6">
          <table className="min-w-full border-collapse border border-stone-200 text-sm">
            <thead className="bg-stone-100">
              <tr>
                <th className={th}>On the leaf</th>
                <th className={th}>Our OCR</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}><em>ne erubesceret aliorum commixtione animantium</em> (lest it blush at mingling with other living things)</td>
                <td className={td}><em>ne ex uberioris talis rei commistione erubescerent</em> (lest they blush from the mixture of such a richer thing)</td>
              </tr>
              <tr>
                <td className={td}><em>memoriae tenacitatem</em> (tenacity of memory)</td>
                <td className={td}><em>memoriae tenentem</em> (holding memory)</td>
              </tr>
              <tr>
                <td className={td}><em>Intellectus</em> [abbreviated word] <em>aut qualitate et sensus mundi</em></td>
                <td className={td}><em>Intelligentia vero mundi qualitatem et speciem mundi</em></td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Each machine reading looks like ordinary Latin and makes some sense, and a reader of our transcription would
          have no reason to doubt it. Textual critics have a name for this too: the <em>lectio facilior</em>, the
          easier reading. A copyist who cannot make out or cannot follow the text in front of him writes what he
          expects it to say. That is why editors give preference to the harder reading. A scholar comparing witnesses
          from our transcription would record &ldquo;ex uberioris talis rei&rdquo; as a variant of the Florence
          manuscript. It is not one.
        </p>

        <h3 className="text-xl font-serif font-semibold mt-8 mb-3 text-primary">A fluent translation of a broken sentence</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The last problem is quieter. Scott says the Latin of the sentence &ldquo;is impossible to make sense
          of&rdquo;. Our English of the 1532 text reads:
        </p>

        <blockquote className="border-l-4 border-accent-gold/40 pl-5 my-6 text-stone-700">
          For the intelligence of the human sense, of whatever sort or size it may be, exists entirely in the memory of
          past things. Through that tenacity of memory, man was made the governor of the earth. But the intellect of
          nature and the sense of the world can be perceived from all sensible things that are in the world.
        </blockquote>

        <p className="text-secondary leading-relaxed mb-8">
          It is a fair rendering of the Latin, and it gives no sign that the Latin is in trouble. &ldquo;Of whatever
          sort or size it may be&rdquo; smooths the broken phrase into an ordinary English aside. Rosseli did the same
          thing in 1590 by explaining it.
        </p>

        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">Three kinds of error</h2>

        <p className="text-secondary leading-relaxed mb-4">
          Followed through these copies, the errors in this one sentence fall into three groups.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>Misunderstanding.</strong> The translator misread how a Greek construction worked. Because he
          misread it the same way every time, the error is regular, and its regularity is what let Scott detect it
          sixteen centuries later.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>Eye and hand.</strong> Skips from a word to the same word further on, letters taken for similar
          letters, and small slips that spread through the manuscripts and then the printed editions. These are
          random, local and usually easy to correct once two copies are set side by side.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Expectation.</strong> A reader who trusts the text explains the error or replaces it with something
          more plausible. This kind lasts longest, because the result reads well. The 1590 commentary, the
          manuscript&rsquo;s easier readings and our fluent translation all belong here. A machine trained to produce
          likely text is very good at this kind of error.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The safeguard is the same as it has been since the Renaissance editors: keep the witness in view. Every page
          in Source Library sits beside its scan so that a reader can check the transcription against the leaf, and
          every edition of a work we hold is listed on its book page so that copies can be compared. This note used
          nothing else.
        </p>

        <hr className="my-10 border-stone-200" />

        <p className="text-sm text-muted leading-relaxed mb-4">
          <strong>Our errors in this passage.</strong> In the passage followed here, we checked our transcriptions
          against the scans of five printed editions and one manuscript. Four of the five printed transcriptions misread{' '}
          <em>secunda</em> (printed with a long s) as <em>fecunda</em>, and the 1516 transcription skips two lines. The
          manuscript transcription had at least three readings that are not on the leaf. These are logged with the
          other manuscript and early-print OCR cases on{' '}
          <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4877" className={linkClass}>
            issue #4877
          </a>{' '}
          . The 1516 Aldine has since been re-read with a stronger model, and its text of this passage now matches the page. The other editions and the manuscript had not been corrected when this was published. If you find an error on any page, the feedback button on
          that page reaches us.
        </p>

        <p className="text-sm text-muted leading-relaxed">
          Sources: Walter Scott, <em>Hermetica</em>, vol. 1 (Oxford, 1924), for the Latin text and translation of the{' '}
          <em>Asclepius</em>, and vol. 3 (1926) for his commentary on chapter 32; the Laurenziana manuscript Plut. 89 sup. 71;{' '}
          <em>Iamblichus de mysteriis Aegyptiorum</em> and other works (Venice: Aldus, 1516), and the Lyon edition of the same collection (Jean de
          Tournes, 1549);{' '}
          <em>Pymander, Asclepius, De mysteriis Aegyptiorum</em> (Basel, 1532); Hannibal Rosseli,{' '}
          <em>Asclepius Mercurii Trismegisti cum commento</em> (Kraków, 1590); Francesco Patrizi,{' '}
          <em>Magia philosophica</em> (Hamburg, 1593); Apuleius, <em>Opera</em>, vol. 2 (1778). All are
          linked above and readable in full in the library.
        </p>
      </article>
    </ContentPageLayout>
  );
}
