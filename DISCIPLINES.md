# Sport groups

**Terminology.** People see the word **Group** (CMS labels, public pages,
messages, audit log). In the code and the database a group is still called a
*discipline*: the `Discipline` model and table, the `disciplineSlug` field,
`/api/disciplines`, `server/disciplines.ts` and this file's name. They were
left as they are so that no table, column, API contract or URL changes for
the sake of a word.

**Two levels only: Sport → Group.**

```
Athletics                 Cycling
├── Running               ├── Road Cycling
├── Jumping               ├── Track Cycling
└── Throwing              └── Mountain Biking
```

- Every group belongs directly to one sport.
- A group cannot contain another group. There is no parent-group field, no
  nested route and no third level, in the schema, the API, the CMS or the
  public site. This is not a general taxonomy system.
- A sport stays a first-class sport with its own page; a group is never a
  sport and never appears in the global navigation.
- An event or article has at most one group, of its own sport.


A **group** is a named subdivision of one sport (Athletics → Running). It
is a classification beside the content hierarchy, not a level in it:

```
Sport ──< Group                   unique slug within its sport (model: Discipline)
  │           ┆ optional
  ├──< Event ─┘                   required sport, at most one group of that sport
  │      └──< Event Edition       no field of its own; follows its event
  └──< Article ┄┄ optional        required sport, at most one group of that sport
```

`Sport → Event → Event Edition → Article` is unchanged. A sport with no
groups behaves exactly as before. Nothing is assigned automatically.

## Status

| Part | State |
| --- | --- |
| Data model, migration `20261016090000_sport_disciplines` | Done. Applied to local databases only. |
| API, validation, slug collision guard | Done. |
| CMS screens (manage groups, choose one on an event or article) | Done. |
| Public landing pages `/{sport}/{discipline}/` | Done (local). |
| Converting an existing sport into a group | Proposal only (local file, see "Proposals"). |

## Data model

`Discipline` (`prisma/schema.prisma`): `id`, `sportSlug`, `slug`, `name`,
`description`, `order`, `isVisible`, `isActive`, `seo`, `createdAt`,
`updatedAt`. Unique on `(sportSlug, slug)`, so two sports may both have a
`sprint`.

- **Hidden** (`isVisible: false`): no public page or label.
- **Retired** (`isActive: false`): keeps the events and articles it already
  has, but cannot be given to more content.

`SportEvent.disciplineSlug` and `Article.disciplineSlug` are nullable. Each
has a composite foreign key `(sportSlug, disciplineSlug) →
Group(sportSlug, slug)`, `ON DELETE RESTRICT ON UPDATE CASCADE`, the same
natural-key convention as editions → events. The database therefore refuses

- a group of another sport on an event or article,
- deleting a group that is in use, and
- deleting a sport that still has groups,

and it carries a group rename, or a sport rename, into every row that
uses it. A `NULL` group is not checked, so unclassified rows are valid.

Limits of the database rule: it does not know about retirement, and it does
not relate an article's group to its event's. Both are API rules.

### An article inside an event

The event is the single source for everything inside it.

- An article attached to an event that has a group **follows the event**.
  Its own field stays empty (the usual case) or names the same group; a
  different one is refused.
- An article without an event, or inside an event that has no group (a
  championship across several groups), chooses freely.
- An event cannot be given a group while one of its articles names a
  different one. Nothing is overwritten automatically: the request is refused
  with the number of articles to change first.

The group of an article for listings is therefore: its own, else its
event's, else none.

## API

All routes sit behind the existing session, CSRF and CORS middleware.

| Route | Roles | Notes |
| --- | --- | --- |
| `GET /api/disciplines[?sport=slug]` | Admin, Editor, Author | Also in `GET /api/cms/data` as `disciplines`. |
| `POST /api/disciplines` | Admin | `sportSlug`, `slug`, `name`; optional `description`, `order`, `isVisible`, `isActive`, `seo`. |
| `PUT /api/disciplines/:id` | Admin | Everything except `sportSlug`: a group never changes sport. SEO fields are merged. |
| `DELETE /api/disciplines/:id` | Admin | Refused (409) while an event or article uses it; retire it instead. |

