-- PHASE PAGES — CMS-managed informational pages. Additive only: one new
-- table, one new audit entity type and five seeded rows. No existing table,
-- column or row is modified or removed.
--
-- The five rows are the site's existing pages (About, Contact, Privacy Policy,
-- Terms, DMCA) with the text they showed before this release, so their URLs
-- and visible content are unchanged. ON CONFLICT DO NOTHING keeps a re-run
-- safe. Generated from the pre-release page source and checked with the
-- rich-text allow-list (validateRichDoc).

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'Page';

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortTitle" TEXT,
    "summary" TEXT,
    "body" JSONB NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "template" TEXT NOT NULL DEFAULT 'standard',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "noIndex" BOOLEAN NOT NULL DEFAULT false,
    "ogMediaId" TEXT,
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");

-- CreateIndex
CREATE INDEX "Page_status_idx" ON "Page"("status");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_ogMediaId_fkey" FOREIGN KEY ("ogMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Status and template are closed sets (enforced by the API; also here).
ALTER TABLE "Page" ADD CONSTRAINT "Page_status_check" CHECK ("status" IN ('draft', 'published'));
ALTER TABLE "Page" ADD CONSTRAINT "Page_template_check" CHECK ("template" IN ('standard', 'contact', 'privacy'));

-- Seed: the existing system pages.
INSERT INTO "Page" ("id", "slug", "title", "shortTitle", "summary", "body", "content", "status", "template", "system", "seoTitle", "seoDescription", "noIndex", "ogMediaId", "mediaIds", "createdAt", "updatedAt", "publishedAt", "createdBy", "updatedBy") VALUES
  ('page-system-about', 'about', 'About SportingSpy', NULL, 'The Authoritative Multi-Sport Intelligence & Editorial Platform', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Founded in 2026, "},{"type":"text","text":"SportingSpy","marks":[{"type":"bold"}]},{"type":"text","text":" was created to restore structured clarity, archival depth, and regulatory rigor to sports journalism. Modern sports web platforms have frequently collapsed into automated live-score widgets, clickbait rumor mills, and speculative betting clutter."}]},{"type":"heading","attrs":{"level":2,"textAlign":"left"},"content":[{"type":"text","text":"Our Conceptual Hierarchy"}]},{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Every piece of sports intelligence on SportingSpy adheres to a rigorous architectural model:"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"SPORT → PERMANENT EVENT → EVENT EDITION → ARTICLE"}]},{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"We distinguish between permanent sporting institutions (such as the "},{"type":"text","text":"French Open","marks":[{"type":"italic"}]},{"type":"text","text":" or "},{"type":"text","text":"The Masters","marks":[{"type":"italic"}]},{"type":"text","text":") and their yearly editions (such as the "},{"type":"text","text":"2027 French Open","marks":[{"type":"italic"}]},{"type":"text","text":"). This structure preserves historical continuity while providing verified, session-by-session logistical guidance for fans and journalists."}]},{"type":"heading","attrs":{"level":2,"textAlign":"left"},"content":[{"type":"text","text":"Editorial Independence"}]},{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"All schedules, prize money distributions, and rule interpretations are manually verified against primary regulatory bodies (ITF, FIA, UEFA, World Rugby, R&A/USGA). We do not deploy automated scrape bots to publish unchecked data."}]}]}'::jsonb, 'Founded in 2026, SportingSpy was created to restore structured clarity, archival depth, and regulatory rigor to sports journalism. Modern sports web platforms have frequently collapsed into automated live-score widgets, clickbait rumor mills, and speculative betting clutter.

Our Conceptual Hierarchy

Every piece of sports intelligence on SportingSpy adheres to a rigorous architectural model:

We distinguish between permanent sporting institutions (such as the French Open or The Masters) and their yearly editions (such as the 2027 French Open). This structure preserves historical continuity while providing verified, session-by-session logistical guidance for fans and journalists.

Editorial Independence

