import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Every quotation below is our served English, copied verbatim from the page it links to, and
// every page was opened against its image on 2026-10-07 (#6116). The quality figures come from
// the 14-language reference study (#5695; scripts/eval/experiments/2026-10-04-translation-vs-
// reference-synthesis-5695.md) and the Tengyur random sample (#5829). If a number is not in one
// of those, it does not belong here.

const HERO = 'https://images.sourcelibrary.org/pages/69c87ff96c6f3cc53c858fd5/0066.jpg';
const HERO_ALT =
  'A page of Johann Eck’s 1519 commentary on the Mystical Theology of Dionysius: the Greek and three Latin translations in four columns, with a medieval paraphrase and Eck’s commentary below.';

const TITLE = 'Four Commentaries on Nothing';
const DESCRIPTION =
  'Nāgārjuna with Candrakīrti, a Chan master named Awakened-to-Emptiness, a Latin dictionary of Kabbalah, and Dionysius with Johann Eck: four commentaries that try to stop the reader from turning nothing into a thing. We translated all four by machine. What the drafts get right, where they fail, and what that teaches about translating across traditions.';

export const metadata: Metadata = {
  title: `${TITLE} - Research Notes - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description:
      'Four traditions, four commentaries on what cannot be grasped, and what machine translation does to each of them.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/four-commentaries-on-nothing' },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const A = 'text-accent-rust hover:underline';
const QUOTE = 'border-l-4 border-accent-rust pl-6 my-8 text-secondary font-body leading-relaxed';
const CITE = 'block text-sm text-muted mt-3 not-italic';

const ISSUE = (n: number) => `https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/${n}`;

const PRASANNAPADA = 'https://sourcelibrary.org/book/6a3067d0c4fd77fb5b9f8378?page=515';
const RUYI_51 = 'https://sourcelibrary.org/book/69f1345d365e3fcae574e290?page=51';
const HWAAMSA_40 = 'https://sourcelibrary.org/book/69e014d347b76785d4ec8145?page=40';
const FIVE_LAMPS_152 = 'https://sourcelibrary.org/book/6a3cc1c2ec254ff6cae0ee53?page=152';
const FIVE_LAMPS_153 = 'https://sourcelibrary.org/book/6a3cc1c2ec254ff6cae0ee53?page=153';
const KNORR_164 = 'https://sourcelibrary.org/book/69804b901fb2ba7cf1d43a18?page=164';
const KNORR_165 = 'https://sourcelibrary.org/book/69804b901fb2ba7cf1d43a18?page=165';
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

export default function FourCommentariesOnNothingPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={TITLE}
          subtitle="Four traditions say that the highest thing cannot be grasped, and each then has to stop its readers from grasping the saying. That is what their commentaries are for. We read one page from each, with the English our machine translation made of it."
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
          A teacher who says that the highest thing cannot be grasped has a problem: the student grasps
          the sentence. “Emptiness” becomes a doctrine, “Nothing” becomes a name for God, and the
          negation turns into one more thing to believe. The traditions that say such things are, for
          that reason, traditions of commentary. A root text makes the claim, and a commentator spends
          pages taking it back out of the reader’s hands.
        </p>
        <p className={P}>
          Here are four such commentaries, in Sanskrit, Classical Chinese, Latin on Hebrew, and Latin on
          Greek. Each is a page in this library, and each has an English translation made by machine
          that no specialist has yet checked. For each page I give what it says, what our English does
          with it, and where the English goes wrong. Every quotation is our served English, copied from
          the page it links to, and every page was checked against its image.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>1. Nāgārjuna, and Candrakīrti on the pot</h2>
          <p className={P}>
            Nāgārjuna’s <em>Mūlamadhyamakakārikā</em> (second or third century) is the root text of the
            Madhyamaka, the “middle way” school of Indian Buddhism. In its twenty-fourth chapter an
            opponent objects that if everything is empty, nothing can cause anything, and the Buddha’s
            teaching collapses. Candrakīrti’s commentary, the <em>Prasannapadā</em> (seventh century),
            turns the objection round with a clay pot. If the pot existed by its own nature, it would
            need no clay and no potter:
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
            caption={<>The verse sits between rules; the Tibetan translation is in the footnotes.</>}
            href={PRASANNAPADA}
          />
          <p className={P}>
            So emptiness is not a void. It is the plain fact that the pot comes from clay, a wheel and a
            potter, and has no being apart from them. The second line then takes the same view of the
            word “emptiness”: it too is “a dependent designation”, a word that works only in use. The
            commentary exists to stop the reader treating emptiness as a thing that is there.
          </p>
          <p className={P}>
            <strong>What the English does.</strong> It keeps the Sanskrit terms (<em>śūnyatā</em>,
            <em> svabhāva</em>, <em>pratītyasamutpāda</em>) and glosses them once, instead of folding
            them into English words. Where the 1903 editor added a word in square brackets, the English
            marks it as an insertion rather than passing it off as Candrakīrti’s. That is the right
            habit. The risk in Sanskrit lies elsewhere. Measured against published translations, our
            Sanskrit English leaves something out on 70 percent of pages, mostly by shortening the
            commentary (<Issue n={5695} />). A page like this one, where a verse is quoted and then
            unpacked step by step, is where that happens. Here the steps survived.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>2. The Diamond Sutra, and a Chan master named Awakened-to-Emptiness</h2>
          <p className={P}>
            In the <em>Diamond Sutra</em> the Buddha tells Subhūti that the Tathāgata knows every mind
            of every being, because “all minds are not minds; they are called minds”, and then: “the
            past mind cannot be grasped. The present mind cannot be grasped. The future mind cannot be
            grasped.” A commentary on the sutra printed in 1787 at the Haizhuang monastery in
            Guangzhou (金剛般若波羅蜜經如義) sets its comment above the sutra on every leaf. Above this
            passage it warns the reader:
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
            The last clause is the whole method. The Chinese, 使人扳攬不及, says the peak rises so that
            no one can reach up and take hold of it. The commentator does not explain what the mind is
            instead; he tells the reader to stop looking for a handhold. Our English, “making it
            difficult for people to grasp”, keeps the sense and loses the cliff.
          </p>
          <p className={P}>
            <strong>What the English got wrong, and how we fixed it.</strong> On the same leaf, the
            sutra asks, 如來有佛眼不, “Does the Tathāgata have the Buddha-eye?”, and Subhūti answers
            如是世尊, “So it is, World-Honored One.” The final 不 of the question is a question marker,
            not a “no”. Our first English read it as a refusal: “No, World-Honored One, the Tathagata
            has the Buddha-eye.” It did the same with the sand of the Ganges two lines later, and with
            the flesh-eye and heaven-eye on the facing leaf. The answer was reversed and the sentence
            contradicted itself, and nothing on the page warned the reader. A 1496 Korean woodblock of
            the same sutra, also in this library, got the{' '}
            <a href={HWAAMSA_40} className={A}>same sentence</a> right: “Indeed, World-Honored One, the
            Tathāgata has the Buddha eye.”
          </p>
          <p className={P}>
            So we tested it. We translated the affected pages again, three times each, with the cheaper
            model that had made the error and with the stronger one we have used for Chinese since
            early October. The stronger model answered “Yes” or “It is so” in every run. The cheaper
            one reversed the answer on the same pages every time, and once went further: “No,
            World-Honored One, the Tathagata does not possess the Buddha-eye.” We then searched every
            Chinese, Japanese and Korean book in the library for the same self-contradicting shape and
            found it on three pages, all made by the cheaper model with the same prompt. Those three pages have
            been translated again (<Issue n={6116} />). The page now reads: “It is so, World-Honored
            One. The Tathagata possesses the Buddha-eye.”
          </p>
          <p className={P}>
            Chan carried the same method into conversation. Xiufu Wukong was a tenth-century Chan master at the Qingliang monastery, a temple founded by
            the ruler of the Southern Tang. His name, 悟空 (Wukong), means “awakened to emptiness”. His
            exchanges with monks are preserved in the <em>Compendium of the Five Lamps</em> (五燈會元),
            compiled in 1252; ours is a Qing-dynasty print. A monk asks, “What is the Dao?” He answers
            with the most famous line in Chan, from the verse attributed to Huineng, and then refuses to
            let it settle:
          </p>
          <blockquote className={QUOTE}>
            Originally there is not a single thing; where would there be any dust? A monk bowed. The
            Master said, “Do not misunderstand.” Asked, “What is ‘the one dust enters into correct
            reception’?” The Master said, “Form is precisely emptiness.” Asked, “What is ‘the ten
            thousand dusts arise in samadhi’?” The Master said, “Emptiness is precisely form.” Asked, “I
            will not ask about the others; what is the one phrase about Wukong?” The Master said, “That
            is two phrases.”
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
            The monk bows, as though he has been handed a doctrine. “Do not misunderstand.” Asked for
            the one phrase that sums up awakening to emptiness, Wukong points out that the Heart Sutra
            needs two, “form is emptiness” and “emptiness is form”, and that neither can be dropped. This
            is Candrakīrti’s second line done as a joke. The joke has two layers, because the question
            asks for “the one phrase of Wukong”, the man as well as the idea.
          </p>
          <p className={P}>
            <strong>What the English does right.</strong> It keeps “Wukong” as a name and puts its
            meaning in a note, so both senses stay open. A smoother translation would have chosen
            one.
          </p>
          <p className={P}>
            <strong>What it gets wrong.</strong> A few lines further down the same page is the most
            serious kind of error we find. In the Chinese, the monk asks, “What is the matter of the
            self?” and Wukong answers, “How many places have you asked people?” The monk then asks, “What
            did the ancients attain, that they could stop and rest?” Wukong answers, “What have you
            attained, that you cannot stop and rest?” Our English runs the first answer into the next
            question and gives both to the master:
          </p>
          <blockquote className={QUOTE}>
            The Master said, “How many places have you asked people about what the ancients obtained
            before they stopped and rested?” The Master said, “What have you obtained that makes you
            unable to rest?”
          </blockquote>
          <p className={P}>
            Nearly every word is there; who says them is wrong. In a dialogue that is the meaning. The
            same page also glosses Niutou, the monk Niutou Farong, as “Ox-head mountain”, a person read
            as a place. This is not a quirk of Chinese. In a blind review of 150 random pages of our
            Tibetan Tengyur draft, about one page in four had a reversed statement or a wrong speaker or
            agent, most often in logic and in verse (<Issue n={5829} />). The usual case is an
            opponent’s objection rendered as the author’s own view. Across our measured Chinese pages, 18
            in 100 carry a reversal of some kind (<Issue n={5695} />).
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>3. Ayin: a Latin dictionary of Kabbalah</h2>
          <p className={P}>
            Christian Knorr von Rosenroth’s <em>Kabbala denudata</em> (Sulzbach, 1677) opens with a
            dictionary of kabbalistic terms in Latin, compiled from Moses Cordovero’s <em>Pardes
            Rimmonim</em>, Joseph Gikatilla’s <em>Gates of Light</em> and the Zohar. For a long time
            it was the fullest account of Kabbalah available in Latin. It is a commentary on
            commentaries, and its entry
            for <em>Ayin</em>, “nothing”, begins:
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
            Ayin is not an absence. It is the Crown, Kether, the highest of the ten sefirot, called
            “nothing” because nothing that is understood of it is it. Then the entry turns to the
            letters. On the{' '}
            <a href={KNORR_165} className={A}>next page</a> Knorr draws out that אין, <em>ayin</em>,
            “nothing”, and אני, <em>ani</em>, “I”, are the same three letters, the first sefirah and the
            last: the Crown flows down through the channels to the “I” that receives it. In this
            tradition the commentary does not take the negation back. It shows that the negation and the
            first person are spelled the same way.
          </p>
          <p className={P}>
            <strong>What the English does.</strong> It keeps Ayin, Kether, En-Soph and Malchuth as
            names, notes the Hebrew, and gives Knorr’s Latin <em>Nihil</em> in a note. It also adds a
            guess: “Rabbi Moses” is “likely Moses Cordovero”. That is plausible, since the entry cites
            Cordovero’s <em>Pardes</em> twice, and it is labelled as a note. But it is our guess, not
            Knorr’s. In our reference study, Kabbalah and mysticism were the weakest stratum among the
            Hebrew, Arabic and Persian texts, at 3.04 out of 5 against 4.00 for scripture and law (
            <Issue n={5695} />). Most of that gap came from misread Hebrew type. This page is Latin, and
            reads cleanly.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>4. Dionysius, and a page that compares translations</h2>
          <p className={P}>
            The fifth chapter of the <em>Mystical Theology</em> of Dionysius the Areopagite (about 500)
            is the classic statement of negative theology in Christian Greek: the cause of all is not
            soul, not mind, not number, not one, not goodness, not spirit, “nor darkness, nor light,
            nor error, nor truth”. Johann Eck’s edition of 1519, in the Embassy’s own collection, prints
            the Greek beside three Latin translations of it: Johannes Sarracenus (twelfth century),
            Ambrogio Traversari and Marsilio Ficino (both fifteenth). Below them sits a medieval
            paraphrase by Thomas Gallus, abbot of Vercelli, and then Eck’s commentary. It is a page
            built for comparing translations, five hundred years before we started doing it. Eck sums
            up the chapter:
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
            “Above every assertion and negation”: Dionysius, like Candrakīrti, negates his own
            negations. Eck’s job, like Wukong’s, is to stop the reader from settling on “God is not”
            as the answer.
          </p>
          <p className={P}>
            <strong>What the transcription gets wrong.</strong> The Greek column ends with the phrase
            that the cause is “beyond” something. In the standard text it is ἐπέκεινα τῶν ὅλων, “beyond
            the whole”, and all three Latin versions on this page agree: <em>super tota</em>,{' '}
            <em>totisque superior</em>, <em>ultra omnia</em>. But the Greek printed in this 1519 book
            reads ἐπέκεινα τῶν λόγων, “beyond words”. Our transcription gives τῶν ὅλων. The machine
            wrote the famous reading instead of the one on the page. Whether λόγων is a variant or a
            compositor’s slip, it is what this page says. It is exactly the difference a reader of a
            four-column comparison page is there to see, and it is exactly the kind of difference a
            model that knows the famous text will quietly remove. We have seen the same thing in a
            Vatican Zohar manuscript, where the transcription gave well-known passages that are not on
            the leaf.
          </p>
          <Page
            src={HERO}
            alt="The Greek column of Eck’s 1519 Dionysius, ending with the words τῶν λόγων, beside three Latin columns."
            caption={<>Top left: the Greek ends ἐπέκεινα τῶν λόγων. Eck (1519), Embassy of the Free Mind.</>}
            href={ECK_66}
          />
          <p className={P}>
            The <a href={ECK_65} className={A}>facing page</a>, where the chapter begins, goes wrong
            in a bigger way. On the paper there are four columns: the Greek, then Sarracenus, Ficino
            and Traversari, each with its heading. Our transcription has three. It moved each heading
            one column to the left, so the Greek is labelled “Sarracenus”, and it dropped Ficino’s
            column altogether, so Sarracenus’s Latin appears under Ficino’s name. The English that
            follows is a faithful translation of a page that does not exist. On a page made to compare
            translations, losing one of them is the one error that matters.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What the four have in common, and what they do not</h2>
          <p className={P}>
            They do not mean the same thing. Nāgārjuna’s emptiness is the lack of an own-nature in
            things that arise from conditions, and it has no creator behind it. Ayin is the highest
            aspect of a God who creates. Dionysius’ cause is beyond being and non-being. Wukong will not
            let any of it become a formula. Putting them side by side does not prove a single perennial
            teaching, and a translation that made them sound alike would be wrong.
          </p>
          <p className={P}>
            What they share is a move. Each says the negative and then negates the saying. Candrakīrti
            calls emptiness “a dependent designation”. Wukong says “Do not misunderstand” and “That is
            two phrases”. Knorr says that what is understood of the Crown is Nothing. Eck says that God
            is above negation as well as assertion. Each needs a commentary because each is correcting
            its reader.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What translating them taught us</h2>
          <p className={P}>
            <strong>Keep the terms.</strong> If <em>śūnyatā</em>, <em>ayin</em>, 悟空 and Dionysius’
            “beyond” all become “nothingness” in English, any likeness a reader then sees is the
            translator’s doing, not the authors’. Our drafts keep the terms and gloss them once. In our
            study against published translations in fourteen languages, our English came out ahead on
            keeping terms and on showing its work, and behind on readability and voice (
            <Issue n={5695} />). For texts like these, that is the right trade.
          </p>
          <p className={P}>
            <strong>The page first.</strong> A transcription or translation that knows the famous text
            will drift toward it. τῶν λόγων is on the page; τῶν ὅλων is in the reference books. A
            page laid out to compare four translations can come back with three. The page has to be
            checked against its image before anyone trusts what was made from it.
          </p>
          <p className={P}>
            <strong>Who is speaking, and whether they said yes.</strong> These texts argue in
            dialogue: opponent and reply, monk and master, question and answer. A machine is now good
            at the words. Its worst errors are about whose words they are, and about one small word,
            a “not” that was a question mark. In a dialectical text that is where the meaning is.
          </p>
          <p className={P}>
            <strong>The commentary is part of the text.</strong> It is the part a machine is most
            tempted to shorten, and the part these traditions most need.
          </p>
          <p className={P}>
            All four translations are unreviewed drafts, and they say so on the page. If you read
            Sanskrit, Classical Chinese, Hebrew, Greek or Latin, the pages are open. A correction from
            someone who knows the language is worth more to us than another model, and the feedback link
            on every page reaches us.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