Reordering is a change of `order`; hiding is `isVisible: false`; retiring is
`isActive: false` and reactivating sets it back.

Events (`POST`/`PUT /api/events`) and articles (`POST`/`PUT /api/articles`)
accept an optional `disciplineSlug`. Leaving it out changes nothing; `null`
clears it. It must be an active group of the record's own sport; a
retired one stays on records that already have it. Moving an event or article
to another sport needs the group cleared or replaced in the same request
(it is never carried over, even when the other sport has the same slug), and
an event does not move while its articles keep groups of the old sport.

Every create, update and delete of a group is written to the audit log
(entity type `Sport`, entity id = the group id). Assignments appear in
the existing event and article audit entries.

## CMS

- **Sports → edit a sport → Groups.** Admins add (slug suggested from
  the name), rename, reorder, hide/show, retire/reactivate and delete. Each
  action is saved at once and audited; it is not part of the sport's own Save.
  The list shows how many events and articles use each group, and Delete
  is disabled while any do. Editors and Authors see the list only. A
  group never appears in the sports list or the site navigation.
- **Events → event form → Group (optional).** Shown when the event's
  sport has groups. Offers "None" and the active groups of that
  sport, plus the event's own one if it was retired since. Changing the sport
  clears the choice.
- **Articles → the article editor → Group (optional).** Same options.
  Inside an event that has a group the selector is locked to it
  ("Follows the selected event"). Changing the sport clears the choice.
- A save sends the field only when it changed, so opening and saving existing
  content never touches a stored group, and content of sports without
  groups never sees the field.

## Group editor

**Edit** in a sport's Groups list opens the group's full editor
(`src/components/admin/GroupEditor.tsx`). It replaces the earlier Rename
action and uses the Sport form's own fields, components and rules. Each
setting is stored on the group (`Discipline`), never on the sport.

| Sport form field | Group editor | Stored as |
| --- | --- | --- |
| Sport name, URL slug | Group name, URL slug (unique within the sport; a change writes a 301) | `name`, `slug` |
| Icon picker | Same picker; optional ("Add an icon" / "Remove icon") | `icon` |
| Tagline / focus | Same | `tagline` |
| Description | Same | `description` |
| Display order, visibility | Same (also the arrows and Hide/Show in the list) | `order`, `isVisible` |
| Sport image (Media Library) | Group image, same picker and upload; must be a Media Library item | `heroImage`, `heroMediaId` |
| Featured events (up to 12, ordered) | Same, limited to events that belong to this group | `featuredEventIds` |
| SEO title, keywords, meta description, social title/description/image | Same component, defaults and length hints; canonical and noindex keys are preserved | `seo` |

Left out on purpose:

| Sport setting | Why not on a group |
| --- | --- |
| Event configuration (custom event fields, terminology) | Defines the event form of a whole sport; events of a group are events of that sport |
| FAQPage structured data | FAQ entries (`FaqEntry`) belong to a sport, event, edition or article. A group context would change that table's single-context rule and the FAQ screens |
| Colour theme | The Sport form does not edit it either |
| Retire / reactivate | An action in the Groups list (`isActive`), not a field |
| Groups of its own | Two levels only |

Saving sends only the fields that changed. Image alt text, credit and rights
stay on the Media Library item, as for sports. A Media Library image used by
a group is listed as in use and cannot be deleted.

On the group's public page these settings are the group's own: its tagline,
header image, featured events and SEO/social metadata. Nothing falls back to
the sport's values; a group without an image has no header image, and without
a social image the site default applies.

### Unsaved changes

Opening a group's editor puts the sport form aside without discarding it:
what was typed there is still there on return, and the group editor says so
("Save Group does not save them"). Save Group writes only to the group. With
unsaved sport or group edits, the browser asks before the tab is closed or
reloaded, the CMS asks before another desk is opened, and Cancel / Back ask
before discarding.

