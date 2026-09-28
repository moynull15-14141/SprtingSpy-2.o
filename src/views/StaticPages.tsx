/**
 * SportingSpy Static Editorial & Compliance Pages
 * Clean institutional documents for About, Contact, Terms, and DMCA.
 */

import React from 'react';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { BRANDING } from '../config/branding';
import { ContactForm } from './ContactForm';

export const AboutPage: React.FC = () => (
  <div className="max-w-3xl mx-auto space-y-6">
    <Breadcrumbs items={[{ label: 'About SportingSpy' }]} />

    <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
      <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100">
        About SportingSpy
      </h1>
      <p className="mt-2 text-stone-600 dark:text-stone-400 font-serif italic text-lg">
        {BRANDING.tagline}
      </p>
    </header>

    <div className="prose prose-stone dark:prose-invert space-y-4 text-stone-800 dark:text-stone-200 leading-relaxed text-sm sm:text-base">
      <p>
        Founded in {BRANDING.foundedYear}, <strong>{BRANDING.name}</strong> was created to restore structured clarity, archival depth, and regulatory rigor to sports journalism. Modern sports web platforms have frequently collapsed into automated live-score widgets, clickbait rumor mills, and speculative betting clutter.
      </p>
      <h2 className="font-serif text-2xl font-bold pt-4 text-stone-900 dark:text-stone-100">
        Our Conceptual Hierarchy
      </h2>
      <p>
        Every piece of sports intelligence on SportingSpy adheres to a rigorous architectural model:
      </p>
      <div className="p-4 rounded-xl bg-stone-100 dark:bg-stone-900 font-mono text-xs text-stone-800 dark:text-stone-200">
        SPORT &rarr; PERMANENT EVENT &rarr; EVENT EDITION &rarr; ARTICLE
      </div>
      <p>
        We distinguish between permanent sporting institutions (such as the <em>French Open</em> or <em>The Masters</em>) and their yearly editions (such as the <em>2027 French Open</em>). This structure preserves historical continuity while providing verified, session-by-session logistical guidance for fans and journalists.
      </p>
      <h2 className="font-serif text-2xl font-bold pt-4 text-stone-900 dark:text-stone-100">
        Editorial Independence
      </h2>
      <p>
        All schedules, prize money distributions, and rule interpretations are manually verified against primary regulatory bodies (ITF, FIA, UEFA, World Rugby, R&A/USGA). We do not deploy automated scrape bots to publish unchecked data.
      </p>
    </div>
  </div>
);

export const ContactPage: React.FC = () => {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: 'Contact' }]} />

      <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
        <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">
          Contact Editorial Bureau
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Direct inquiries for newsroom correspondents, fact-checking verifications, and regulatory sources.
        </p>
      </header>

      <ContactForm />
    </div>
  );
};

// PHASE F: the Privacy Policy lives in views/PrivacyPolicyPage.tsx (generated from the live provider configuration).

export const TermsPage: React.FC = () => (
  <div className="max-w-3xl mx-auto space-y-6">
    <Breadcrumbs items={[{ label: 'Terms of Service' }]} />
    <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
      <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">Terms of Service</h1>
      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Last Revised: September 2026</p>
    </header>
    <div className="prose prose-stone dark:prose-invert space-y-4 text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
      <p>By accessing SportingSpy.com, you agree to these Terms of Service. All editorial commentary, analysis, tournament guides, and tabular data compilations are protected by copyright laws.</p>
      <p>Users participating in editorial discussions agree not to post defamatory, commercial, or copyrighted content without authorization.</p>
    </div>
  </div>
);

export const DmcaPage: React.FC = () => (
  <div className="max-w-3xl mx-auto space-y-6">
    <Breadcrumbs items={[{ label: 'DMCA Policy' }]} />
    <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
      <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">DMCA Copyright Policy</h1>
      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Notice and Takedown Procedure</p>
    </header>
    <div className="prose prose-stone dark:prose-invert space-y-4 text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
      <p>SportingSpy complies with the Digital Millennium Copyright Act (17 U.S.C. § 512). If you believe your copyrighted work has been reproduced on SportingSpy in a manner constituting copyright infringement, please submit a written notification to our designated copyright bureau at <code>dmca@sportingspy.com</code>.</p>
    </div>
  </div>
);
