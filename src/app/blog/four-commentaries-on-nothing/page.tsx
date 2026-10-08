import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Every quotation below is our served English, copied verbatim from the page it links to, and
// every quoted page was read against its image on 2026-10-07 (#6116). Six pages were
// re-translated on Flash that day after those checks; the quotes are the new text.
// The quality figures come from the 14-language reference study (#5695; scripts/eval/experiments/2026-10-04-translation-vs-
// reference-synthesis-5695.md) and the Tengyur random sample (#5829). If a number is not in one
// of those, it does not belong here.

const HERO = 'https://images.sourcelibrary.org/pages/69c87ff96c6f3cc53c858fd5/0066.jpg';
const HERO_ALT =
  'A page of Johann Eck’s 1519 commentary on the Mystical Theology of Dionysius: the Greek and three Latin translations in four columns, with a medieval paraphrase and Eck’s commentary below.';

const TITLE = 'Four Commentaries on Nothing';
const DESCRIPTION =
  'Nāgārjuna with Candrakīrti, the Diamond Sutra and the Chan master Wukong, a Latin dictionary of Kabbalah, and Dionysius with Johann Eck: four commentaries that warn readers not to turn “nothing” into a doctrine. What our machine translations of them got right and wrong, and what we fixed.';

export const metadata: Metadata = {
  title: `${TITLE} - Research Notes - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description:
      'Four commentaries on what cannot be put into words, read against their scans, with the translation errors we found and fixed.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/four-commentaries-on-nothing' },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const A = 'text-accent-rust hover:underline';
const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';
const QUOTE = 'border-l-4 border-accent-rust pl-6 my-8 text-secondary font-body leading-relaxed';
const CITE = 'block text-sm text-muted mt-3 not-italic';

const ISSUE = (n: number) => `https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/${n}`;

const PRASANNAPADA = 'https://sourcelibrary.org/book/6a3067d0c4fd77fb5b9f8378?page=515';
const PRASANNAPADA_514 = 'https://sourcelibrary.org/book/6a3067d0c4fd77fb5b9f8378?page=514';
const RUYI_51 = 'https://sourcelibrary.org/book/69f1345d365e3fcae574e290?page=51';
const HWAAMSA_40 = 'https://sourcelibrary.org/book/69e014d347b76785d4ec8145?page=40';
const FIVE_LAMPS_152 = 'https://sourcelibrary.org/book/6a3cc1c2ec254ff6cae0ee53?page=152';
const FIVE_LAMPS_153 = 'https://sourcelibrary.org/book/6a3cc1c2ec254ff6cae0ee53?page=153';
const KNORR_164 = 'https://sourcelibrary.org/book/69804b901fb2ba7cf1d43a18?page=164';
const KNORR_163 = 'https://sourcelibrary.org/book/69804b901fb2ba7cf1d43a18?page=163';
const ECK_65 = 'https://sourcelibrary.org/book/69c87ff96c6f3cc53c858fd5?page=65';
const ECK_66 = 'https://sourcelibrary.org/book/69c87ff96c6f3cc53c858fd5?page=66';

function Issue({ n }: { n: number }) {
  return (
    <a href={ISSUE(n)} className={A}>
      #{n}
    </a>
  );
}

function Page({ src, alt, caption, href }: { src: string; alt: string; caption: React.ReactNode; href: string }) {
  return (
    <figure className="my-8">
      <a href={href}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className="w-full max-w-md mx-auto rounded-lg shadow-md" />
      </a>
      <figcaption className="text-center text-sm text-muted mt-3 italic">{caption}</figcaption>
    </figure>
  );
}

// אין (ayin, "nothing") and אני (ani, "I"): the same three letters, as Knorr notes on p. 80.
// Hebrew reads right to left, so the letters are placed right to left.
function AyinAniDiagram() {
  const row1 = [{ ch: 'א', x: 300 }, { ch: 'י', x: 240 }, { ch: 'ן', x: 180 }];
  const row2 = [{ ch: 'א', x: 300 }, { ch: 'נ', x: 240 }, { ch: 'י', x: 180 }];
  const links: [number, number][] = [[300, 300], [240, 180], [180, 240]];
  return (
    <figure className="my-8">
      <svg viewBox="0 0 400 190" className="w-full max-w-md mx-auto text-primary" role="img"
        aria-label="The Hebrew words ayin (aleph, yod, final nun) and ani (aleph, nun, yod) drawn one above the other, with lines joining each letter to the same letter in the other word.">
        {links.map(([a, b], i) => (
          <line key={i} x1={a} y1={62} x2={b} y2={128} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} />
        ))}
        {row1.map((l) => (
          <text key={`a${l.x}`} x={l.x} y={50} textAnchor="middle" fontSize={40} fill="currentColor">{l.ch}</text>
        ))}
        {row2.map((l) => (
          <text key={`b${l.x}`} x={l.x} y={170} textAnchor="middle" fontSize={40} fill="currentColor">{l.ch}</text>
        ))}
        <text x={20} y={34} fontSize={14} fill="currentColor">ayin, “nothing”</text>
        <text x={20} y={52} fontSize={12} fill="currentColor" fillOpacity={0.7}>Kether, the first sefirah</text>
        <text x={20} y={154} fontSize={14} fill="currentColor">ani, “I”</text>
        <text x={20} y={172} fontSize={12} fill="currentColor" fillOpacity={0.7}>Malchuth, the last</text>
      </svg>
      <figcaption className="text-center text-sm text-muted mt-3 italic">
        The same three letters, aleph, yod and nun, in a different order.
      </figcaption>
    </figure>
  );
}

// Eck 1519, scan 65: four columns on the paper, three in our transcription.
function EckColumnsDiagram() {
  const box = 'rounded border px-2 py-2 text-xs leading-snug';
  const ok = `${box} border-border-light text-secondary`;
  const bad = `${box} border-accent-rust text-secondary`;
  return (
    <figure className="my-8">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 items-stretch text-sm font-body">
        <div className="text-muted self-center">Printed</div>
        <div className="grid grid-cols-4 gap-2">
          <div className={ok}><strong>(no heading)</strong><br />Greek</div>
          <div className={ok}><strong>Sarracenus</strong><br />his Latin</div>
          <div className={ok}><strong>Ficinus</strong><br />Ficino’s Latin</div>
          <div className={ok}><strong>Camaldulen.</strong><br />Traversari’s Latin</div>
        </div>
        <div className="text-muted self-center">Transcribed</div>
        <div className="grid grid-cols-4 gap-2">
          <div className={bad}><strong>Sarracenus</strong><br />Greek</div>
          <div className={bad}><strong>Ficinus</strong><br />Sarracenus’s Latin</div>
          <div className={`${box} border-dashed border-accent-rust text-muted`}>Ficino’s Latin: missing</div>
          <div className={ok}><strong>Camaldulen.</strong><br />Traversari’s Latin</div>
        </div>
      </div>
      <figcaption className="text-center text-sm text-muted mt-3 italic">
        Scan 65 of Eck’s 1519 edition, as printed and as transcribed. Boxes outlined in red are wrong.
      </figcaption>
    </figure>
  );
}

export default function FourCommentariesOnNothingPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={TITLE}
          subtitle="Four traditions teach that the highest thing cannot be put into words, and each wrote commentaries to keep readers from turning that teaching into a doctrine. One page from each, with our machine translation, and the errors we found and fixed along the way."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">7 October 2026 &middot; 12 min read</p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Several traditions teach that the highest thing cannot be grasped in words. Their students
          then hold on to the words. Emptiness becomes a doctrine, and Nothing becomes a name for God.
          So these traditions write commentaries: a root text makes the claim, and the commentator
          warns the reader not to take it as one more thing to believe.
        </p>
        <p className={P}>
          Below are four such commentaries: in Sanskrit, Classical Chinese, Latin on Hebrew, and Latin
          on Greek. Each is a book in this library with an English translation made by machine and not
          yet checked by a specialist. For each I give what the page says, what our English does with
          it, and where it went wrong. Quotations are our English, copied from the page they link to,
          and I read every quoted page against its scan. Several errors turned up while I wrote this;
          the ones we could fix are fixed, and the list is at the end.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>1. Nāgārjuna, and Candrakīrti on the pot</h2>
          <p className={P}>
            Nāgārjuna’s <em>Mūlamadhyamakakārikā</em> (second or third century) is the founding text of
            the Madhyamaka, the “middle way” school of Indian Buddhism. In chapter 24 an opponent
            objects that if everything is empty, nothing can cause anything, and the Buddha’s teaching
            falls apart. Candrakīrti’s commentary, the <em>Prasannapadā</em> (seventh century), answers
            with a clay pot. If the pot existed by its own nature, it would need no clay and no potter:
          </p>
          <blockquote className={QUOTE}>
            Therefore, by accepting intrinsic nature, you contradict all of these things starting with
            the effect. In this way, if you accept intrinsic nature, nothing at all is logical. However,
            for us who maintain the shunyata (emptiness) of the intrinsic nature of things, all of this
            is possible. For what reason? Because we say:
            <br />
            <br />
            That which is dependent origination, we call that emptiness.
            <br />
            That is a dependent designation; it alone is the middle way.
            <cite className={CITE}>
              Candrakīrti, <em>Prasannapadā</em>, ed. La Vallée Poussin (1903), p. 503, quoting
              Nāgārjuna 24.18. <a href={PRASANNAPADA} className={A}>Read the page</a>
            </cite>
          </blockquote>
          <Page
            src="https://images.sourcelibrary.org/pages/6a3067d0c4fd77fb5b9f8378/0515.jpg"
            alt="Page 503 of La Vallée Poussin’s 1903 edition of the Prasannapadā: Sanskrit in Devanagari with verse 24.18 set off between rules, and Tibetan in the footnotes."
            caption={<>Verse 24.18 between rules; the Tibetan version in the footnotes.</>}
            href={PRASANNAPADA}
          />
          <p className={P}>
            For Candrakīrti, things are empty because they arise from conditions: the pot depends on
            clay, a wheel and a potter. The verse’s second line applies the same point to the word
            “emptiness”, which is also “a dependent designation”. The reader is not meant to treat
            emptiness as a thing that exists.
          </p>
          <p className={P}>
            <strong>The English.</strong> It keeps the Sanskrit terms (<em>śūnyatā</em>,{' '}
            <em>svabhāva</em>, <em>pratītyasamutpāda</em>) and glosses each once. Where the 1903 editor
            added a word in square brackets, the English marks it as an insertion. Our Sanskrit
            translations do worst on commentary: measured against published translations, they leave
            something out on 70 percent of pages, mostly by shortening the commentary (
            <Issue n={5695} />). On this page the commentary is complete. On the{' '}
            <a href={PRASANNAPADA_514} className={A}>page before</a> it was not: the English stopped
            after verse 15 and left the rest of the page untranslated. That page has now been
            translated again.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>2. The Diamond Sutra, and a Chan master named Wukong</h2>
          <p className={P}>
            In the <em>Diamond Sutra</em> the Buddha tells Subhūti that he knows the minds of all
            beings, because “all minds are not minds; they are called minds”. Then: “the past mind
            cannot be grasped. The present mind cannot be grasped. The future mind cannot be grasped.”
            A commentary printed in 1787 at the Haizhuang monastery in Guangzhou (金剛般若波羅蜜經如義)
            puts its notes above the sutra on every leaf. Above this passage it says:
          </p>
          <blockquote className={QUOTE}>
            Previously, all external appearances were emptied; here, the mind itself is emptied. As the
            saying goes, “If the skin no longer exists, where can the hair attach itself?” The writing in
            this chapter is ingenious and the meaning is profound, like a range of peaks where a single
            mountain top suddenly rises ten thousand feet high, making it difficult for people to grasp.
            <cite className={CITE}>
              <em>Jingang bore boluomi jing ruyi</em> (Guangzhou, 1787).{' '}
              <a href={RUYI_51} className={A}>Read the page</a>
            </cite>
          </blockquote>
          <Page
            src="https://images.sourcelibrary.org/pages/69f1345d365e3fcae574e290/0051.jpg"
            alt="A leaf of the 1787 Guangzhou Diamond Sutra commentary: the commentary in small characters in the upper register, the sutra in large characters below."
            caption={<>Commentary above, sutra below. Bavarian State Library copy.</>}
            href={RUYI_51}
          />
          <p className={P}>
            The last clause in Chinese is 使人扳攬不及: the peak is too high for anyone to reach up and
            take hold of it. That is the commentator’s point. He does not offer a better account of the
            mind; he tells the reader there is nothing here to hold. “Difficult for people to grasp” is
            accurate but weaker than the Chinese.
          </p>
          <p className={P}>
            <strong>The English, before and after.</strong> On the same leaf the sutra asks 如來有佛眼不,
            “Does the Tathāgata have the Buddha-eye?”, and Subhūti answers 如是世尊, “So it is,
            World-Honored One.” The 不 at the end of the question marks it as a question; it does not
            mean “no”. Our first English read it as “no”: “No, World-Honored One, the Tathagata has the
            Buddha-eye.” It did the same with the sand of the Ganges two lines later, and with the
            flesh-eye and the heavenly eye on the facing leaf. A 1496 Korean woodblock of the same
            sutra, also in this library, has the{' '}
            <a href={HWAAMSA_40} className={A}>same sentence</a> right: “Indeed, World-Honored One, the
            Tathāgata has the Buddha eye.”
          </p>
          <p className={P}>
            We tested the two models we use. We translated the affected pages again, three times each,
            with the cheaper model that made the error and with the stronger one we have used for
            Chinese since early October. The stronger model answered “Yes” or “It is so” in every run.
            The cheaper one reversed the answer on the same pages every time, and in one run wrote that
            the Tathāgata “does not possess the Buddha-eye”. A search of every Chinese, Japanese and
            Korean book in the library found the same contradiction on three pages, all from the
            cheaper model. They have been translated again with the stronger one (<Issue n={6116} />),
            and the page now reads: “It is so, World-Honored One. The Tathagata possesses the
            Buddha-eye.”
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr><th className={TH}>Page</th><th className={TH}>First English</th><th className={TH}>Stronger model, 3 runs</th><th className={TH}>Cheaper model, 3 runs</th></tr>
              </thead>
              <tbody>
                <tr><td className={TD}>1787 commentary, Buddha-eye</td><td className={TD}>“No”</td><td className={TD}>“Yes” 3 of 3</td><td className={TD}>“Yes” 3 of 3</td></tr>
                <tr><td className={TD}>1787 commentary, flesh-eye and others</td><td className={TD}>“It is not so”</td><td className={TD}>“Yes” 3 of 3</td><td className={TD}>reversed 3 of 3</td></tr>
                <tr><td className={TD}>Huineng’s commentary, Dharma-eye and Buddha-eye</td><td className={TD}>“It is not so”</td><td className={TD}>“Yes” 3 of 3</td><td className={TD}>reversed 3 of 3</td></tr>
                <tr><td className={TD}>Huineng’s commentary, the sand</td><td className={TD}>“Yes”</td><td className={TD}>“So it is” 3 of 3</td><td className={TD}>“Yes” 3 of 3</td></tr>
                <tr><td className={TD}>1496 Korean woodblock, Buddha-eye and sand</td><td className={TD}>“Indeed”</td><td className={TD}>“Yes” 3 of 3</td><td className={TD}>Buddha-eye answer lost its “yes”, 3 of 3</td></tr>
              </tbody>
            </table>
          </div>
          <Page
            src="https://images.sourcelibrary.org/archived/6992cd7543713c66ea63699e/74.jpg"
            alt="Woodcut of the Chan master Huineng seated on a mat beside a rock and a vase of flowers, labelled 慧能大師."
            caption={<>“Great Master Huineng” (慧能大師), the Sixth Patriarch, to whom the line “Originally there is not a single thing” is attributed. <em>Sancai tuhui</em> (1609), vol. 29.</>}
            href="https://sourcelibrary.org/book/6992cd7543713c66ea63699e?page=74"
          />
          <p className={P}>
            Chan turned the same teaching into dialogue. Xiufu Wukong was a tenth-century master at
            the Qingliang monastery, which the ruler of the Southern Tang built and invited him to lead. His name, 悟空,
            means “awakened to emptiness”. His exchanges with monks are recorded in the{' '}
            <em>Compendium of the Five Lamps</em> (五燈會元), compiled in 1252; ours is a Qing-dynasty
            print. A monk asks, “What is the Way?” He answers with the best-known line in Chan, from the
            verse attributed to Huineng:
          </p>
          <blockquote className={QUOTE}>
            Originally there is not a single thing; where could dust collect? The monk bowed. The Master
            said: Do not misunderstand. A monk asked: What is meant by “one speck of dust entering into
            right concentration”? The Master said: Form is emptiness. The monk asked: What is meant by
            “arising from the samadhi of all dust particles”? The Master said: Emptiness is form. The
            monk asked: I will not ask about other matters, but what is the single phrase for realizing
            emptiness? The Master said: It is two phrases.
            <cite className={CITE}>
              <em>Compendium of the Five Lamps</em>, vol. 8, scans{' '}
              <a href={FIVE_LAMPS_152} className={A}>152</a>–153.{' '}
              <a href={FIVE_LAMPS_153} className={A}>Read the page</a>
            </cite>
          </blockquote>
          <Page
            src="https://images.sourcelibrary.org/pages/6a3cc1c2ec254ff6cae0ee53/0153.jpg"
            alt="A page of a Qing-dynasty print of the Compendium of the Five Lamps: eight columns of Chinese characters read top to bottom, right to left."
            caption={<>The page opens with Huineng’s line, 本來無一物何處有塵埃.</>}
            href={FIVE_LAMPS_153}
          />
          <p className={P}>
            The monk bows as if he has been given a doctrine, and Wukong tells him not to misunderstand.
            Asked for the single phrase for realizing emptiness, he answers that it is two: the Heart
            Sutra’s “form is emptiness” and “emptiness is form”, and neither can be dropped. The
            question also contains his own name, 悟空, so the monk is asking for “Wukong’s one phrase”
            as well.
          </p>
          <p className={P}>
            <strong>The English, before and after.</strong> Our first English kept the name and put its
            meaning in a note, so a reader could see both senses. The new English gives only “realizing
            emptiness”, and the name is lost. It was translated again because the first version had a
            worse error a few lines further down. The monk asks, “What is my own fundamental affair?”
            and Wukong answers, “How many places have you gone to ask people this?” The monk then asks
            what the ancients attained that let them rest, and Wukong turns the question back on him.
            The first English ran the answer into the next question and gave both to the master:
          </p>
          <blockquote className={QUOTE}>
            The Master said, “How many places have you asked people about what the ancients obtained
            before they stopped and rested?” The Master said, “What have you obtained that makes you
            unable to rest?”
          </blockquote>
          <p className={P}>
            It also glossed Niutou, the monk Niutou Farong, as “Ox-head mountain”. The new English has
            the right speakers and the right Niutou. Wrong speakers are a common error in our
            translations of argument and dialogue. In a blind review of 150 random pages of our
            Tibetan Tengyur translation, about one page in four had a reversed statement or the wrong
            speaker or agent, most often in logic and in verse (<Issue n={5829} />). Across our
            measured Chinese pages, 18 in 100 had a reversal of some kind (<Issue n={5695} />).
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>3. Ayin: a Latin dictionary of Kabbalah</h2>
          <p className={P}>
            Christian Knorr von Rosenroth’s <em>Kabbala denudata</em> (Sulzbach, 1677) opens with a
            dictionary of kabbalistic terms in Latin, drawn from Moses Cordovero’s{' '}
            <em>Pardes Rimmonim</em>, Joseph Gikatilla’s <em>Gates of Light</em> and the Zohar. For a
            long time it was the fullest account of Kabbalah in Latin. Its entry for <em>Ayin</em>,
            “nothing”, includes:
          </p>
          <blockquote className={QUOTE}>
            All agree that Ayin is a title of the Crown; and this is because no one can grasp it; but if
            a question is raised concerning it, the answer must be: that which is perceived or understood
            of it is Ayin. Rabbi Moses, however, provides another reason: namely, that a “Principle” is
            usually called “Non-being”; and this is the Principle of all Principles.
            <cite className={CITE}>
              Knorr von Rosenroth, <em>Kabbala denudata</em> (1677), p. 81.{' '}
              <a href={KNORR_164} className={A}>Read the page</a>
            </cite>
          </blockquote>
          <Page
            src="https://images.sourcelibrary.org/cropped/69804b901fb2ba7cf1d43a18/6980bf6ac0fed4b65dfe5999.jpg"
            alt="Page 81 of Knorr von Rosenroth’s Kabbala denudata, 1677: Latin text with Hebrew words, the entry on Ayin and the start of the entry on En Sof."
            caption={<>The Bibliotheca Philosophica Hermetica copy, Amsterdam.</>}
            href={KNORR_164}
          />
          <p className={P}>
            Here Ayin is the name of the Crown, Kether, the highest of the ten sefirot. It is called
            “nothing” because whatever is understood of it is not it. On the{' '}
            <a href={KNORR_163} className={A}>page before</a>, Knorr notes that אין, <em>ayin</em>,
            “nothing”, and אני, <em>ani</em>, “I”, are written with the same three letters. Ayin stands
            for the first sefirah and Ani for the last, and blessing flows down through the channels from
            the one to the other.
          </p>
          <AyinAniDiagram />
          <Page
            src="https://images.sourcelibrary.org/cropped/69804b901fb2ba7cf1d43a18/6982913e7a27b2f1693ad779.jpg"
            alt="An engraved diagram of the ten sefirot as linked circles on a central trunk, set inside concentric rings, with a paper flap folded over the lower part of the plate."
            caption={<>One of the sefirot diagrams among the plates of the <em>Kabbala denudata</em>, with its paper flap still in place.</>}
            href="https://sourcelibrary.org/book/69804b901fb2ba7cf1d43a18?page=1690"
          />
          <p className={P}>
            <strong>The English.</strong> It keeps Ayin, Kether, En-Soph and Malchuth as names, gives
            the Hebrew, and puts Knorr’s Latin <em>Nihil</em> in a note. It also adds a guess in a
            note: that “Rabbi Moses” is “likely Moses Cordovero”. The guess is reasonable, since the
            entry cites Cordovero’s <em>Pardes</em> twice, but it is ours and not Knorr’s. In our
            reference study, Kabbalah and mysticism scored lowest among the Hebrew, Arabic and Persian
            texts, 3.04 out of 5 against 4.00 for scripture and law (<Issue n={5695} />), mostly
            because of misread Hebrew type. This page is in Latin and reads cleanly. The scans of this
            book have a different problem: printed pages 80 and 81 were photographed twice, so a reader
            turning the pages sees them in the order 80, 81, 80, 81.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>4. Dionysius, on a page that compares translations</h2>
          <p className={P}>
            The fifth chapter of the <em>Mystical Theology</em> of Dionysius the Areopagite (about 500)
            is the standard statement of negative theology in Greek Christianity. The cause of all
            things is not soul, mind, number, unity, goodness or spirit, “nor darkness, nor light, nor
            error, nor truth”. Johann Eck’s edition of 1519, a copy of which belongs to the Embassy of
            the Free Mind, prints the Greek beside three Latin translations: by Johannes Sarracenus
            (twelfth century), Ambrogio Traversari and Marsilio Ficino (both fifteenth). Below them are
            a paraphrase by Thomas Gallus, abbot of Vercelli, and Eck’s own commentary. Eck sums up the
            chapter:
          </p>
          <blockquote className={QUOTE}>
            Finally, he takes away all beings and non-beings in general. He adds that He is not
            understood by anyone, nor does He understand anything. Finally, he concludes that there is
            no speech or knowledge of God, because He is above every assertion and negation, and simply
            absolute from all, and more eminent than all.
            <cite className={CITE}>
              Johann Eck, commentary on Dionysius, <em>De mystica theologia</em> (1519).{' '}
              <a href={ECK_66} className={A}>Read the page</a>
            </cite>
          </blockquote>
          <p className={P}>
            God is above negation as well as assertion, so “God is not” is no more an answer than “God
            is”. Like Candrakīrti, Dionysius applies his denial to the denial itself.
          </p>
          <p className={P}>
            <strong>The transcription.</strong> The Greek column ends by saying the cause is “beyond”
            something. In the standard text it is ἐπέκεινα τῶν ὅλων, “beyond the whole”, and all three
            Latin versions on the page agree: <em>super tota</em>, <em>totisque superior</em>,{' '}
            <em>ultra omnia</em>. The Greek printed in this book reads ἐπέκεινα τῶν λόγων, “beyond
            words”. Our transcription gives τῶν ὅλων, the standard reading, not the one on the page.
            Whether λόγων is a variant or a printer’s error, a reader comparing the four columns should
            be able to see it. We have found the same tendency before: a transcription of a Vatican
            Zohar manuscript contained well-known passages that are not on the leaf.
          </p>
          <Page
            src={HERO}
            alt="The Greek column of Eck’s 1519 Dionysius, ending with the words τῶν λόγων, beside three Latin columns."
            caption={<>Top left: the Greek ends ἐπέκεινα τῶν λόγων. Eck (1519), Embassy of the Free Mind.</>}
            href={ECK_66}
          />
          <p className={P}>
            The <a href={ECK_65} className={A}>facing page</a>, where the chapter begins, has a larger
            error. The printed page has four columns, each with a heading: the Greek, then Sarracenus,
            Ficino and Traversari. Our transcription has three. It moved each heading one column to the
            left, so the Greek is labelled “Sarracenus”, and it left out Ficino’s column, so
            Sarracenus’s Latin appears under Ficino’s name. The English translates this rearranged text
            accurately, so nothing in it warns the reader.
          </p>
          <EckColumnsDiagram />
        </section>

        <section className="mb-16">
          <h2 className={H2}>What the four share</h2>
          <p className={P}>
            The four do not teach the same thing. Nāgārjuna’s emptiness means that things which arise
            from conditions have no nature of their own, and there is no creator behind them. Ayin is
            the highest aspect of a creating God. Dionysius’ cause is beyond being and non-being. Wukong
            refuses to let any of it become a formula. Reading them together does not show a single
            teaching under different names, and an English that made them sound alike would be wrong.
          </p>
          <p className={P}>
            They do share a method. Each states a negation and then qualifies the statement.
            Candrakīrti calls emptiness “a dependent designation”. Wukong says “Do not misunderstand”
            and “It is two phrases”. Knorr says that what is understood of the Crown is Nothing. Eck
            says that God is above negation as well as assertion. In each case the commentary is there to
            correct the reader.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What this means for translation</h2>
          <p className={P}>
            <strong>Keep the terms.</strong> If <em>śūnyatā</em>, <em>ayin</em> and Dionysius’ “beyond”
            all become “nothingness” in English, any resemblance a reader sees comes from the
            translator. Our translations keep the terms and gloss them once. In our comparison with
            published translations in fourteen languages, our English scored higher on keeping terms
            and showing its sources, and lower on readability and voice (<Issue n={5695} />). The loss
            of “Wukong” in the new translation of the Five Lamps page shows that this can still slip.
          </p>
          <p className={P}>
            <strong>Translate the page in front of you.</strong> A transcription can drift toward the
            text it already knows, as with τῶν ὅλων for τῶν λόγων, or lose one of four columns. Any
            translation made from it inherits the error, so the transcription has to be checked against
            the scan.
          </p>
          <p className={P}>
            <strong>Check who is speaking, and whether the answer was yes.</strong> These texts argue
            in dialogue: objection and reply, monk and master, question and answer. The worst errors
            we found were not wrong words. They were a sentence given to the wrong speaker and a
            question marker read as “no”.
          </p>
          <p className={P}>
            <strong>Translate the commentary in full.</strong> It is the part our translations most
            often shorten, and in these traditions it carries the teaching.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Fixed while writing this, and still open</h2>
          <p className={P}>
            Fixed: the reversed answers on three Diamond Sutra pages, the wrong speakers and the
            “Ox-head mountain” on the Five Lamps page, and the untranslated half of a Prasannapadā page,
            all translated again. Still open: the standard Greek reading and the missing Ficino column
            in Eck’s edition, a line the transcription skipped on the facing leaf of the 1787
            commentary, and the doubled pages in Knorr. These need new transcriptions or new scans,
            and are tracked in <Issue n={6116} />.
          </p>
          <p className={P}>
            All of these translations are unreviewed drafts, and each page says so. If you read
            Sanskrit, Classical Chinese, Hebrew, Greek or Latin and find an error, the feedback link on
            every page reaches us.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
