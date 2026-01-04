'use client';

import Link from 'next/link';
import { Heart, Mail, ExternalLink } from 'lucide-react';

// Fundraising progress
const GOAL = 100000;
const RAISED = 55000;

export default function SupportPage() {
  return (
    <div className="min-h-screen">
      {/* Hero Section - matches front page */}
      <section className="relative h-[70vh] w-full overflow-hidden bg-black">
        {/* Video background */}
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover z-0"
        >
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.webm" type="video/webm" />
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.mp4" type="video/mp4" />
        </video>

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/50 z-0" />

        {/* Header */}
        <header className="relative z-50 flex items-center justify-between px-6 md:px-12 py-4">
          <Link href="/" className="text-white flex items-center gap-3">
            <svg className="w-10 h-10 md:w-12 md:h-12" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
            </svg>
            <span className="text-xl md:text-2xl uppercase tracking-wider">
              <span className="font-semibold">Source</span>
              <span className="font-light">Library</span>
            </span>
          </Link>
        </header>

        {/* Hero Content */}
        <div className="relative z-10 h-full flex items-center">
          <div className="px-6 md:px-12 max-w-3xl">
            <h1
              className="text-4xl md:text-5xl lg:text-6xl text-white mb-6 leading-tight tracking-wide"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              Help Preserve Ancient Wisdom
            </h1>
            <p className="text-lg md:text-xl font-light text-white/90 leading-relaxed max-w-2xl">
              Your donation funds the digitization and translation of rare texts from the Bibliotheca Philosophica Hermetica.
            </p>
          </div>
        </div>
      </section>

      {/* Donation Section */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-3xl mx-auto">

          {/* Thermometer */}
          <div className="bg-white rounded-2xl border border-stone-200 p-8 mb-8 shadow-sm">
            <div className="flex justify-between items-end mb-4">
              <div>
                <span className="text-4xl md:text-5xl font-bold text-green-600">${(RAISED / 1000).toFixed(0)}k</span>
                <span className="text-stone-500 ml-2">raised</span>
              </div>
              <div className="text-right">
                <span className="text-stone-400">${(GOAL / 1000).toFixed(0)}k goal</span>
              </div>
            </div>
            <div className="h-4 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full"
                style={{ width: `${(RAISED / GOAL) * 100}%` }}
              />
            </div>
          </div>

          {/* Donate Buttons */}
          <div className="space-y-4">
            <a
              href="https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full bg-amber-600 hover:bg-amber-700 text-white text-lg font-medium py-4 px-6 rounded-xl transition-colors"
            >
              <Heart className="w-5 h-5" />
              Donate Now
              <ExternalLink className="w-4 h-4" />
            </a>

            <a
              href="mailto:derek@ancientwisdomtrust.org?subject=Source%20Library%20Pledge&body=I%20would%20like%20to%20pledge%20%24_____%20to%20support%20Source%20Library."
              className="flex items-center justify-center gap-3 w-full bg-white hover:bg-stone-50 text-stone-700 text-lg font-medium py-4 px-6 rounded-xl transition-colors border border-stone-200"
            >
              <Mail className="w-5 h-5" />
              Make a Pledge via Email
            </a>
          </div>

          <p className="text-center text-stone-500 text-sm mt-6">
            Tax-deductible via the Netherland-America Foundation (501c3)
          </p>
        </div>
      </section>

      {/* Partner Logos */}
      <section className="bg-white py-12">
        <div className="px-6 md:px-12 max-w-3xl mx-auto">
          <div className="flex items-center justify-center gap-8">
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="h-12 md:h-16 w-auto object-contain"
            />
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-16 md:h-20 w-auto object-contain"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