## Public navigation

The Sports menu in the site header is a two-level tree: each visible sport in
display order, and nested under it the groups a visitor can browse (visible,
active, in display order, with their icon). A sport without groups is a plain
link. Hidden or retired groups and hidden sports never appear. The data comes
with the existing navigation query (`getNavSports`), so it shares its cache
entry and is refreshed by any CMS write.

- **Desktop:** hovering Sports with a mouse, clicking it, or Enter / Arrow
  Down on the keyboard opens the panel; Tab and the arrow keys walk the links;
  Escape closes it and returns focus to the button. It also closes on an
  outside click or navigation (not when the pointer merely leaves).
- **Phone:** the menu lists the first eight sports as before, plus any later
  sport that has groups; a sport with groups has an arrow that expands them.

Groups are never top-level items, and nothing nests under a group.

## One address space under a sport

`/{sport}/{segment}/` already serves an event, or else an event-less article
(`src/app/[sport]/[event]/page.tsx`). A group page will be a third kind
of page at that address, so from the first group on, `server/urlStability.ts`
refuses a slug that another of the three already uses in that sport:

| Creating or renaming | Refused when the slug in that sport belongs to |
| --- | --- |
| a group (`assertDisciplineSlugFree`) | an event, or an event-less article |
| an event (`assertEventSlugFree`) | an event-less article, or a group |
| an event-less article (`assertArticleSlugFree`) | an event, or a group |

Articles inside an edition (`/{sport}/{event}/{year}/{slug}/`) are four
segments deep and are not affected. Sport slugs keep their own top-level
rules (`RESERVED_SPORT_SLUGS`, CMS pages).

## Landing pages

The parent sport and every group have a full landing page.

- `/athletics/` is the sport page and shows everything in the sport: all
  groups and unclassified content. Nothing about it changed except a row
  of links to its groups.
- `/athletics/running/` is the same page (`src/views/SportPage.tsx`, the same
  queries in `server/services/public/content.ts` with one extra filter),
  scoped to one group.

### Route resolution

`src/app/[sport]/[event]/page.tsx` resolves the second segment in this order:

1. an **event** of that sport (as before),
2. an **event-less article** of that sport (as before),
3. a **group** of that sport.

A group is tried only when neither of the first two exists, so its page
can never take over a URL that showed an event or an article. The write
guards above also keep the three slug sets disjoint, so for valid data at
most one lookup finds anything. The test suite forces a clash past the API
and checks that the event and the article still win.

### What the page shows

| Section | Group page |
| --- | --- |
| Breadcrumb | Home › Sport › Group (with BreadcrumbList data) |
| Header | The group's own name, tagline, description and image; a link to the sport. Never the sport's image or tagline |
| Links to the sport and its other groups | Yes ("All {Sport}", then each visible active group) |
| Featured events | The group's own chosen list, else its events marked "featured" |
| Upcoming, all events; recent editions | Only events that name the group, and their editions |
| Latest articles, guides | Articles that name the group, plus articles of its events that name none |
| "All N articles" | `/latest/?sport=…&discipline=…` |
| FAQ | Not shown (FAQ entries have no group context) |

Only published articles of visible sports and visible events are ever
listed; drafts, review-required drafts, previews and archived articles never
appear (the same `publishedArticleWhere` as every public page).

### Visibility and indexing

One rule, `disciplineIndexability` in `src/lib/indexability.ts`, is used by
the page metadata, the sitemap and the SEO scanner.

| State | Page | Index / sitemap | Linked from the sport page |
| --- | --- | --- | --- |
| Sport hidden | 404 | no | n/a |
| Group hidden | 404 | no | no |
| Group retired (still visible) | 200 | `noindex`, not in the sitemap | no |
| Visible, active, no published content | 200 with the empty state | `noindex`, not in the sitemap | yes |
| Visible, active, with content | 200 | indexable, in `/sitemaps/pages.xml` | yes |

