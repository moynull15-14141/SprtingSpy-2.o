import type { Request, Response, NextFunction } from 'express';

// Public JSON is never a Prisma nested-write instruction. These are the
// existing editor fields, not relation names or immutable primary keys.
const fields: Record<string, string[]> = {
  articles: ['slug', 'title', 'subtitle', 'sportSlug', 'eventSlug', 'editionYear', 'articleType', 'excerpt', 'content', 'body', 'featuredImage', 'featuredMediaId', 'authorId', 'publishedAt', 'updatedAt', 'scheduledFor', 'status', 'readingTimeMinutes', 'featured', 'tables', 'references', 'seo', 'faqSchemaEnabled'],
  sports: ['slug', 'name', 'tagline', 'description', 'order', 'isVisible', 'featuredEventIds', 'colorTheme', 'heroImage', 'seo', 'icon', 'faqSchemaEnabled'],
  events: ['sportSlug', 'slug', 'name', 'shortName', 'description', 'descriptionBody', 'history', 'frequency', 'defaultVenue', 'defaultLocation', 'currentEditionYear', 'allEditionYears', 'featured', 'isVisible', 'featuredImage', 'officialSourceUrl', 'eventType', 'seo', 'sportSpecificValues', 'alternativeNames', 'faqSchemaEnabled'],
  editions: ['eventSlug', 'sportSlug', 'year', 'title', 'startDate', 'endDate', 'venue', 'location', 'status', 'quickFacts', 'prizeMoneyTotal', 'defendingChampions', 'qualificationInfo', 'participantsCount', 'officialSourceUrl', 'description', 'descriptionBody', 'featuredImage', 'seo', 'faqSchemaEnabled'],
  authors: ['slug', 'name', 'roleTitle', 'bio', 'avatar', 'twitter', 'email', 'articleCount', 'userId'],
  comments: ['status'],
  redirects: ['sourceUrl', 'targetUrl', 'statusCode', 'isActive', 'notes'],
  media: ['title', 'url', 'altText', 'caption', 'credit', 'source', 'license', 'creationType', 'aiTool', 'humanEditing', 'copyrightReview'],
  ads: ['name', 'placementDescription', 'enabled', 'sponsorName', 'bannerText', 'linkUrl', 'dimensions', 'provider', 'providerSlotId', 'creativeId', 'creativeAlt', 'creativeFit'],
};

export function rejectNestedCmsWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'PUT') return next();
  const match = req.path.match(/^\/api\/([^/]+)\/[^/]+\/?$/i);
  const allowed = match && fields[match[1].toLowerCase()];
  if (!allowed) return next();
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !allowed.includes(key))) {
    return res.status(400).json({ error: 'Unsupported update field.' });
  }
  next();
}
