/**
 * SportingSpy Static Editorial & Compliance Pages
 * Clean institutional documents for About, Contact, Privacy, Terms, and DMCA.
 */

import React, { useState } from 'react';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { BRANDING } from '../config/branding';
import { Button } from '../components/ui/Button';

export const AboutPage: React.FC = () => (
  <div className="max-w-3xl mx-auto space-y-6">
    <SeoHead
      title="About SportingSpy – Multi-Sport Editorial Standards"
      description="The founding principles, editorial mission, and verification methodology of SportingSpy.com."
      canonicalPath="/about"
    />
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
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <SeoHead
        title="Contact Editorial Desk | SportingSpy"
        description="Submit corrections, media inquiries, or tournament credentials to the SportingSpy editorial team."
        canonicalPath="/contact"
      />
      <Breadcrumbs items={[{ label: 'Contact' }]} />

      <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
        <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">
          Contact Editorial Bureau
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Direct inquiries for newsroom correspondents, fact-checking verifications, and regulatory sources.
        </p>
      </header>

      {submitted ? (
        <div className="p-6 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm">
          <h3 className="font-semibold text-base mb-1">Message Received</h3>
          <p>Thank you for contacting the SportingSpy editorial bureau. A desk editor will review your inquiry within one business day.</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
          className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
              Your Full Name
            </label>
            <input
              type="text"
              required
              className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              placeholder="e.g. Jane Doe"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              placeholder="editor@organization.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
              Inquiry Department
            </label>
            <select className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option>Editorial Correction / Fact-Check</option>
              <option>Tournament Credential Inquiry</option>
              <option>Licensing & Syndication</option>
              <option>Sponsorship / Direct Partnership</option>
              <option>General Inquiries</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
              Message / Reference Details
            </label>
            <textarea
              rows={4}
              required
              className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              placeholder="Specify tournament, article URL, and primary source citation..."
            />
          </div>
          <Button type="submit" size="md" className="w-full">
            Transmit Editorial Inquiry
          </Button>
        </form>
      )}
    </div>
  );
};

export const PrivacyPage: React.FC = () => (
  <div className="max-w-3xl mx-auto space-y-6">
    <SeoHead
      title="Privacy Policy | SportingSpy"
      description="Privacy terms and data protection policies of SportingSpy.com."
      canonicalPath="/privacy"
    />
    <Breadcrumbs items={[{ label: 'Privacy Policy' }]} />
    <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
      <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">Privacy Policy</h1>
      <p className="mt-1 text-xs text-stone-500">Last Revised: September 2026</p>
    </header>
    <div className="prose prose-stone dark:prose-invert space-y-4 text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
      <p>SportingSpy values reader privacy. We do not sell or monetize personal data. Account credentials registered for commentary are stored using encrypted protocols.</p>
      <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100 pt-2">Cookies & Preferences</h3>
      <p>We use lightweight local storage solely to retain user interface settings (such as light or dark theme mode) and authenticated session identity. We do not employ third-party tracking pixels that monitor external browsing activity.</p>
    </div>
  </div>
);

export const TermsPage: React.FC = () => (
  <div className="max-w-3xl mx-auto space-y-6">
    <SeoHead
      title="Terms of Service | SportingSpy"
      description="Terms of service and reader agreement for SportingSpy.com."
      canonicalPath="/terms"
    />
    <Breadcrumbs items={[{ label: 'Terms of Service' }]} />
    <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
      <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">Terms of Service</h1>
      <p className="mt-1 text-xs text-stone-500">Last Revised: September 2026</p>
    </header>
    <div className="prose prose-stone dark:prose-invert space-y-4 text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
      <p>By accessing SportingSpy.com, you agree to these Terms of Service. All editorial commentary, analysis, tournament guides, and tabular data compilations are protected by copyright laws.</p>
      <p>Users participating in editorial discussions agree not to post defamatory, commercial, or copyrighted content without authorization.</p>
    </div>
  </div>
);

export const DmcaPage: React.FC = () => (
  <div className="max-w-3xl mx-auto space-y-6">
    <SeoHead
      title="DMCA Copyright Policy | SportingSpy"
      description="DMCA and intellectual property notification process for SportingSpy.com."
      canonicalPath="/dmca"
    />
    <Breadcrumbs items={[{ label: 'DMCA Policy' }]} />
    <header className="border-b border-stone-200 dark:border-stone-800 pb-4">
      <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">DMCA Copyright Policy</h1>
      <p className="mt-1 text-xs text-stone-500">Notice and Takedown Procedure</p>
    </header>
    <div className="prose prose-stone dark:prose-invert space-y-4 text-xs sm:text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
      <p>SportingSpy complies with the Digital Millennium Copyright Act (17 U.S.C. § 512). If you believe your copyrighted work has been reproduced on SportingSpy in a manner constituting copyright infringement, please submit a written notification to our designated copyright bureau at <code>dmca@sportingspy.com</code>.</p>
    </div>
  </div>
);
