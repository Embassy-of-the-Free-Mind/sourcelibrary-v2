import { Metadata } from 'next';
import Link from 'next/link';
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
      {/* Nav */}
      <header className="bg-white border-b border-border-light">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link
            href="/contribute"
            className="flex items-center gap-2 text-secondary hover:text-primary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back to Participate
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <h1 className="font-serif text-3xl md:text-4xl text-primary mb-3">
          Volunteer with us
        </h1>
        <p className="text-secondary leading-relaxed mb-8 max-w-2xl">
          Tell us what languages you read and how you&apos;d like to help.
          We&apos;ll match you with texts that need attention and keep you posted on new arrivals in your areas of interest.
        </p>

        <VolunteerForm />

        <p className="text-muted text-sm mt-8 leading-relaxed">
          You can also just start reading &mdash; every book has an edit button on every page, no sign-up needed.
          This form helps us coordinate and reach out when we have something specific that matches your skills.
        </p>
      </div>
    </div>
  );
}
