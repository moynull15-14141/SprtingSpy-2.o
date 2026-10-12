/**
 * WordPress export (WXR) reader for the legacy-content migration.
 * Pure parsing: no database, no network, no writes. Author e-mail addresses
 * and logins' private fields are never read; only the login (to join posts to
 * authors) and the public display name are kept.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(parseInt(e[1].toLowerCase() === 'x' ? e.slice(2) : e.slice(1), e[1].toLowerCase() === 'x' ? 16 : 10)) : ENTITIES[e] ?? m));
const cdata = (s: string) => s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
const tag = (xml: string, name: string) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? cdata(m[1].trim()) : ''; };
const text = (xml: string, name: string) => decodeEntities(tag(xml, name)).trim();

export interface WxrTerm { slug: string; name: string }
export interface WxrAuthor { login: string; displayName: string }
export interface WxrItem {
  id: string;
  type: string;
  status: string;
  title: string;
  slug: string;
  /** Path of the item's old public URL, e.g. "/wnfr-2025/". */
  path: string;
  dateGmt: string;
  modifiedGmt: string;
  creator: string;
  categories: WxrTerm[];
  tags: WxrTerm[];
  excerpt: string;
  body: string;
  meta: Map<string, string>;
  oldSlugs: string[];
  /** Attachments only: the file path below the site root, e.g. "wp-content/uploads/2024/11/a.jpg". */
  filePath: string;
}
export interface Wxr { site: string; authors: WxrAuthor[]; categories: WxrTerm[]; items: WxrItem[] }

const pathOf = (url: string) => { try { return decodeURIComponent(new URL(url).pathname); } catch { return ''; } };

export function parseWxr(xml: string): Wxr {
  const first = xml.indexOf('<item>');
  const channel = first === -1 ? xml : xml.slice(0, first);
  const terms = (item: string, domain: string): WxrTerm[] =>
    [...item.matchAll(new RegExp(`<category domain="${domain}" nicename="([^"]+)">([\\s\\S]*?)</category>`, 'g'))].map((m) => ({ slug: decodeURIComponent(m[1]), name: decodeEntities(cdata(m[2].trim())) }));
  const items = first === -1 ? [] : xml.split('<item>').slice(1).map((raw): WxrItem => {
    const x = raw.slice(0, raw.indexOf('</item>'));
    const meta = new Map<string, string>();
    const oldSlugs: string[] = [];
    for (const m of x.matchAll(/<wp:postmeta>\s*<wp:meta_key>([\s\S]*?)<\/wp:meta_key>\s*<wp:meta_value>([\s\S]*?)<\/wp:meta_value>\s*<\/wp:postmeta>/g)) {
      const key = cdata(m[1].trim());
      const value = cdata(m[2].trim());
      if (key === '_wp_old_slug') oldSlugs.push(value);
      else if (!meta.has(key)) meta.set(key, value);
    }
    return {
      id: tag(x, 'wp:post_id'), type: tag(x, 'wp:post_type'), status: tag(x, 'wp:status'), title: text(x, 'title'), slug: tag(x, 'wp:post_name'),
      path: pathOf(text(x, 'link')), dateGmt: tag(x, 'wp:post_date_gmt'), modifiedGmt: tag(x, 'wp:post_modified_gmt'), creator: tag(x, 'dc:creator'),
      categories: terms(x, 'category'), tags: terms(x, 'post_tag'), excerpt: tag(x, 'excerpt:encoded'), body: tag(x, 'content:encoded'), meta, oldSlugs,
      filePath: pathOf(text(x, 'wp:attachment_url')).replace(/^\/+/, ''),
    };
  });
  return {
    site: tag(channel, 'wp:base_site_url'),
    authors: [...channel.matchAll(/<wp:author>([\s\S]*?)<\/wp:author>/g)].map((m) => ({ login: tag(m[1], 'wp:author_login'), displayName: text(m[1], 'wp:author_display_name') })),
    categories: [...channel.matchAll(/<wp:category>([\s\S]*?)<\/wp:category>/g)].map((m) => ({ slug: tag(m[1], 'wp:category_nicename'), name: text(m[1], 'wp:cat_name') })),
    items,
  };
}

/** The theme's "video post" link (PHP-serialised post meta), if one was set. */
export function videoLinkOf(item: WxrItem): string {
  const m = (item.meta.get('papermag_post_format_meta') ?? '').match(/s:10:"video_link";s:\d+:"([^"]*)"/);
  return m ? decodeEntities(m[1]).trim() : '';
}
