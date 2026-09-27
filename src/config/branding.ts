/**
 * SportingSpy Branding & Visual Identity Configuration
 * Easily replaceable configuration without modifying application components.
 */

export interface BrandConfig {
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  domain: string;
  supportEmail: string;
  editorialEmail: string;
  foundedYear: number;
  socials: {
    xTwitter: string;
    bluesky?: string;
    youtube?: string;
    instagram?: string;
  };
  typography: {
    displayFont: string;
    serifFont: string;
    sansFont: string;
  };
  colors: {
    primaryAccent: string; // sports amber/gold or racing green
    primaryDark: string;
    surfaceLight: string;
    surfaceDark: string;
  };
}

export const BRANDING: BrandConfig = {
  name: 'SportingSpy',
  shortName: 'SportingSpy',
  tagline: 'The Authoritative Multi-Sport Intelligence & Editorial Platform',
  description: 'Structured sports intelligence, verified schedules, comprehensive event editions, viewing guides, prize money, records, and long-form analysis across global athletics.',
  domain: 'sportingspy.com',
  supportEmail: 'contact@sportingspy.com',
  editorialEmail: 'editorial@sportingspy.com',
  foundedYear: 2026,
  socials: {
    xTwitter: 'https://twitter.com/SportingSpy',
    bluesky: 'https://bsky.app/profile/sportingspy.com',
    youtube: 'https://youtube.com/@SportingSpy',
    instagram: 'https://instagram.com/SportingSpyOfficial',
  },
  typography: {
    displayFont: 'Cinzel, Georgia, serif',
    serifFont: 'Newsreader, Georgia, serif',
    sansFont: 'Plus Jakarta Sans, system-ui, sans-serif',
  },
  colors: {
    primaryAccent: '#d97706', // Amber-600 warm sports gold
    primaryDark: '#0c0d0e',
    surfaceLight: '#fbf9f5',
    surfaceDark: '#121417',
  }
};