All schedules, prize money distributions, and rule interpretations are manually verified against primary regulatory bodies (ITF, FIA, UEFA, World Rugby, R&A/USGA). We do not deploy automated scrape bots to publish unchecked data.', 'published', 'standard', true, 'About SportingSpy – Multi-Sport Editorial Standards', 'The founding principles, editorial mission, and verification methodology of SportingSpy.com.', false, NULL, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system', 'system'),
  ('page-system-contact', 'contact', 'Contact Editorial Bureau', 'Contact', 'Direct inquiries for newsroom correspondents, fact-checking verifications, and regulatory sources.', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"left"}}]}'::jsonb, '', 'published', 'contact', true, 'Contact Editorial Desk | SportingSpy', 'Submit corrections, media inquiries, or tournament credentials to the SportingSpy editorial team.', false, NULL, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system', 'system'),
  ('page-system-privacy-policy', 'privacy-policy', 'Privacy Policy', NULL, 'Last revised: September 2026', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"This page explains what SportingSpy collects when you read the site, why, and the choices you have. It describes how the site is built and configured today."}]},{"type":"heading","attrs":{"level":2,"textAlign":"left"},"content":[{"type":"text","text":"What we collect"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Reading the site:","marks":[{"type":"bold"}]},{"type":"text","text":" you can read articles, browse and search without an account. We do not ask for personal details to read."}]}]},{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Technical requests:","marks":[{"type":"bold"}]},{"type":"text","text":" like any website, our server receives your IP address and browser information with each request. We use the IP address briefly, in memory, to limit abusive traffic (for example repeated sign-in or search attempts); it is not stored in our database."}]}]},{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Accounts:","marks":[{"type":"bold"}]},{"type":"text","text":" staff accounts (and reader accounts, when that feature is on) store a name, e-mail address, role and a securely hashed password. Passwords are never stored in readable form."}]}]},{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Searches:","marks":[{"type":"bold"}]},{"type":"text","text":" your search text is used to find results. To learn what readers look for, we keep a daily count per search: the search text, lower-cased and cut to 50 characters (anything that looks like an e-mail address or phone number is replaced), with the number of searches and of searches that found nothing. Nothing about who searched is stored with it. If analytics is active and you allowed it, the same cleaned text may also be reported (see Analytics)."}]}]},{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Contact form:","marks":[{"type":"bold"}]},{"type":"text","text":" if you send us a message, we store the name, e-mail address, subject and message you enter, and when it was sent, so the editorial team can read and answer it. We do not store your IP address or browser details with it, and the site does not send automatic e-mails."}]}]}]}]}'::jsonb, 'This page explains what SportingSpy collects when you read the site, why, and the choices you have. It describes how the site is built and configured today.

What we collect

Reading the site: you can read articles, browse and search without an account. We do not ask for personal details to read.

Technical requests: like any website, our server receives your IP address and browser information with each request. We use the IP address briefly, in memory, to limit abusive traffic (for example repeated sign-in or search attempts); it is not stored in our database.

Accounts: staff accounts (and reader accounts, when that feature is on) store a name, e-mail address, role and a securely hashed password. Passwords are never stored in readable form.

Searches: your search text is used to find results. To learn what readers look for, we keep a daily count per search: the search text, lower-cased and cut to 50 characters (anything that looks like an e-mail address or phone number is replaced), with the number of searches and of searches that found nothing. Nothing about who searched is stored with it. If analytics is active and you allowed it, the same cleaned text may also be reported (see Analytics).

Contact form: if you send us a message, we store the name, e-mail address, subject and message you enter, and when it was sent, so the editorial team can read and answer it. We do not store your IP address or browser details with it, and the site does not send automatic e-mails.', 'published', 'privacy', true, 'Privacy Policy | SportingSpy', 'What SportingSpy collects, why, the cookies and storage it uses, and how to change your privacy choices.', false, NULL, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system', 'system'),
  ('page-system-terms-and-conditions', 'terms-and-conditions', 'Terms of Service', NULL, 'Last Revised: September 2026', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"By accessing SportingSpy.com, you agree to these Terms of Service. All editorial commentary, analysis, tournament guides, and tabular data compilations are protected by copyright laws."}]},{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Users participating in editorial discussions agree not to post defamatory, commercial, or copyrighted content without authorization."}]}]}'::jsonb, 'By accessing SportingSpy.com, you agree to these Terms of Service. All editorial commentary, analysis, tournament guides, and tabular data compilations are protected by copyright laws.

Users participating in editorial discussions agree not to post defamatory, commercial, or copyrighted content without authorization.', 'published', 'standard', true, 'Terms of Service | SportingSpy', 'Terms of service and reader agreement for SportingSpy.com.', false, NULL, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system', 'system'),
  ('page-system-dmca', 'dmca', 'DMCA Copyright Policy', 'DMCA Policy', 'Notice and Takedown Procedure', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"SportingSpy complies with the Digital Millennium Copyright Act (17 U.S.C. § 512). If you believe your copyrighted work has been reproduced on SportingSpy in a manner constituting copyright infringement, please submit a written notification to our designated copyright bureau at "},{"type":"text","text":"dmca@sportingspy.com","marks":[{"type":"code"}]},{"type":"text","text":"."}]}]}'::jsonb, 'SportingSpy complies with the Digital Millennium Copyright Act (17 U.S.C. § 512). If you believe your copyrighted work has been reproduced on SportingSpy in a manner constituting copyright infringement, please submit a written notification to our designated copyright bureau at dmca@sportingspy.com.', 'published', 'standard', true, 'DMCA Copyright Policy | SportingSpy', 'DMCA and intellectual property notification process for SportingSpy.com.', false, NULL, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system', 'system')
ON CONFLICT ("slug") DO NOTHING;
