/**
 * SportingSpy Global Footer
 * Quiet, authoritative editorial footer with structured navigation, legal links, and platform architecture info.
 *
 * PHASE F.1: content comes from the Site Experience footer document
 * (published, or the draft in preview): identity text, columns and links,
 * social profiles and the legal links. Defaults reproduce the original footer.
 */

import React from 'react';
import { BRANDING } from '../../config/branding';
import { PrivacyChoicesButton } from '../privacy/PrivacyProvider';
import { SiteLink } from '../site/SiteLink';
import { Facebook, Instagram, Linkedin, Music2, Send, Twitter, Youtube, type LucideIcon } from 'lucide-react';
import type { FooterConfig, SocialPlatform } from '../../lib/siteExperience/types';

interface FooterProps {
  sports: { id: string; slug: string; name: string }[];
  config: FooterConfig;
}

const SOCIAL: Record<SocialPlatform, { label: string; icon: LucideIcon }> = {
  x: { label: 'X (Twitter)', icon: Twitter }, facebook: { label: 'Facebook', icon: Facebook }, instagram: { label: 'Instagram', icon: Instagram },
  youtube: { label: 'YouTube', icon: Youtube }, linkedin: { label: 'LinkedIn', icon: Linkedin }, bluesky: { label: 'Bluesky', icon: Send }, tiktok: { label: 'TikTok', icon: Music2 },
};

const linkClass = 'hover:text-amber-600 dark:hover:text-amber-400 transition-colors';

export const Footer: React.FC<FooterProps> = ({ sports, config }) => {
  const columns = config.columns.filter((c) => c.enabled);
  const social = config.social.filter((s) => s.enabled);

  return (
    <footer className="mt-20 border-t border-stone-200 dark:border-stone-800 bg-stone-100/50 dark:bg-[#08090a] transition-colors">
      <div className="max-w-[98rem] mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand & Editorial Mission */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-display text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                {BRANDING.name}
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-700 dark:bg-amber-500 inline-block self-center mb-0.5"></span>
            </div>
            {config.tagline && (
              <p className="text-sm text-stone-600 dark:text-stone-400 max-w-sm leading-relaxed">{config.tagline}</p>
            )}
            {config.notes.length > 0 && (
              <div className="text-xs text-stone-500 dark:text-stone-400 pt-2 space-y-1">
                {config.notes.map((n, i) => <p key={i}>{n}</p>)}
              </div>
            )}
            {social.length > 0 && (
              <ul className="flex flex-wrap gap-2 pt-2" aria-label="Social media">
                {social.map((s) => {
                  const { label, icon: Icon } = SOCIAL[s.platform];
                  return (
                    <li key={s.platform}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer me" aria-label={`${BRANDING.name} on ${label}`} title={label} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 text-stone-600 hover:border-amber-500 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:text-stone-300 dark:hover:text-amber-400">
                        <Icon size={16} aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {columns.map((col) => (
            <div key={col.id} className="space-y-3" data-footer-column={col.id}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-200">{col.title}</h2>
              <ul className="space-y-2 text-sm text-stone-600 dark:text-stone-400">
                {col.kind === 'sports' && sports.slice(0, col.sportsCount).map((sp) => (
                  <li key={sp.id}><SiteLink href={`/${sp.slug}/`} className={`${linkClass} text-left`}>{sp.name}</SiteLink></li>
                ))}
                {col.links.filter((l) => l.enabled).map((l) => (
                  <li key={l.id}>
                    {l.kind === 'privacyChoices' ? (
                      <PrivacyChoicesButton label={l.label} className={`text-left ${linkClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded`} />
                    ) : (
                      <SiteLink href={l.href} className={col.kind === 'sports' ? 'text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline' : linkClass}>{l.label}</SiteLink>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {/* PHASE 3: no "Staff Login (CMS)" link to /admin — the public site
              must not provide any navigation path to the Admin Panel. */}
        </div>

        <div className="mt-12 pt-8 border-t border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
          {config.copyright && <p>{config.copyright}</p>}
          {config.statusText && (
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-stone-500 dark:text-stone-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                {config.statusText}
              </span>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
};
