import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import VolunteerForm from '@/components/contribute/VolunteerForm';

export const metadata: Metadata = {
  title: 'Volunteer - Source Library',
  description: 'Sign up to help translate, annotate, and study rare texts from the Western esoteric tradition.',
  alternates: {
    canonical: '/contribute/volunteer',
  },
};

export default function VolunteerPage() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-2xl mx-auto px-6 py-12 md:py-16">
        <h1 className="font-serif text-3xl md:text-4xl text-primary mb-3">
          Volunteer with us
        </h1>
        <p className="text-secondary leading-relaxed mb-8 max-w-2xl">
          Tell us what languages you read and how you&apos;d like to help.
          We&apos;ll match you with texts that need attention and keep you posted on new arrivals in your areas of interest.
        </p>

        <VolunteerForm />

        {/* This promised "an edit button on every page, no sign-up needed."
            No route has ever provided that: every page-text write is gated at
            editor and the Read/Edit toggle only renders for editors (#3511).
            /contribute was corrected then; this page was missed. Flagging a
            problem really is open to everyone, so that is what it now says —
            same wording as /contribute, deliberately. */}
        <p className="text-muted text-sm mt-8 leading-relaxed">
          You can also just start reading &mdash; every page has a &ldquo;Notice a translation issue?&rdquo; link
          that takes a note straight to us, no account needed. This form helps us coordinate and reach out
          when we have something specific that matches your skills.
        </p>
      </div>
    </div>
  );
}
