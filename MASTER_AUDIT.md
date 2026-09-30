# Sporting Spy O.2 — master audit record

This file preserves the findings supplied in the owner's Phase H + J implementation prompt. It is not a new full audit. The original complete master audit was not present in the repository or the supplied attachment. Consequently its requirement totals, individual status counts, exact P0 classification, owner-decision record and original limitations cannot be reproduced faithfully; none are invented here. `SPEC_GAP_REPORT.md` remains the unmodified historical spec comparison and must not be mistaken for an up-to-date master audit.

## Supplied baseline and findings

The owner states Phases A, B, C, D, D1, D1.1, E, F and G were completed. Preserve the existing Next.js/Express/Prisma architecture, RBAC, security, SEO, CMS and API patterns. Actual regression results are recorded separately in `PHASE_H_J_IMPLEMENTATION.md`.

| Item | Finding supplied by the owner | Assigned phase |
|---|---|---|
| Scheduling | Scheduled article editor has no proper date/time; schedule validation and full public publication flow need completion. | H.1 |
| Event/Edition | Save can overwrite manual SEO; quick facts, defending champions, qualification, participants and article references lack adequate editing controls. Inspect supported fields before changing schema. | H.2 |
| FAQ | No CMS-controlled public FAQ. Dedicated admin management and public canonical route required. | H.3 |
| Contact | Form reports success without storing/sending a message. Persist messages and provide an admin inbox. | H.4 |
| Settings | Site name, description, social image and Twitter handle are stored but public rendering uses hardcoded values. | H.5 |
| Articles API | Public GET /api/articles exposure; inspect consumers, then restrict without breaking internal functionality. | H.6 |
| Sidebar ads | Configured placements have no corresponding public sidebar. Disable unused placements without adding a sidebar. | H.7 |
| Homepage | Heading/title differs from established project specification. | H.8 |
| Sports | Configured sports with zero events disappear from the public sports directory. | H.9 |
| Authors | Preserve current authorization during scheduling work; full author workflow belongs to Phase I. | H.10 / I |
| Production | Repository readiness requires configuration, safe migrations, backup/restore documentation, persistent object storage, deployment instructions, environment separation, observability, default-password protection and retained security controls. | J.1–J.9 |

## Owner decisions and roadmap supplied with this task

- H and J are independent workstreams and may proceed in parallel.
- Contact submissions should be database-backed with an admin inbox; do not claim email delivery without a configured provider.
- No hardcoded FAQ content, fake events, unnecessary frameworks or unrelated redesign.
- No database resets, drops, production db push or destructive startup migrations. Only genuinely required additive changes.
- Preserve the existing backup drill; do not claim off-site backups/PITR or deployed infrastructure without provider configuration.
- Do not change passwords automatically or print passwords. Operators must replace default credentials explicitly.
- Continue with Phase I author permissions after H/J. M search redesign, K scaling, N migration, L analytics expansion and O general polish remain outside this task unless a direct dependency.

## Source limitation

Exact original audit counts, P0 blocker labels and any decisions outside the supplied prompt remain unavailable. Recovering the original master audit would allow this record to include those details without reconstructing or fabricating them. Implementation completion and external provider/owner requirements are distinguished in the implementation report and deployment runbook.
