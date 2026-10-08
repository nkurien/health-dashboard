# Health Journal — Cloudflare Worker

One Cloudflare Worker serves everything on a single domain:

- the static frontend (`../frontend`, built with `next build` → `../frontend/out`)
- the API (`/api/*`, `/auth/*`) — a TypeScript port of the old Python backend
- a **D1** database holding the two users' Google tokens (AES-GCM encrypted)

Access is gated by **Cloudflare Access** (login with your emails), and the Worker
verifies the signed Access token itself — if Access isn't configured it refuses to
serve anything (`REQUIRE_ACCESS`, fail closed).

## Local development

```bash
cd worker
cp .dev.vars.example .dev.vars        # fill in Google client id/secret; APP_SECRET: openssl rand -base64 32
npx wrangler d1 migrations apply health-journal --local
npm run dev                            # Worker + API on http://localhost:8787
cd ../frontend && npm run dev          # optional: hot-reloading UI on :3000 (talks to :8787)
```

For the local Google login, add `http://localhost:8787/auth/callback` to the OAuth client's
**Authorized redirect URIs** in Google Cloud.

```bash
npm test          # unit tests (readiness, crypto, Access check, Google parsing)
npm run typecheck
```

## Deploying (first time)

Replace `health.kajalandnathan.com` with your hostname (its domain must be on Cloudflare DNS).

1. **Log in:** `npx wrangler login`
2. **Create the database** and copy the `database_id` it prints into `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create health-journal
   npx wrangler d1 migrations apply health-journal --remote
   ```
3. **Cloudflare Access** (Zero Trust dashboard → Access → Applications → *Add* → Self-hosted):
   - Application domain: `health.kajalandnathan.com`
   - Policy: **Allow** → Emails → the two addresses that may use the dashboard
   - Copy the **Application Audience (AUD) tag** and your **team domain** (`https://<team>.cloudflareaccess.com`)
4. **Fill in `wrangler.jsonc`:** `PUBLIC_URL` (`https://health.kajalandnathan.com`), `ACCESS_TEAM_DOMAIN`,
   `ACCESS_AUD`, and add the route:
   ```jsonc
   "routes": [{ "pattern": "health.kajalandnathan.com", "custom_domain": true }]
   ```
5. **Secrets** (prompted interactively; never put these in a file you commit):
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put APP_SECRET        # openssl rand -base64 32 — don't lose it: it decrypts stored tokens
   ```
6. **Google Cloud** → OAuth client → add `https://health.kajalandnathan.com/auth/callback` to Authorized redirect URIs.
7. **Deploy:** `npm run deploy` (builds the frontend, then `wrangler deploy`).
8. Open the site, sign in through Access, then **Connect** each person's Google account.

## Notes

- `workers.dev` and preview URLs are disabled; the only way in is the custom domain behind Access.
- If `APP_SECRET` changes, stored tokens can't be decrypted: just click Connect again.
- While the Google OAuth app is in *Testing* mode, Google expires refresh tokens after ~7 days (reconnect), unless you publish it to *In production*.
- `TIMEZONE` in `wrangler.jsonc` decides what "today" and "last night" mean. It's set to `Europe/London`: change it if that's wrong.
- The 15-minute response cache uses the Workers Cache API (per data centre); *Refresh* clears it.
