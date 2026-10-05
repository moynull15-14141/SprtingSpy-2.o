# Manual security actions (owner)

These steps can only be done by the owner, in provider dashboards or on the live hosting. This file contains **no secret values**. None of these actions has been performed or verified by the repository work. Tick each one off only after checking the result.

## A. Before Render staging goes live

| # | Action | Why | How to verify |
| --- | --- | --- | --- |
| A1 | **Rotate the Aiven `avnadmin` password** (Aiven console → service → Users → Reset password). Update `DATABASE_URL` in the local `.env` and in Render's environment. | The current password was pasted into a chat session and is stored in a local `.env`. | The old URL fails to connect; `/api/health/ready` on Render returns 200 with the new one. |
| A2 | **Create a separate application database user** in Aiven (not `avnadmin`) and use it in Render. Keep `avnadmin` for migrations and maintenance only. | Limits the damage if the app's credentials leak. | Render uses the new user; the app works. |
| A3 | **Rotate the Cloudflare R2 API token** (Cloudflare → R2 → Manage API tokens): create a new token with *Object Read & Write* on the `sportingspy` bucket only, update `.env` and Render, then delete the old token. | The current access key pair was pasted into a chat session. | `npm run test:r2-live` passes with the new token; the old token is gone from the dashboard. |
| A4 | **Generate a new `TOTP_ENCRYPTION_KEY`** (32+ random characters) for Render. Never reuse a development value. | It encrypts staff 2FA secrets. | Staff 2FA enrolment works on staging. |
| A5 | **Restrict Aiven network access**: in Aiven → service → *Allowed IP addresses*, allow only Render's outbound IPs (Render → service → Connect → Outbound) and your own workstation. | By default an Aiven service accepts connections from any address (TLS and a password are still required). | A connection from another network is refused. |
| A6 | **Keep the GitHub repository private**, and check that `.env`, `certs/`, `backups/`, `*.pem`, `*.sql` dumps and `storage/` are not in any commit (`git ls-files`). | The repository is the most likely place for a leak. | `git ls-files` shows only Prisma migration `.sql` files; GitHub shows "Private". |
| A7 | **Staff passwords on Aiven**: every active staff account has a real, unique password (`npm run users:set-password -- <email>`), and Admins enable 2FA. The seed accounts are deactivated, so production startup does not refuse to launch. | Startup refuses documented default passwords; weak passwords are the next risk. | Each staff member can log in; the Users screen shows 2FA on for Admins. |
| A8 | **Restrict staging access**: put an access gate in front of it (for example Cloudflare Access on a staging domain) if staging should not be public. Staging already sends `noindex`. | Staging contains real content and the CMS login page. | An outsider cannot reach `/admin/`, or only sees the login. |

## B. Old WordPress site (from the Phase N.1 security audit)

The old site is still live. Its backups on this workstation contain live secrets. Do these on the live hosting, in this order:

| # | Action | Priority |
| --- | --- | --- |
| B1 | **Re-issue the TLS certificate with a new private key** for sportingspy.com / www.sportingspy.com, install it, and revoke the old certificate. The backed-up key is the one in production. | MUST |
| B2 | **Change the WordPress database password** (cPanel → MySQL) and update the live `wp-config.php`. | MUST |
| B3 | **Replace all 8 WordPress auth keys and salts** in the live `wp-config.php` (logs everyone out). | MUST |
| B4 | **Revoke the Rank Math Google OAuth link**: disconnect in Rank Math and remove the app's access in the Google account. Reconnect only if still needed. | MUST |
| B5 | Change the passwords of the 3 WordPress staff accounts. | SHOULD |
| B6 | Change the `support@sportingspy.com` mailbox password. | SHOULD |
| B7 | Regenerate the MCP/AI plugin JWT secret, or remove the plugin if unused (MUST if active). | SHOULD |
| B8 | Regenerate the Elementor Pro licence key and the LiteSpeed/QUIC.cloud API key. | SHOULD |
| B9 | Change the cPanel account password. | SHOULD |
| B10 | Keep the old backups in one access-restricted folder outside the repository and any synced folder. Never upload or share them. Delete the local copies after cutover and a verified final archive. | MUST |

## C. Before production (www.sportingspy.com), not now

- Give R2 a custom media domain (e.g. `media.sportingspy.com`) instead of the `r2.dev` URL, then rebuild with the new `MEDIA_PUBLIC_BASE_URL`.
- Enable Aiven automated backups/PITR with alerts, and run one restore into a new database.
- Separate staging and production: a different database (or Aiven service), a different R2 bucket, and separate credentials.
- Get client approval for the legacy migration and the DNS switch. **The migration is ON HOLD until then.**

## D. Account data to correct in the CMS (not a code change)

- The secure Admin account's avatar is set to a Facebook *photo page* address, not an image file, so the browser blocks it (Content Security Policy) and initials are shown. Set it to a direct image URL from an allowed host, or leave it empty, in Account settings.
