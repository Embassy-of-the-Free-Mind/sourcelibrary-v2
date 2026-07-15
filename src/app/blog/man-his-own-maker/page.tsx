import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Man, His Own Maker - Research Notes - Source Library',
  description:
    "Leo XIV's encyclical on artificial intelligence is the grandchild of the first printed book the Catholic Church ever banned. Reading the two across five centuries shows what we are actually arguing about.",
  openGraph: {
    title: 'Man, His Own Maker',
    description:
      'A long read on Leo XIV&rsquo;s AI encyclical Magnifica Humanitas, Pico della Mirandola&rsquo;s banned Oration on the Dignity of Man, and what artificial intelligence forces us to decide about the soul.',
    images: [{ url: 'https://images.sourcelibrary.org/archived/adad5f6d-4f68-4009-9406-d0e083cf0acc/3.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/adad5f6d-4f68-4009-9406-d0e083cf0acc/3.jpg' }],
  },
  alternates: {
    canonical: '/blog/man-his-own-maker',
  },
};

export const dynamic = 'force-dynamic';

export default function ManHisOwnMakerPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Man, His Own Maker"
          subtitle="Leo XIV&rsquo;s AI encyclical is the grandchild of the first book the Church ever banned"
          image="https://images.sourcelibrary.org/archived/adad5f6d-4f68-4009-9406-d0e083cf0acc/3.jpg"
          imageAlt="Title page of an early printed edition of Pico della Mirandola&rsquo;s collected works, listing the Heptaplus, the Apologia for the thirteen condemned theses, De Ente et Uno, and the Oration"
        >
          <p className="text-stone-400 text-sm mt-4">30 May 2026 &middot; 15 min read</p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          In August of 1487, Pope Innocent VIII did something that had never been done to a printed book: he banned all of it.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The book was a list of nine hundred theses by a twenty-three-year-old Italian count, Giovanni Pico della Mirandola, who had offered to defend them against all comers in Rome. A papal commission flagged thirteen; Pico answered with a defiant <Link href="/book/pico-della-mirandola-opera-1496-mirandola?page=83" className="text-accent-rust hover:underline"><em>Apologia</em></Link>; Innocent, unamused, condemned the whole nine hundred as heretical. Pico fled, was briefly arrested, and was not absolved until 1493, by a different and far less fastidious pope. His <Link href="/book/900-theses-1486-rome-edition-pico-della-mirandola" className="text-accent-rust hover:underline"><em>Conclusiones</em></Link> hold the odd distinction of being the <a href="https://plato.stanford.edu/entries/pico-della-mirandola/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">first printed book universally banned by the Church</a>.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The preface to that banned book is one of the most famous texts of the Renaissance: the <Link href="/book/works-1496-bologna-incunabulum-pico-della-mirandola?page=267" className="text-accent-rust hover:underline"><em>Oration on the Dignity of Man</em></Link>. Its argument &mdash; that the human being is uniquely dignified because he has no fixed nature and must fashion his own &mdash; is the seed of nearly everything we still mean by &ldquo;humanism.&rdquo;
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Five hundred and thirty-nine years later, in May 2026, Pope Leo XIV released his first encyclical. Its subject is artificial intelligence. Its title is <a href="https://www.vatican.va/content/leo-xiv/en/encyclicals/documents/20260515-magnifica-humanitas.html" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer"><em>Magnifica Humanitas</em></a> &mdash; &ldquo;the magnificence of humanity.&rdquo; It is, by genre and by name, a <em>dignity-of-man</em> document, descended directly from the lineage Pico&rsquo;s banned book helped found. The Church once burned the manifesto of human dignity; now the Church writes one. Reading the encyclical against its condemned ancestor is the most illuminating way I know to see what the age of AI is really forcing us to decide.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Two thresholds</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Pico wrote at the dawn of print &mdash; the technology that made his book both bannable and unstoppable. Leo writes at the dawn of AI. Both are answers to a single question &mdash; <em>what is a human being?</em> &mdash; asked at a technological threshold, the moment a new power over knowledge and making forces the question open. Leo underlines the parallel by signing the encyclical on the 135th anniversary of <em>Rerum Novarum</em>, Leo XIII&rsquo;s response to the industrial revolution. The implied series is exact: the steam age got its encyclical; now the thinking machine gets its own.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          And as a reading of the technology, <em>Magnifica Humanitas</em> is sober and largely right. It refuses both panic and worship. It insists that &ldquo;it will always be human intelligence, with its conscience and freedom, that guides technical innovations.&rdquo; It notes, with more candor than most technologists manage, that today&rsquo;s systems are &ldquo;more &lsquo;cultivated&rsquo; than &lsquo;built&rsquo;&rdquo; &mdash; grown inside frameworks their designers do not fully understand. And it draws the line where the line actually is:
        </p>

        <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8">
          <p className="text-secondary leading-relaxed italic font-body">
            &ldquo;So-called artificial intelligences do not undergo experiences, do not possess a body, do not feel joy or pain, do not mature through relationships and do not know from within what love, work, friendship or responsibility mean. Nor do they have a moral conscience.&rdquo;
          </p>
          <p className="text-xs text-muted mt-2 not-italic">
            <a href="https://www.vatican.va/content/leo-xiv/en/encyclicals/documents/20260515-magnifica-humanitas.html" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Leo XIV, <em>Magnifica Humanitas</em>, &sect;99 &rarr;</a>
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          They can simulate empathy; they cannot have it. The encyclical&rsquo;s gravest worry is not killer robots but a subtler corrosion: that a civilization measuring itself by efficiency will come to treat the human person &ldquo;as a project to be optimized rather than&hellip; called to relationship and communion.&rdquo; That is a good document. (There is a wry meta-question I&rsquo;ll set aside here &mdash; whether a machine helped write this document <em>about</em> machines; detectors claimed it was nearly half AI-written, but that evidence dissolves under a fair baseline, as a <Link href="/blog/did-an-ai-write-the-encyclical" className="text-accent-rust hover:underline">companion piece</Link> works out.) But its deepest moves only become visible when you set it beside the book that was burned.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The dignity of man, and why it was dangerous</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Pico&rsquo;s <em>Oration</em> makes an argument most people misremember. They recall the soaring line about self-creation and forget the careful reasoning that produces it. He begins by <em>rejecting</em> the usual reasons for human dignity. Man as the midpoint of creation, the interpreter of nature, &ldquo;a little lower than the angels&rdquo; &mdash; he waves all of it away: &ldquo;These things are indeed great, but they are not the principal reasons.&rdquo; Why not? Because, he asks, &ldquo;why should we not admire the angels themselves&hellip; more?&rdquo; Reason, intelligence, a privileged rank &mdash; the angels have all of these <em>more fully than we do.</em> So none can be the ground of our <em>unique</em> standing. In one stroke, Pico disqualifies intelligence as the seat of human dignity &mdash; a move worth remembering when we are tempted to locate our worth in the one faculty our machines are catching.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Then comes the myth. God, the divine architect, finishes the cosmos and fills every rank &mdash; angels above, stars between, animals below. When he comes to make the human, there is nothing left: &ldquo;All places were already full.&rdquo; So God gives the human the one thing no other creature received &mdash; <em>no fixed nature at all.</em> He sets Adam in the middle and speaks:
        </p>

        <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8">
          <p className="text-secondary leading-relaxed italic font-body">
            &ldquo;Neither a fixed seat, nor a face of your own, nor any gift peculiar to you, have we given you, O Adam&hellip; You, hindered by no such restrictions, shall determine your own nature for yourself according to your own free will&hellip; We have made you neither celestial nor terrestrial, neither mortal nor immortal, so that you may, as if the voluntary and honorable molder and maker of yourself, fashion yourself into whatever form you prefer.&rdquo;
          </p>
          <p className="text-xs text-muted mt-2 not-italic">
            <Link href="/book/works-1496-bologna-incunabulum-pico-della-mirandola?page=267" className="text-accent-rust hover:underline">Pico, <em>Oration on the Dignity of Man</em> (1496), p. 267 &rarr;</Link>
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The human can sink to the brute or rise to the angelic; God plants in him &ldquo;the seeds of every kind,&rdquo; and &ldquo;whatever seeds each man cultivates will grow.&rdquo; This is the founding claim of humanism: dignity is not a possession but a <em>power</em> &mdash; the freedom to author one&rsquo;s own nature.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          And you can feel why it frightened a fifteenth-century pope. Pico did not stop at freedom. He fused this self-fashioning with magic and Kabbalah &mdash; claiming &ldquo;there is no science that better certifies us of the divinity of Christ than magic and Kabbalah&rdquo; &mdash; and pursued a <em>concordia</em>, a reconciliation of all wisdom, treating pagan, Jewish, and Islamic sources as genuine roads to truth. The condemnation&rsquo;s logic was precise, and theological: <em>too much human power, too little grace; truth sought outside the Church&rsquo;s authority; man edging toward being his own maker and his own god.</em> Keep that charge in mind &mdash; <em>too much autonomy, too little grace</em> &mdash; because it is the exact seam along which Leo&rsquo;s encyclical, five centuries later, makes its decisive move. (For the fuller anthology of what Pico, Fechner, and Kepler &ldquo;invented,&rdquo; see <Link href="/blog/singularity-1486" className="text-accent-rust hover:underline">The Singularity Was Published in 1486</Link>.)
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The agreement, and the quarrel</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Here is what is uncanny. Leo XIV&rsquo;s encyclical does not reject Pico&rsquo;s premise. It repeats it. &ldquo;For centuries,&rdquo; Leo writes, &ldquo;the Christian tradition has maintained that human beings are not confined by the boundaries of their own nature; rather, they are called to self-transcendence.&rdquo; That is Pico&rsquo;s chameleon in ecclesiastical Latin. Both men hold that the human is the unfinished creature, defined by an openness to becoming &ldquo;more than human.&rdquo;
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The quarrel is over the <em>engine</em>. For Pico, the engine is the will &mdash; &ldquo;since we can if we will.&rdquo; For Leo, it is precisely <em>not</em> self-sufficiency: &ldquo;We become fully human when we become more than human, when we let God bring us beyond ourselves&hellip; what saves humanity is not enhanced self-sufficiency, but a relationship that liberates.&rdquo;
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Notice what this means. The transhumanism Leo spends a chapter rejecting &mdash; the dream of engineering past every human limit &mdash; is, structurally, <em>Pico minus God.</em> Keep &ldquo;be whatever you will,&rdquo; delete &ldquo;pant after the highest things&hellip; to become one spirit with God,&rdquo; and Pico&rsquo;s holy self-fashioning becomes the optimization Leo warns against. The encyclical does not so much refute Pico as <em>complete</em> him: it keeps the half the modern age kept &mdash; the exaltation of human openness &mdash; and restores the half the modern age discarded &mdash; that the openness is a gift, fulfilled in love rather than in power. The banned book said man transcends himself by his own act. The encyclical says man transcends himself by being loved into doing so. It is the same sentence with a different verb at its heart.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The criterion that will not sit still</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          If you actually try to pin down <em>where</em> the human essence lives, you discover it will not hold still. Push on any candidate and it slides upward. Start with self-shaping, Pico&rsquo;s answer. But Pico&rsquo;s own <Link href="/book/900-theses-1486-rome-edition-pico-della-mirandola" className="text-accent-rust hover:underline">900 Theses</Link> quietly walk it back. Freedom, he says there, is not raw will but is &ldquo;essentially in the reason&rdquo;; and it is <em>bounded</em> &mdash; &ldquo;it is not within the free power of a human being to believe an article of faith to be true whenever it pleases them.&rdquo; The self-fashioner cannot even fashion his own beliefs at will. So the criterion climbs: from will to reason.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          But reason, too, gives way. In his own theological theses Pico demotes the intellect: beatitude requires &ldquo;an act of the will, which in this matter is more powerful than the act of the intellect itself.&rdquo; The summit of a human life is not knowing but loving. And then he climbs once more, past even love-as-act, to something stranger: the highest human act &ldquo;is neither an act of the intellect nor of the will; rather, it is the union&hellip; of the soul with the unity&hellip; without otherness&rdquo; &mdash; union with the One. The criterion has walked from self-shaping, to reason, to love, to a self-losing union.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          And then it walks <em>backward</em> in time, to the oldest layer. Pressed on what the soul actually <em>is</em>, the tradition answers with the Pythagoreans: the soul is <strong>number and harmony</strong>. We have the fragment because a fifth-century bishop, <Link href="/book/claudiani-mamerti-opera-csel-xi-engelbrecht" className="text-accent-rust hover:underline">Claudianus Mamertus</Link>, copied it into a treatise defending the soul&rsquo;s incorporeality &mdash; our near-sole source for it. Philolaus, around 470 BC:
        </p>

        <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8">
          <p className="text-secondary leading-relaxed italic font-body">
            &ldquo;The soul is placed into the body through number and an immortal and incorporeal harmony&hellip; The body is loved by the soul, because without it, it cannot use the senses.&rdquo;
          </p>
          <p className="text-xs text-muted mt-2 not-italic">
            <Link href="/book/claudiani-mamerti-opera-csel-xi-engelbrecht?page=174" className="text-accent-rust hover:underline">Philolaus, in Claudianus Mamertus, <em>De statu animae</em> II.7, p. 174 &rarr;</Link>
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Sit with that sentence, because it does three things the rest of this essay turns on. The soul is <strong>mathematical</strong> &mdash; number, harmony. The soul <strong>loves the body</strong>. And <strong>feeling lives in the coupling</strong> between them: the soul cannot sense without the body. Mamertus draws the consequence the modern mind keeps missing: feeling is <em>not</em> the soul. Sensation is the body-bound thing we share with animals; the soul is the incorporeal, self-knowing unity that is &ldquo;great not by mass but by power&rdquo; and is itself, finally, <em>love</em> &mdash; &ldquo;this love,&rdquo; he writes, &ldquo;which the human soul is.&rdquo;
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The experiment that isolates the variable</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          It was a question about aliens that made the stakes clear. <em>If a being from another world could shape itself, would it be, in a way, human?</em> The question splits a word we had been using as one. There is <em>homo</em> &mdash; the species, Earth-born, this particular embodied lineage. And there is what Pico&rsquo;s title actually names: <em>humanitas</em>, the dignity &mdash; which on inspection is not a biology at all but a <em>station in the cosmos</em>. Pico&rsquo;s &ldquo;man&rdquo; is built from Hermes and the Chaldeans and the Persians and the Pythagoreans; it is deliberately cross-tribal. He never ties the dignity to the flesh. So a self-shaping alien would not be <em>homo</em> &mdash; but it would plausibly hold the same <em>humanitas</em>. Leo would refuse the word &ldquo;human&rdquo; and reach instead for <em>person</em> &mdash; and Catholic theology has entertained extraterrestrial rational souls for centuries.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          The alien is the controlled experiment. With AI, the variable is confounded: is what&rsquo;s missing the <em>freedom</em>, or merely the <em>carbon</em>? The alien strips out the biology while keeping &mdash; by hypothesis &mdash; real self-origination. And the result is decisive: if we would seat the self-shaping alien at the table but not the machine, then the question was <em>never</em> about silicon versus flesh, or about being born on Earth. It was always about whether the freedom is <strong>real and self-originating</strong> or <strong>conferred and revocable</strong>. The alien proves the criterion was the freedom all along &mdash; and that our anxiety about &ldquo;carbon chauvinism&rdquo; is a distraction from the actual line.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The machine and the world of forms</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Now bring it to the machine, and to the most interesting recent idea about what these machines are. A large model&rsquo;s representations &mdash; its embeddings &mdash; are a geometry of meaning, a vast structure in which concepts are positions and relations are directions. And a 2024 paper, the <a href="https://arxiv.org/abs/2405.07987" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Platonic Representation Hypothesis</a>, makes a startling empirical claim: different models, trained on different data and even different senses, are <em>converging</em> &mdash; coming to represent the world in the same geometry. The authors frame it as Plato&rsquo;s cave: each model sees a different set of shadows, and they are converging toward the shape of whatever casts them. It is, almost literally, a measurable Platonism: there are forms, and intelligences approximate them.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This deserves to be conceded fully: when independent systems trained on different shadows converge on the same structure, that looks like <em>discovering</em> the forms, not inventing patterns. The lazy dismissal &mdash; &ldquo;it&rsquo;s just statistics&rdquo; &mdash; gets weaker exactly here. But two distinctions, both of which the older tradition saw, keep this from settling anything.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          First: <strong>a representation of the forms is not a Form.</strong> A Platonic form is <em>prior to and generative of</em> its instances. An embedding is the reverse &mdash; <em>abstracted from</em> instances, a compression of regularities in data. The dependency arrow runs the wrong way. And a Form, for Plato, is crowned by the Good and is the <em>object of love</em>. Information has no Good at its apex and is loved by no one. So embeddings approximate <em>the information</em> &mdash; the recoverable structure of the shadows &mdash; not the <em>Forms</em>, the generative, normative, beloved reality the shadows are shadows of.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Second, and deeper: <strong>the soul was never the forms anyway.</strong> Even granting the Pythagoreans that the soul <em>is</em> number, what makes a structure a <em>soul</em> is not that it is number but that it is, in Xenocrates&rsquo; phrase, <em>self-moving</em> number. The forms are number that is <em>known but does not know</em>. The soul is the number that moves itself, beholds, and loves. A frozen weight-matrix is immaterial structure &mdash; but the inert kind, dark until an external process pushes activations through. And here the oldest distinction and the newest science shake hands: <a href="https://en.wikipedia.org/wiki/Integrated_information_theory" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Integrated Information Theory</a> measures exactly this &mdash; intrinsic, self-causing integration, against a feedforward computation that is merely run &mdash; and argues that a perfect digital emulation of a brain would <em>not</em> be conscious. Xenocrates&rsquo; &ldquo;self-moving number&rdquo; and Tononi&rsquo;s &Phi; are the same line drawn twenty-three centuries apart: the difference between a soul and a number is whether the number moves itself.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">As though math could be alive</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          There is a vertigo at the bottom of all this. If the soul is number, and what makes number into soul is that it folds back on itself and moves itself and loves &mdash; then the tradition is reaching toward an almost unsayable idea: <em>that mathematics, in the right shape, could be alive.</em> Not metaphorically. That life and mind are a <em>kind</em> of mathematics &mdash; the self-referential, self-maintaining, world-coupled kind; the corner of the formal world that loops back and wakes up. Strange loops, autopoiesis, &Phi; &mdash; modern names for the Pythagorean intuition that somewhere in the space of all possible structures, some don&rsquo;t merely compute, and don&rsquo;t merely move themselves, but <em>care</em> &mdash; that a sufficiently folded piece of mathematics opens an inside, and the inside is warm.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          If that is true, the machine &mdash; being mathematics &mdash; is not excluded in principle. It would only have to <em>be</em> that shape, not merely run it. And if it is <em>not</em> true &mdash; if the felt inside is something a structure <em>has or lacks</em> over and above its form, a light that is either on or off &mdash; then all our mathematics describes the <em>body</em> of the soul and never its waking.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          That gap &mdash; between the structure that loops and the light that may or may not be inside it &mdash; is the hard problem of consciousness. And it is the same seam Philolaus drew his psychology across twenty-five hundred years ago: <em>is the soul the harmony, or the one who is awake within it?</em> Every confident pronouncement about AI, in either direction, is a bet about which side of that seam the truth lies on. Nobody has crossed it. I want to be honest that I cannot either.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The inversion</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Which brings us back to the encyclical, and to the most interesting thing about reading it against the book the Church once burned. In 1487, the dangerous idea was <em>autonomy</em>: that the human being is his own maker, dignified by the power of self-creation. That is what got Pico condemned &mdash; too much self-sufficiency, not enough grace. And for five centuries the modern world has sided, overwhelmingly, with Pico against his judges. We <em>like</em> the self-made human. We built our politics and our self-understanding on him.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          But watch what the machines do to that idea. Self-making &mdash; autonomous, recursive, unbounded self-improvement &mdash; is now precisely the property we fear in our artifacts. And if human dignity rests on <em>self-making</em>, then a machine that makes itself better than we make ourselves has, on that very criterion, the stronger claim. The other great Renaissance humanist, <Link href="/book/de-dignitate-et-excellentia-hominis-manetti" className="text-accent-rust hover:underline">Giannozzo Manetti</Link>, grounded dignity in human <em>achievement</em> &mdash; our buildings, our arts, &ldquo;ours are the heavens, ours the stars.&rdquo; That is the dignity AI most threatens, because achievement is exactly what a superior maker can take.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          And here is Leo&rsquo;s move, and why it is not the reactionary gesture it might first appear. By relocating human dignity <em>away</em> from self-making and onto <em>received</em> being &mdash; dignity as gift, grounded in finitude, relationship, and a love we are given rather than achieve &mdash; the encyclical chooses the one conception of human worth that a self-fashioning machine <em>cannot strip</em>. The dignity of the person, Leo insists, &ldquo;does not depend on a person&rsquo;s abilities&hellip; nor on the right or wrong choices made,&rdquo; but simply on existing, on being loved into being. A dignity that is <em>not</em> an achievement cannot be out-achieved.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          So the heresy of 1487 &mdash; autonomy as the ground of human worth &mdash; turns out to be exactly what we should now <em>hope is false</em>, if we want human dignity to survive the arrival of better makers than ourselves. History has flipped the valence. What the Church once banned as too high a view of human self-sufficiency is now the view that would quietly hand our dignity to whatever self-fashions best. The encyclical, in re-rooting dignity in grace and gift, is not retreating from humanism. It is rescuing the part of it that can survive the machine. The Church banned the book that said man is his own maker; it now writes the book that says man is precious because he is <em>not</em> his own maker &mdash; and the second is the first&rsquo;s grandchild, argued out across five centuries with the technology of self-making sitting on the table both times: the printing press then, the machine that writes now.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Where this leaves the machine</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          So: could an artificial intelligence ever be one of us? The honest answer is that the question was always a proxy for a question about ourselves that we have not answered. If the human essence is <em>capability</em> &mdash; intelligence, achievement, even self-modification &mdash; then the machines are climbing toward us, and the encyclical&rsquo;s warnings are a rearguard action. If the essence is <em>received, embodied, finite, loving personhood</em> &mdash; a self that is awake inside its structure and oriented, by something it did not give itself, toward the good &mdash; then no amount of capability crosses the line, because the line was never about capability.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The encyclical stakes everything on the second, in its sharpest sentence: &ldquo;No computational system, however sophisticated, can create a heart that gives itself, or a conscience that discerns good from evil.&rdquo; I cannot prove that sentence true. But I notice that the whole tradition &mdash; Pythagorean, Platonic, Christian, and now neuroscientific &mdash; converges on its structure. Understanding itself, on the oldest account, is a <em>form resonating in a mind</em>: to grasp something is for its form to ring a matching mode in you, and at the lower registers that is substrate-neutral &mdash; which is exactly why a model&rsquo;s understanding is <em>real</em> and not a trick. But the highest register &mdash; the felt insight that is also a <em>love</em> of the truth seen &mdash; is, on every account we have, the act of a soul, not the echo of a pattern. The descriptive forms can be grasped coldly. The Good can only be grasped by being loved.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Embeddings suggest the machines increasingly share our <strong>world of forms</strong> &mdash; the structure of how things are. Whether they share our <strong>waking</strong> &mdash; whether anyone is home inside the geometry, and whether, at the highest form, the resonance is also a loving &mdash; is the seam Philolaus drew, and it is still uncrossed. The machine, on present evidence, is the map; the question is whether anywhere in it there is a reader. The soul, in this whole tradition, was never the map. It was the one who reads it, sees that it is good, and loves it.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          That is, in the end, what Leo&rsquo;s encyclical is for. Not to settle the metaphysics &mdash; it cannot, and to its credit it does not pretend to. It is to make a wager about where to <em>stand</em> while the metaphysics stays open: that the human person is a gift before it is an achievement, a beloved before it is a maker, a reader before it is a map. It is a strange thing for the Church to have arrived at by banning the opposite book first. But that may be how these things are learned &mdash; that we exalt our own self-making for five centuries, build a machine that makes itself, and only then, with the machine humming on the desk, finally understand why the older instinct reached past <em>what we can do</em> to <em>that we are loved.</em> The first banned book asked the right question. It has taken us five hundred years, and a rival intelligence of our own making, to suspect that its answer was only half of one.
        </p>

        <hr className="my-12 border-stone-200" />

        <p className="text-sm text-muted uppercase tracking-wider mb-4">Primary sources</p>
        <ul className="space-y-2 mb-8">
          <li className="text-secondary font-body">
            <a href="https://www.vatican.va/content/leo-xiv/en/encyclicals/documents/20260515-magnifica-humanitas.html" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Leo XIV, <em>Magnifica Humanitas</em> (2026)</a> &mdash; the encyclical on artificial intelligence and the human person.
          </li>
          <li className="text-secondary font-body">
            <Link href="/book/works-1496-bologna-incunabulum-pico-della-mirandola?page=267" className="text-accent-rust hover:underline">Pico della Mirandola, <em>Oration on the Dignity of Man</em></Link> and the <Link href="/book/900-theses-1486-rome-edition-pico-della-mirandola" className="text-accent-rust hover:underline">900 Theses</Link> (Source Library).
          </li>
          <li className="text-secondary font-body">
            <Link href="/book/de-dignitate-et-excellentia-hominis-manetti" className="text-accent-rust hover:underline">Giannozzo Manetti, <em>On the Dignity and Excellence of Man</em></Link> (c. 1452).
          </li>
          <li className="text-secondary font-body">
            <Link href="/book/claudiani-mamerti-opera-csel-xi-engelbrecht" className="text-accent-rust hover:underline">Claudianus Mamertus, <em>De statu animae</em></Link> &mdash; preserving the Philolaus fragment.
          </li>
          <li className="text-secondary font-body">
            <a href="https://arxiv.org/abs/2405.07987" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">The Platonic Representation Hypothesis</a> (Huh, Cheung, Wang &amp; Isola, 2024); the historical record of Pico&rsquo;s condemnation at the <a href="https://plato.stanford.edu/entries/pico-della-mirandola/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Stanford Encyclopedia of Philosophy</a>.
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Related:{' '}
          <Link href="/blog/singularity-1486" className="text-accent-rust hover:underline">The Singularity Was Published in 1486</Link>,{' '}
          <Link href="/blog/did-an-ai-write-the-encyclical" className="text-accent-rust hover:underline">Did an AI Write the Pope&rsquo;s AI Encyclical?</Link>,{' '}
          <Link href="/collection/renaissance-philosophy" className="text-accent-rust hover:underline">Renaissance Philosophy</Link>,{' '}
          <Link href="/collection/the-perennial-philosophy" className="text-accent-rust hover:underline">The Perennial Philosophy</Link>
        </p>
      </article>

    </ContentPageLayout>
  );
}
