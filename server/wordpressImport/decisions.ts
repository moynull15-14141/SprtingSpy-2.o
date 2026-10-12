/**
 * Mapping decisions approved by the site owner for the WordPress migration.
 * Keys are WordPress post IDs. These are decisions about the MAPPING only:
 * nothing here creates a Sport, an Author profile or an article. A sport or
 * profile that does not exist yet is reported as "pending creation" and its
 * posts stay blocked until an Admin has created it in the CMS.
 */
export const DECISIONS_APPROVED_ON = '2026-10-12';

/** Sport per post where the WordPress category was missing, wrong or ambiguous. */
export const APPROVED_SPORTS: Record<string, string> = {
  // New sports (pending creation).
  '1048': 'rodeo', '3688': 'rodeo', '3716': 'rodeo',
  '1085': 'horse-racing', '3775': 'horse-racing', '3805': 'horse-racing',
  '3567': 'curling',
  '142': 'australian-football',
  // Triathlon / IRONMAN: its own sport, not athletics.
  '973': 'triathlon', '3020': 'triathlon', '3023': 'triathlon', '3026': 'triathlon',
  // Confirmed existing sports.
  '86': 'boxing', '243': 'boxing', '2877': 'boxing',
  '3608': 'hockey',
};

/** The approved new sports. Created by an Admin action (name and slug only; no tagline or description is invented). */
export const NEW_SPORTS: { slug: string; name: string }[] = [
  { slug: 'rodeo', name: 'Rodeo' },
  { slug: 'horse-racing', name: 'Horse Racing' },
  { slug: 'curling', name: 'Curling' },
  { slug: 'australian-football', name: 'Australian Football' },
  { slug: 'triathlon', name: 'Triathlon' },
];

/** Role title shown on the two source-attribution profiles. A label only: an Author profile grants no permissions and is not a login. */
export const AUTHOR_ROLE_TITLE = 'Contributor';

/** Author profile slug per WordPress display name. Unlinked profiles: no login, no e-mail. */
export const AUTHOR_PROFILE_SLUGS: Record<string, string> = { Jamie: 'jamie', 'Sergio J. Bynum': 'sergio-j-bynum' };

/** Posts about the same subject that stay separate articles (never merged or dropped). */
export const KEEP_SEPARATE: string[][] = [['118', '3866'], ['1085', '3805'], ['3020', '3023', '3026']];

/** Posts that may be attached to an event edition, but only when that exact edition is verified to exist. */
export const EVENT_LINK_CANDIDATES = ['68', '118', '3866', '3906'];

/**
 * Old category archives and the sport whose hub page replaces them. A link is
 * rewritten only when that hub page is verified live. "run" held the marathon
 * posts, which are now under athletics (owner decision).
 */
export const CATEGORY_ARCHIVE_SPORT: Record<string, string> = {
  athletics: 'athletics', basketball: 'basketball', boxing: 'boxing', cycling: 'cycling', football: 'football', golf: 'golf', hockey: 'hockey',
  nfl: 'nfl', rugby: 'rugby', tennis: 'tennis', 'net-ball': 'netball', fight: 'boxing', run: 'athletics', rodeo: 'rodeo', racing: 'horse-racing', curling: 'curling',
};

/** The five posts of the isolated pilot and the feature each one must exercise. */
export const PILOT_POSTS: { id: string; covers: 'large-table' | 'faq' | 'caption' | 'video' | 'merged-cells'; why: string }[] = [
  { id: '3534', covers: 'large-table', why: 'The largest table of the migration, plus H5 headings that become H4.' },
  { id: '1163', covers: 'faq', why: 'The most FAQ accordion entries, with decorative icons to drop.' },
  { id: '1186', covers: 'caption', why: 'An inline image with a caption.' },
  { id: '240', covers: 'video', why: 'A separate YouTube video link that becomes an embed block.' },
  { id: '3866', covers: 'merged-cells', why: 'The most merged table cells; also attached to an existing event edition.' },
];
