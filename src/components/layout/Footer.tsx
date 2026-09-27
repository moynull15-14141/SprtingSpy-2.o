/**
 * SportingSpy Global Footer
 * Quiet, authoritative editorial footer with structured navigation, legal links, and platform architecture info.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { BRANDING } from '../../config/branding';

export const Footer: React.FC = () => {
  const { navigate, sports } = useApp();

  return (
    <footer className="mt-20 border-t border-stone-200 dark:border-stone-800 bg-stone-100/50 dark:bg-[#08090a] transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand & Editorial Mission */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-display text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                {BRANDING.name}
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-500 inline-block self-center mb-0.5"></span>
            </div>
            <p className="text-sm text-stone-600 dark:text-stone-400 max-w-sm leading-relaxed">
              {BRANDING.description}
            </p>
            <div className="text-xs text-stone-500 dark:text-stone-500 pt-2 space-y-1">
              <p>Independent multi-sport editorial publication.</p>
              <p>Manual journalistic curation · No automated live score feeds.</p>
            </div>
          </div>

          {/* Sports Hubs */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-200">
              Sports Hubs
            </h4>
            <ul className="space-y-2 text-sm text-stone-600 dark:text-stone-400">
              {sports.slice(0, 6).map((sp) => (
                <li key={sp.id}>
                  <button
                    onClick={() => navigate(`/${sp.slug}`)}
                    className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors text-left"
                  >
                    {sp.name}
                  </button>
                </li>
              ))}
              <li>
                <button
                  onClick={() => navigate('/sports')}
                  className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                >
                  All 12+ Sports &rarr;
                </button>
              </li>
            </ul>
          </div>

          {/* Editorial & Information */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-200">
              Editorial
            </h4>
            <ul className="space-y-2 text-sm text-stone-600 dark:text-stone-400">
              <li>
                <button onClick={() => navigate('/events')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  Permanent Events Index
                </button>
              </li>
              <li>
                <button onClick={() => navigate('/latest')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  Latest Editorial Articles
                </button>
              </li>
              <li>
                <button onClick={() => navigate('/search')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  Search & Reference
                </button>
              </li>
              <li>
                <button onClick={() => navigate('/about')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  About SportingSpy
                </button>
              </li>
              <li>
                <button onClick={() => navigate('/contact')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  Contact Editorial Bureau
                </button>
              </li>
            </ul>
          </div>

          {/* Legal & Standards */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-200">
              Legal & Standards
            </h4>
            <ul className="space-y-2 text-sm text-stone-600 dark:text-stone-400">
              <li>
                <button onClick={() => navigate('/privacy')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  Privacy Policy
                </button>
              </li>
              <li>
                <button onClick={() => navigate('/terms')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  Terms of Service
                </button>
              </li>
              <li>
                <button onClick={() => navigate('/dmca')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  DMCA & Copyright
                </button>
              </li>
              {/* PHASE 3: removed the "Staff Login (CMS)" link to /admin —
                  the public site must not provide any navigation path to the
                  Admin Panel. Staff access it directly by URL. */}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-stone-500 dark:text-stone-500">
          <p>
            &copy; {BRANDING.foundedYear} {BRANDING.name}. All sports data and editorial assets maintained for archival and informational reference.
          </p>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-stone-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Editorial System Online
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
