import { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import SiteHeader from '@/components/layout/SiteHeader';
import WelcomeForm from '@/components/welcome/WelcomeForm';
import { getWelcomeHero } from '@/lib/welcome-hero';
import { getDb } from '@/lib/mongodb';
import { toUserId } from '@/lib/user-id';
import { welcomeSignInUrl } from '@/lib/welcome-return';

export const metadata: Metadata = {
  title: 'Welcome — Source Library',
  robots: { index: false, follow: false },
};

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    // Carry the destination through sign-in. Without this the reader signs in
    // and lands on the homepage, having lost the book they clicked.
    const { from } = await searchParams;
    redirect(welcomeSignInUrl(Array.isArray(from) ? from[0] : from));
  }

  const firstName = session.user.name?.split(' ')[0] || null;

  // Prefill from what they already told us. This is a data-integrity fix, not a
  // convenience: the form used to render blank every time, and saving it wrote
  // those blanks over the stored answers. Anyone who reached /welcome twice
  // therefore erased themselves — which is exactly what the redirect loop
  // (#3467) made people do. Two readers lost their answers that way on
  // 2026-07-30, recovered only because the `volunteers` mirror happens to keep a
  // copy. With the fields prefilled, an empty box means "I cleared this", which
  // is the only reading under which overwriting is correct.
  //
  // Server-side rather than a fetch on mount, so there is no window in which the
  // form is mounted, empty, and submittable.
  let initialProfile = { aboutYou: '', preferredLanguage: '', helpDescription: '' };
  try {
    const db = await getDb();
    const user = await db.collection('users').findOne(
      { _id: toUserId(session.user.id) as any },
      { projection: { profile: 1 } }
    );
    initialProfile = {
      aboutYou: user?.profile?.aboutYou || '',
      preferredLanguage: user?.profile?.preferredLanguage || '',
      helpDescription: user?.profile?.helpDescription || '',
    };
  } catch (error) {
    // A failed read must not block the page — but it MUST NOT silently fall
    // through to blank fields either, because a blank save would then wipe
    // stored answers. WelcomeForm treats profileLoaded=false as "send only the
    // fields the reader actually typed".
    console.error('[welcome] profile prefill failed:', error);
    return renderPage({ userName: session.user.name || "", firstName, hero: await getWelcomeHero(), initialProfile, profileLoaded: false });
  }

  const hero = await getWelcomeHero();
  return renderPage({ userName: session.user.name || "", firstName, hero, initialProfile, profileLoaded: true });
}

function renderPage({
  userName,
  firstName,
  hero,
  initialProfile,
  profileLoaded,
}: {
  userName: string;
  firstName: string | null;
  hero: Awaited<ReturnType<typeof getWelcomeHero>>;
  initialProfile: { aboutYou: string; preferredLanguage: string; helpDescription: string };
  profileLoaded: boolean;
}) {

  return (
    <div className="relative min-h-screen bg-stone-900">
      {/* Full-bleed background image */}
      <Image
        src={hero.imageUrl}
        alt={hero.description || hero.bookTitle || 'A page from the collection'}
        fill
        priority
        sizes="100vw"
        className="object-cover"
        unoptimized
      />
      <div className="absolute inset-0 bg-stone-900/30 pointer-events-none" />

      {/* Header sits over the image */}
      <div className="relative z-20">
        <SiteHeader variant="light" />
      </div>

      {/* Form pinned just below the header */}
      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-6 md:pt-10 pb-24">
        <p className="font-serif text-white text-xl md:text-2xl mb-2 px-2 drop-shadow-md">
          {firstName ? `Welcome, ${firstName}.` : 'Welcome.'}
        </p>
        {/* Why we're asking. The form opened straight into three questions with
            no reason given, which reads as data collection rather than an
            introduction. Derek's wording — keep it verbatim. */}
        <p className="text-white/90 text-base md:text-lg mb-4 px-2 drop-shadow-md max-w-xl">
          We&rsquo;re a small team and it really helps us to know who we are building for.
          Everything is optional.
        </p>
        <WelcomeForm
          initialName={userName}
          initialAboutYou={initialProfile.aboutYou}
          initialPreferredLanguage={initialProfile.preferredLanguage}
          initialHelpDescription={initialProfile.helpDescription}
          profileLoaded={profileLoaded}
        />
      </div>

      {(hero.bookTitle || hero.bookYear) && (
        <p className="absolute bottom-3 right-4 z-10 text-[11px] text-white/70 tracking-wide drop-shadow">
          {[hero.bookTitle, hero.bookYear].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