A retired group keeps a reachable page so existing links do not break;
use **Hide** to remove a page. Groups never appear in the global
navigation.

### Metadata

Title `{Discipline} – {Sport} Events, Guides & Articles | SportingSpy`,
description from the group's own description (a plain factual fallback
when it is empty), canonical `/{sport}/{discipline}/`, and the group's
`seo` overrides (title, description, canonical, noindex) exactly as for sports.

### Renames and redirects

- A group slug change moves its page: old URL → 301 → new URL through
  the existing `redirectChangedUrls`, in the same transaction; existing rules
  that pointed at the old URL are re-targeted and no chain or loop is left.
- A sport slug change redirects every group page with the rest of the
  sport (`snapshotUrls` now includes them).
- When a group is created at, or renamed to, an address that an old
  redirect still used, that rule is retired so the page is reachable (the
  same `releasePath` articles and CMS pages use).
- A manual redirect cannot use a live group page as its source.
- A rename onto an event's or event-less article's slug is refused (409) and
  changes nothing.

### Latest-articles filter

`/latest/?sport={sport}&discipline={discipline}` lists that group's
published articles (`noindex`, like every filtered listing). A hidden,
retired or unknown group is ignored rather than an error.

### Not built

- Event calendar (`/events/`) and site search have no group filter; the
  group page links to the sport's calendar and search.
- Group pages have no FAQ section. `FaqEntry` allows one context per entry
  through the database rule `FaqEntry_single_context` (event, article,
  edition or sport). A group context needs that rule dropped and re-created,
  which the guarded migration command classifies as a destructive statement,
  plus a new context in the FAQ API, the FAQ screen and the quality checks.
  That is a separate, reviewed change, not part of this release.
- The generated full-text search columns do not contain group names.

## Defaults chosen, and what is still the client's decision

Chosen (implemented or documented above; change on request):

1. An article inside an event follows the event's group.
2. A group page carries the sport page's sections with the group's own
   tagline, image and featured events; it has no FAQ section.
3. A visible but empty group returns a valid, `noindex` page.
4. A hidden group is a 404; a retired one stays reachable but is
   `noindex`, out of the sitemap and not linked from the sport page.
5. Every existing sport stays a sport. Nothing is converted unless the client
   approves it explicitly (see "Proposals").

Still open:

1. The approved list of groups per sport. None exists in production.
2. Whether group pages need their own FAQ (a change to the FAQ model and
   screens, not just a new field).
3. Whether groups appear in a sport sub-menu, or only on the sport page.
4. Who reviews the proposed mapping of existing content, and when.

## Proposals

The conversion proposal and the per-record mapping proposal for existing
content are review documents, kept locally and not committed:
`migration-inventory/discipline-proposals.md`. Nothing in them has been
applied.

## Releasing

Two additive migrations are pending for the hosted database, applied in
order by the same command:

1. `20261016090000_sport_disciplines`: one table, two nullable columns, four
   indexes, three foreign keys.
2. `20261017090000_group_landing_fields`: five columns on that table
   (`tagline`, `icon`, `heroImage`, `heroMediaId`, `featuredEventIds`) with
   defaults or NULL, one index, one foreign key to the Media Library.

No existing table loses or changes a column, and no row is rewritten. Release order: verified backup (`npm run db:backup:live`)
→ `npm run db:migrate:live` (plan, then apply with the confirmation phrase) →
deploy the code. Code that does not know the columns keeps working, so the
migration can go first. Rollback before any group exists: drop the two
columns and the table. Afterwards: leave the data, hide the feature.

Tests: `npm run local -- test:disciplines` (API and database rules),
`npm run local -- test:disciplines-browser` (the three CMS screens in Chrome),
`npm run local -- test:discipline-pages` (public pages, collisions, sitemap, redirects),
`npm run local -- test:nav-groups-browser` (the Sports → Groups menu in Chrome),
`npm run local -- test:live-migration` (migration rehearsal).
