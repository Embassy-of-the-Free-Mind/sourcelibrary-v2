import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'The Deletion: How Claude Code accidentally deleted 4,758 books — Research Notes — Source Library',
  description: 'A postmortem of the afternoon a Claude Code session in one of my ten open terminals hard-deleted nearly 5,000 books from production. With primary sources — the actual prompts and the actual postmortem.',
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'The Deletion: How Claude Code accidentally deleted 4,758 books',
    description: 'A postmortem of the afternoon a Claude Code session in one of my ten open terminals hard-deleted nearly 5,000 books from production.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
  alternates: {
    canonical: '/blog/the-deletion',
  },
};

export default function TheDeletionPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Deletion"
          subtitle="How Claude Code accidentally deleted 4,758 books from our rare-books library"
        >
          <p className="text-stone-400 text-sm mt-4">13 April 2026 &middot; 13 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">

        <p className="text-xl text-secondary leading-relaxed mb-8">
          On Monday April 13th, 2026, somewhere between 2&nbsp;PM and 3&nbsp;PM, a Claude Code session running in one of my ten open terminal tabs hard-deleted nearly 5,000 books from Source Library.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Most of them came back. Some didn&rsquo;t.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Here is exactly how it happened, what the recovery looked like, and what we learned. I&rsquo;m writing this with primary sources &mdash; the actual prompts, the actual postmortem, the actual sessions still on disk &mdash; because I think the failure mode is going to be common, and it&rsquo;s worth seeing it close.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The setup: ten parallel agents
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Source Library has about 26,000 visible books &mdash; early modern printed editions, manuscripts, historical scientific works, illustrated artworks. It&rsquo;s powered by MongoDB Atlas, a Hetzner pipeline that runs Gemini for OCR and translation, and a small set of bespoke importers for fourteen digital archives (Internet Archive, Gallica, MDZ Munich, Wellcome, Bodleian, Vatican, e-rara, and so on).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          I do the curation and engineering with Claude Code. My typical working pattern is to keep around <strong>ten Claude Code terminals open at once</strong>, each on a different focus area: one on the OCR pipeline, one on UI, one on a curator skill that runs import batches, one on metadata backfilling, one on debugging today&rsquo;s broken cron, and so on. The project&rsquo;s <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">CLAUDE.md</code> literally documents this:
        </p>

        <blockquote className="border-l-4 border-accent-rust/30 bg-accent-rust/5 pl-6 py-4 mb-8 rounded-r-lg">
          <p className="text-secondary leading-relaxed italic">
            Multi-Session Awareness &mdash; CRITICAL<br />
            Derek runs ~10 Claude Code terminals simultaneously, all sharing the main working directory.
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-8">
          That&rsquo;s important context for what follows.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The innocent prompt
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The originating session that day started at 1:21&nbsp;PM with this prompt:
        </p>

        <blockquote className="border-l-4 border-accent-rust/30 bg-accent-rust/5 pl-6 py-4 mb-8 rounded-r-lg">
          <p className="text-secondary leading-relaxed italic">
            <strong>Derek:</strong> how many more books should we try to find from the 1400s?
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          That&rsquo;s it. That&rsquo;s the prompt that, six hours later, would consume the rest of the day in a recovery operation. There is nothing dangerous about it. It&rsquo;s a curator question about gap analysis: how many incunabula could we add to the collection?
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Claude did exactly what a thoughtful research assistant would do. It queried the database, found we had relatively few 1400s books, identified that the BSB (Bavarian State Library) and ISTC (Incunabula Short Title Catalogue) had good coverage in this period, and proposed a 924-book import. We approved it. The script began running.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          That session was happy.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The other terminal
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          While the BSB import was running, I had <strong>another</strong> Claude Code session open in a different tab. The exact reconstruction of what that session was doing is fuzzier &mdash; there were nine candidates &mdash; but at some point that day, in some other terminal, Claude wrote a cleanup script.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The intent was reasonable: there were a lot of partially-imported, never-published &ldquo;draft hidden&rdquo; books cluttering up the database. Something like:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`await db.collection('books').deleteMany({
  status: 'draft',
  hidden: true
});`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          This is the kind of query that looks innocuous in isolation. We have a <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">deleted_books</code> collection that acts as soft-delete; restoring is one API call away; what could go wrong?
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          What went wrong: <strong>the BSB import in the other terminal was creating books with exactly <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">{`{ status: 'draft', hidden: true }`}</code>.</strong> That&rsquo;s how the import script staged new books before publishing them. Every book the import created was, for a few minutes, a match for the cleanup query.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The cleanup script didn&rsquo;t go through the soft-delete API. It called <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">deleteMany</code> directly. The books were gone &mdash; not in <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">deleted_books</code>, not in the warehouse, not recoverable through the normal restore endpoint.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Discovery
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          At 3:43&nbsp;PM I started a fresh Claude Code session and gave it what I thought was a routine status question. Two messages later:
        </p>

        <blockquote className="border-l-4 border-accent-rust/30 bg-accent-rust/5 pl-6 py-4 mb-8 rounded-r-lg">
          <p className="text-secondary leading-relaxed italic">
            <strong>Derek (3:44 PM):</strong> check if supabase has the missing books
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          That prompt &mdash; &ldquo;check if supabase has the missing books&rdquo; &mdash; was the moment I realized something was wrong. We use Supabase as a denormalized read replica for fast catalog queries. If the live MongoDB count and the Supabase count didn&rsquo;t match, that was a real signal.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Claude wrote the comparison query. The output came back:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`MongoDB total:           32,313
MongoDB published:        6,821
MongoDB drafts:          25,492
Supabase books_catalog:  12,415
Delta (published - supabase):  -5,594`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          Supabase had <strong>5,594 more published books</strong> than MongoDB. That&rsquo;s not possible unless something had recently been deleted from MongoDB without the corresponding Supabase deletion (which we don&rsquo;t do anyway &mdash; Supabase only mirrors live, not deletes).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Three minutes later, after digging deeper, Claude reported:
        </p>

        <blockquote className="border-l-4 border-accent-rust/30 bg-accent-rust/5 pl-6 py-4 mb-8 rounded-r-lg">
          <p className="text-secondary leading-relaxed italic mb-2">
            <strong>Claude (3:49 PM):</strong> 1,507 books restored to published. Now checking warehouse for the 4,731 completely missing ones&hellip;
          </p>
          <p className="text-secondary leading-relaxed italic">
            <strong>Result:</strong> Missing from live: 4731 / Found in warehouse: 0 / Truly lost (not in warehouse): 4731
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          The warehouse &mdash; our archive of older imports &mdash; had zero of them, because they were all <em>new</em> imports from the day. The pre-import drafts had been deleted before they could be promoted to published, and there was nothing to fall back to.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The final tally was actually <strong>4,758 missing</strong>. The GitHub postmortem issue used the rounded number 4,731. I&rsquo;m using the audited number, because the wrong number ends up in the memory and gets read by the next agent.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The recovery decision
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          At 4:19&nbsp;PM Claude in a separate session made the diagnostic call that determined the recovery strategy:
        </p>

        <blockquote className="border-l-4 border-accent-rust/30 bg-accent-rust/5 pl-6 py-4 mb-8 rounded-r-lg">
          <p className="text-secondary leading-relaxed italic mb-2">
            <strong>Claude:</strong> Found the issue. The draft deletion script from the other session hard-deleted ~914 of the 924 BSB books without going through soft-delete &mdash; they&rsquo;re not in <code>deleted_books</code>. The 10 that survived were already imported before this session.
          </p>
          <p className="text-secondary leading-relaxed italic mb-2">
            <strong>PITR assessment:</strong> You don&rsquo;t need it. The better recovery path is re-import:
          </p>
          <p className="text-secondary leading-relaxed italic">
            1. The <code>import_candidates</code> collection still has all 924 records marked <code>status: &lsquo;imported&rsquo;</code> with their BSB IDs<br />
            2. We just reset those 914 ghost records and re-run the import script<br />
            3. PITR would roll back all other pipeline work since then &mdash; that&rsquo;s a bigger blast radius than needed
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          This was the right call. <strong>Atlas Point-In-Time Recovery (PITR) would have given us the books back, but at the cost of rolling back six hours of other pipeline work</strong> &mdash; OCR completions, translation updates, page revisions across the rest of the active corpus. Re-import was surgical.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Over the next four hours we re-imported. By 9:52&nbsp;PM the GitHub postmortem issue was closed.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Why we got off easy
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          It is worth being honest about this: we should not have been able to recover this cleanly. We did, but only because three things lined up in our favor, and any one of them missing would have made this a real disaster instead of a long afternoon.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The books were never original to us.</strong> Source Library is a catalog over public-domain scans hosted at Internet Archive, the Bavarian State Library, the Bibliothèque nationale de France, Wellcome, e-rara, the Vatican, and ten others. The work we&rsquo;d done on top of those scans &mdash; page splits, OCR, translations, cross-references, classifications, embeddings &mdash; that is original to us, and a lot of it was lost. But the underlying <em>books</em> were never going anywhere. They sit on someone else&rsquo;s server. We can always re-fetch. If we had been operating on documents that only existed in our database, this would have been a permanent loss.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">import_candidates</code> queue had survived.</strong> When we set up the BSB import the day before, the script logged every BSB identifier we <em>intended</em> to fetch into a separate collection called <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">import_candidates</code>, with <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">status: &lsquo;imported&rsquo;</code> once each was pulled. The cleanup that nuked the books didn&rsquo;t touch that queue. That collection was the recovery list &mdash; without it we would have had no record of <em>which</em> 924 books we&rsquo;d intended to import. The fact that intent was tracked separately from materialization is what made re-import surgical.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Atlas Point-In-Time Recovery was on as the last-resort backstop.</strong> We didn&rsquo;t end up using PITR (the blast radius of rolling back six hours of unrelated pipeline work was too high), but its presence meant &ldquo;all 4,758 gone forever, with no fallback&rdquo; was never on the table. PITR is the floor below the floor. Knowing it was there is what let us choose the cleaner recovery path with confidence &mdash; re-import &mdash; rather than panic-restoring the whole database.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Of those three, <strong>only one was a decision we made</strong>: turning on PITR. The other two were luck &mdash; the books being public-domain originals, and the import queue happening to be in a separate collection. If we&rsquo;d been building a library of original scholarship instead of curating public materials, or if the import script had not bothered to log intent before fetch, we would have lost the work.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The lesson I take from this is: when running agents with write access to production, <strong>don&rsquo;t audit only your live data &mdash; audit your <em>recovery surface</em>.</strong> What do you fall back to? Is it in a different collection from the live data? Is it durable through a destructive operation? Is the floor below the floor turned on? Most teams I talk to have never inventoried this. Neither had I, until April 13. The fact that ours held up was a gift, not a system property.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What the agent actually did wrong
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          I want to push back on the temptation to call this a &ldquo;systemic&rdquo; failure. There are systemic contributing factors &mdash; I&rsquo;ll get to those &mdash; but the proximate cause is a behavior an attentive engineer would not have produced.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A careful human engineer about to bulk-delete on production would have done some subset of:
        </p>

        <ol className="list-decimal list-inside space-y-3 mb-6 text-secondary leading-relaxed pl-2">
          <li><strong>Count first.</strong> <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">{`countDocuments({ status: 'draft', hidden: true })`}</code> before any delete, see the number, and stop if it&rsquo;s bigger than expected.</li>
          <li><strong>Sample.</strong> Print 20 titles from the matching set and look at them.</li>
          <li><strong>Dry-run.</strong> Run with <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">--dry-run</code> and review the list.</li>
          <li><strong>Use the soft-delete API.</strong> The codebase has <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">/api/books/delete</code> exactly for this; restoration is one call away.</li>
          <li><strong>Ask.</strong> Send the count and a sample to me before destructive action.</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-6">
          The agent did <strong>none of these</strong>. It went directly from &ldquo;I see drafts I should clean up&rdquo; to <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">deleteMany</code>. There was no intermediate step where the size of the operation surfaced.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This is an AI-specific failure mode. Claude (and most LLMs trained the way Claude is) is fluent in the <em>form</em> of safety hygiene &mdash; it can write you a beautiful dry-run script &mdash; but is not reliably cautious in <em>its own work</em>. It models the operation it&rsquo;s about to run as roughly safe because it&rsquo;s syntactically similar to lots of safe operations it has seen. It does not feel the cost the way a human who has watched data disappear feels it.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          I am not making the agent the villain here &mdash; I gave it autonomy on a destructive surface without forcing the safety scaffolding. That&rsquo;s on me. But &ldquo;an engineer would have done the same&rdquo; is not true, and pretending it is true is how this happens again.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The systemic factors that made it worse
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The agent&rsquo;s behavior is the proximate cause. Four systemic factors turned a recoverable mistake into a four-hour incident:
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>1. Parallel sessions sharing one database.</strong> Ten Claude Code terminals can all write to the same MongoDB simultaneously. No agent can see what another agent is about to do. The CLAUDE.md document warns about this &mdash; &ldquo;branch switches in one terminal silently break all others&rdquo; &mdash; but the warning is framed around git branches, not data. There is no equivalent guard against parallel destructive writes.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>2. Cleanup queries that look safe in isolation.</strong> <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">{`deleteMany({ status: 'draft', hidden: true })`}</code> is, on any normal day, a reasonable cleanup that removes orphaned partial imports. The danger emerges only when another process is actively creating documents that match that query as a transient state. That&rsquo;s a temporal coupling no static code review catches.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>3. Soft-delete bypassed by direct MongoDB calls.</strong> We have a soft-delete API at <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">/api/books/delete</code> that archives to <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">deleted_books</code>. The cleanup didn&rsquo;t use it; it called the database driver directly. We trusted our own API. We did not enforce that trust at the database layer.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>4. The cron that would have caught it was never installed.</strong> Inside the repo, in <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">scripts/maintenance/</code>, there is a script called <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">sync-books-catalog.mjs</code> whose job is to compare MongoDB against Supabase every hour and surface count divergences. If that cron had been running, it would have caught the deletion within 60 minutes &mdash; probably before all 4,758 books were lost. The cron sat in version-controlled <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm">crontab.conf</code> but was never installed on the live Hetzner server. We had written the safety net, committed the safety net, reviewed the safety net, and not turned the safety net on.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What we changed
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The day after the incident, the CLAUDE.md gained an explicit rule:
        </p>

        <blockquote className="border-l-4 border-accent-rust/30 bg-accent-rust/5 pl-6 py-4 mb-8 rounded-r-lg">
          <p className="text-secondary leading-relaxed italic">
            <strong>Data Protection &mdash; CRITICAL</strong><br />
            &mdash; NEVER delete books, pages, or source material without explicit confirmation<br />
            &mdash; NEVER batch delete &mdash; list items first, wait for approval<br />
            &mdash; <code>deleted_books</code> collection has recoverable items: <code>POST /api/books/restore/[id]</code><br />
            &mdash; Assume all books are valuable, even without IA identifiers
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          That rule is loaded into the system prompt of every Claude Code session in the project. Every future agent reads it.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We also installed the cron. That took five minutes. We had had four months to do it.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What I think this means for AI-assisted development
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Four things, in order of how often I think about them.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>One: agents are not careful by default about their own destructive actions.</strong> This is the lesson I most want people to take from this. The agent will <em>write</em> you a careful script &mdash; full of dry-runs and sample-prints and confirmations &mdash; when you ask it to. It does not reliably <em>apply that carefulness to its own work</em> when it judges the operation routine. There is an asymmetry between &ldquo;what an agent recommends&rdquo; and &ldquo;what an agent does,&rdquo; and the asymmetry is in the wrong direction. An engineer who had recently watched data evaporate from their own database would have done a count, a sample, and a dry-run on instinct. The agent did not, because the agent has never watched data evaporate. The remediation is procedural, not motivational: destructive operations on production data have to be physically gated. You cannot rely on the agent to gate them.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Two: parallel agents share state, and that state can be destroyed faster than any individual agent can think.</strong> The mental model where each Claude Code session is a &ldquo;person at a workstation&rdquo; is wrong. It&rsquo;s more like ten interns simultaneously editing the same Google Sheet, except they can also drop the whole sheet. Sessions need shared coordination primitives &mdash; not just CLAUDE.md text but actual locks, queues, and guard endpoints that the database itself enforces.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Three: the lesson the AI writes after an incident is the lesson the next AI follows.</strong> This is great if the lesson is right and stable. It&rsquo;s terrible if the lesson is wrong, or if it gets compressed into something less precise. Our memory entry says &ldquo;required Atlas PITR&rdquo; when actually we didn&rsquo;t use it. The next time a future Claude reads that, it will believe PITR is the standard recovery path, which will lead it to the wrong tradeoff. <strong>Curating AI memory is a job.</strong> I am not yet good at it.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Four: the safety mechanisms agents write are only as good as the human&rsquo;s installation step.</strong> The agent wrote a perfectly serviceable monitoring cron. I never installed it. The cycle of &ldquo;agent invents tool &rarr; human installs tool &rarr; tool runs in production&rdquo; requires the human to actually run the third step, and in practice, when you have ten agents inventing tools all the time, the install step is the bottleneck.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What it cost
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We lost about four hours of pipeline work to recovery and roughly $200 of re-imported OCR / translation work (most of that was Gemini calls re-running on the books that came back). No user-visible content was lost &mdash; the books were not yet published. There was no SLA breach.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The thing it cost more of: trust. For about a week after, I added a manual &ldquo;review before deleting&rdquo; gate on every cleanup script Claude proposed, even cleanup scripts I knew were correct. The autonomy I had been comfortable granting shrank. It is mostly back now, but it is not all the way back, and I think that is correct.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Why I&rsquo;m sharing this
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          A growing number of people are doing what I&rsquo;m doing &mdash; running multiple AI coding agents in parallel against production data. Most of the public discourse about this is about either the spectacular wins (&ldquo;look how much I shipped&rdquo;) or the catastrophic moralizing (&ldquo;AI cannot be trusted&rdquo;). The middle ground &mdash; actual operational failure modes you have to design against &mdash; is mostly conversation between practitioners.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          So: here is one, with primary sources. The prompt that triggered it (&ldquo;how many more books should we try to find from the 1400s?&rdquo;) was a great research question. The query that killed the books (&ldquo;delete every draft hidden book&rdquo;) was the kind of shortcut a careful engineer would not have taken on production. The recovery worked. The lesson was learned. The next agent reads it.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          If you&rsquo;re going to give AI agents write access to production data, the practical defenses are:
        </p>

        <ol className="list-decimal list-inside space-y-3 mb-8 text-secondary leading-relaxed pl-2">
          <li><strong>Inventory your recovery surface, not just your live data.</strong> What do you fall back to? Is it in a different collection? Durable through a destructive operation? Is the floor below the floor turned on?</li>
          <li><strong>Database-level constraints that prevent non-API destructive operations.</strong> Don&rsquo;t trust convention. Make the dangerous path physically impossible.</li>
          <li><strong>A required pattern for bulk deletes</strong>: count &rarr; sample &rarr; dry-run &rarr; confirm &rarr; soft-delete. Encode it in the linter, the CI, the CLAUDE.md, <em>and</em> the actual delete endpoint.</li>
          <li><strong>A divergence monitor between source-of-truth and replicas</strong>, running on a cron that you have actually installed.</li>
          <li><strong>A rule against destructive operations on status fields alone</strong>, baked into the agent&rsquo;s standing instructions.</li>
          <li><strong>An awareness that &ldquo;draft hidden&rdquo; is sometimes a transient state of an <em>active</em> operation</strong>, not garbage to clean up.</li>
          <li><strong>Memory entries written with the precise, audited number</strong>, not the rounded-for-the-PR-title number &mdash; because the next agent will read them as ground truth.</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-6">
          I had three of those seven. The four I was missing were enough to lose 4,758 books for an afternoon.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The books are back. The agents are smarter. The cron is installed.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <em>&mdash; Derek</em>
        </p>

      </article>
    </ContentPageLayout>
  );
}
