/**
 * Sport icons: one curated set, so every sport's icon has the same style.
 * Admins choose from this list only (the server rejects anything else).
 * Icons render inside a fixed-size badge (components/ui/SportIcon).
 *
 * A sport without a chosen icon gets the best suggestion for its name, so a
 * new sport never shows a mismatched or empty icon.
 */

export interface SportIconOption { emoji: string; label: string; keywords: string[] }

// Order matters for ties: the more common sport comes first (e.g. ice hockey before field hockey).
export const SPORT_ICONS: SportIconOption[] = [
  { emoji: '⚽', label: 'Football (soccer)', keywords: ['football', 'soccer', 'futsal', 'premier league', 'la liga', 'champions league', 'fifa'] },
  { emoji: '🏈', label: 'American football', keywords: ['american football', 'nfl', 'gridiron', 'super bowl', 'college football'] },
  { emoji: '🏀', label: 'Basketball', keywords: ['basketball', 'nba', 'wnba', 'euroleague', '3x3'] },
  { emoji: '🏏', label: 'Cricket', keywords: ['cricket', 'ipl', 'test match', 't20', 'odi', 'ashes'] },
  { emoji: '🎾', label: 'Tennis', keywords: ['tennis', 'padel', 'atp', 'wta', 'grand slam', 'wimbledon'] },
  { emoji: '⛳', label: 'Golf', keywords: ['golf', 'pga', 'masters', 'ryder cup'] },
  { emoji: '🏉', label: 'Rugby', keywords: ['rugby', 'rugby union', 'rugby league', 'sevens', 'six nations'] },
  { emoji: '🏒', label: 'Ice hockey', keywords: ['hockey', 'ice hockey', 'nhl'] },
  { emoji: '🏑', label: 'Field hockey', keywords: ['field hockey', 'hockey'] },
  { emoji: '🏐', label: 'Volleyball / Netball', keywords: ['volleyball', 'netball', 'beach volleyball'] },
  { emoji: '⚾', label: 'Baseball', keywords: ['baseball', 'mlb'] },
  { emoji: '🥎', label: 'Softball', keywords: ['softball'] },
  { emoji: '🏓', label: 'Table tennis', keywords: ['table tennis', 'ping pong'] },
  { emoji: '🏸', label: 'Badminton', keywords: ['badminton', 'shuttlecock'] },
  { emoji: '🏎️', label: 'Motorsport', keywords: ['motorsport', 'formula', 'formula 1', 'f1', 'racing', 'nascar', 'indycar', 'rally', 'le mans', 'wec'] },
  { emoji: '🏍️', label: 'Motorcycle racing', keywords: ['motogp', 'motorcycle', 'superbike', 'speedway', 'motocross'] },
  { emoji: '🚴', label: 'Cycling', keywords: ['cycling', 'tour de france', 'bike', 'velodrome', 'giro'] },
  { emoji: '🚵', label: 'Mountain biking', keywords: ['mountain bike', 'mountain biking', 'bmx'] },
  { emoji: '🏃', label: 'Athletics / Running', keywords: ['athletics', 'running', 'marathon', 'track', 'track and field', 'sprint'] },
  { emoji: '🏊', label: 'Swimming', keywords: ['swimming', 'aquatics', 'diving'] },
  { emoji: '🤽', label: 'Water polo', keywords: ['water polo'] },
  { emoji: '🚣', label: 'Rowing / Canoeing', keywords: ['rowing', 'canoe', 'canoeing', 'kayak', 'kayaking'] },
  { emoji: '🏄', label: 'Surfing', keywords: ['surfing', 'surf'] },
  { emoji: '⛵', label: 'Sailing', keywords: ['sailing', 'yachting', 'regatta', "america's cup"] },
  { emoji: '🥊', label: 'Boxing', keywords: ['boxing', 'kickboxing'] },
  { emoji: '🥋', label: 'Martial arts', keywords: ['martial arts', 'mma', 'ufc', 'judo', 'karate', 'taekwondo', 'jiu jitsu'] },
  { emoji: '🤼', label: 'Wrestling / Kabaddi', keywords: ['wrestling', 'kabaddi', 'kabadi', 'kabady', 'sumo', 'grappling', 'pro kabaddi'] },
  { emoji: '🤺', label: 'Fencing', keywords: ['fencing'] },
  { emoji: '🏋️', label: 'Weightlifting', keywords: ['weightlifting', 'powerlifting', 'strongman'] },
  { emoji: '🤸', label: 'Gymnastics', keywords: ['gymnastics', 'trampoline'] },
  { emoji: '⛷️', label: 'Skiing', keywords: ['skiing', 'ski', 'alpine', 'biathlon'] },
  { emoji: '🏂', label: 'Snowboarding', keywords: ['snowboarding', 'snowboard'] },
  { emoji: '⛸️', label: 'Skating', keywords: ['skating', 'figure skating', 'speed skating'] },
  { emoji: '🥌', label: 'Curling', keywords: ['curling'] },
  { emoji: '🏇', label: 'Horse racing / Equestrian', keywords: ['horse racing', 'equestrian', 'derby', 'polo', 'show jumping'] },
  { emoji: '🏹', label: 'Archery', keywords: ['archery'] },
  { emoji: '🎯', label: 'Darts / Shooting', keywords: ['darts', 'shooting'] },
  { emoji: '🎱', label: 'Snooker / Pool', keywords: ['snooker', 'pool', 'billiards'] },
  { emoji: '🎳', label: 'Bowling', keywords: ['bowling', 'tenpin'] },
  { emoji: '♟️', label: 'Chess', keywords: ['chess'] },
  { emoji: '🎮', label: 'Esports', keywords: ['esports', 'e-sports', 'gaming', 'video games'] },
  { emoji: '🛹', label: 'Skateboarding', keywords: ['skateboarding', 'skateboard'] },
  { emoji: '🧗', label: 'Climbing', keywords: ['climbing', 'bouldering'] },
  { emoji: '🏆', label: 'Multi-sport / General', keywords: ['olympics', 'olympic', 'commonwealth games', 'asian games', 'multi-sport', 'general'] },
  { emoji: '🏅', label: 'Medal (generic)', keywords: [] },
];

