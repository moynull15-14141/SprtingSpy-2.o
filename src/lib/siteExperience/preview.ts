/**
 * Draft preview of the Site Experience (PHASE F.1). An editor turns preview
 * on from the CMS; the server sets this HttpOnly cookie. Public pages show
 * draft documents only when the cookie is present AND the request carries an
 * active Admin/Editor session, so the cookie alone reveals nothing.
 */
export const SITE_PREVIEW_COOKIE = 'sportingspy_site_preview';