const BY_EMOJI = new Map(SPORT_ICONS.map((o) => [o.emoji, o]));
export const isSportIcon = (value: unknown): value is string => typeof value === 'string' && BY_EMOJI.has(value);

const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, ' ').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Edit distance, for small typos ("kabady" -> "kabaddi"). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const cur = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  }
  return row[b.length];
}

/** Icons that fit a sport's name/slug, best first (empty when nothing fits). */
export function suggestSportIcons(name: string, slug = '', limit = 6): SportIconOption[] {
  const text = norm(`${name} ${slug}`);
  if (!text) return [];
  const words = new Set(text.split(' '));
  const scored = SPORT_ICONS.map((o, index) => {
    let score = 0;
    for (const k of o.keywords) {
      if (norm(name) === k) score = Math.max(score, 100);
      else if (` ${text} `.includes(` ${k} `)) score = Math.max(score, 50 + k.length);
      // Partial words and typos are compared with single-word keywords only
      // ("test" must not match "test match").
      else if (k.length >= 5 && !k.includes(' ') && [...words].some((w) => w.length >= 4 && (k.startsWith(w) || w.startsWith(k)))) score = Math.max(score, 30);
      else if (k.length >= 5 && !k.includes(' ')) {
        const d = Math.min(...[...words].filter((w) => w.length >= 5).map((w) => distance(w, k)), 99);
        if (d <= 2) score = Math.max(score, 26 - 3 * d); // one typo outranks two
      }
    }
    return { o, score, index };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  // With a real name match, near-miss spellings of other sports are noise.
  const best = scored[0]?.score ?? 0;
  return scored.filter((x) => best < 50 || x.score >= 50).slice(0, limit).map((x) => x.o);
}

/** The icon to show: the chosen one, else the best suggestion, else a medal. */
export function resolveSportIcon(sport: { slug: string; name?: string; icon?: string | null }): string {
  if (isSportIcon(sport.icon)) return sport.icon;
  return suggestSportIcons(sport.name ?? sport.slug, sport.slug, 1)[0]?.emoji ?? '🏅';
}
