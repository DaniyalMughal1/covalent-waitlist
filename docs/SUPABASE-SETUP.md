# Connect Covalent to Supabase

The implementation is ready. Connecting a real Supabase project still requires the SQL migration and server environment settings below. Until then, valid submissions return a retry message, never a false success.

The stack is **Covalent → existing Astro `/api/waitlist` endpoint on Vercel → Supabase Postgres**. A Next.js app is unnecessary; both existing forms already use this server endpoint.

## 1. Create the database

1. Create a project at [Supabase](https://supabase.com/dashboard). Choose a region near your Vercel function region.
2. In that project, open **SQL Editor → New query**.
3. Paste the entire contents of [`20261030000000_create_waitlist.sql`](../supabase/migrations/20261030000000_create_waitlist.sql) and click **Run** once.
4. Open **Table Editor → public → waitlist**. It should be empty and have these columns:

| Column | Meaning |
|---|---|
| `id` | Database-generated UUID |
| `email` | Trimmed, lowercased, unique email address |
| `created_at` | Signup time, stored with time zone |
| `source` | Campaign name from `utm_source`, or `direct` |
| `referral_code` | Optional incoming `ref` code; otherwise null |

The migration also creates a private rate-limit table and the server-only `join_waitlist` function. Leave `waitlist_private` out of the Data API's exposed schemas. Keep the default `public` schema exposed and the Data API enabled for this project's RPC endpoint. Do **not** add an anonymous insert policy to `waitlist`.

If you use the Supabase CLI instead, link the project and apply this migration with `supabase db push`. Use either SQL Editor or the CLI, not both for the same migration. If SQL Editor says `waitlist` already exists, do not delete an existing table or data; compare the existing schema first.

## 2. Get the project URL and server key

In the project's **Connect** dialog / project settings, copy the **Project URL**, e.g. `https://your-project.supabase.co`. In **Settings → API Keys**, create or copy a **secret key** beginning with `sb_secret_`.

Use a secret key, not the publishable/anon key and not your database password. This implementation expects the modern `sb_secret_` format. Supabase recommends these server keys for backend access. Keep it in Vercel's environment settings, never in a browser script, Git, or chat. [Supabase API key documentation](https://supabase.com/docs/guides/api/api-keys)

## 3. Connect Vercel

Open [Covalent's Vercel environment settings](https://vercel.com/daniyalmughal1s-projects/covalent-waitlist/settings/environment-variables).

Add these **Production** variables:

| Name | Value |
|---|---|
| `WAITLIST_PROVIDER` | `supabase` |
| `SUPABASE_URL` | Your Project URL, without a `/rest/v1` path |
| `SUPABASE_SECRET_KEY` | Your `sb_secret_…` key |

Mark the secret as sensitive if Vercel offers that option. Leave `WAITLIST_ALLOW_TEST_PROVIDER` and `WAITLIST_TEST_CONFIRMATION` unset. Do not prefix any variable with `PUBLIC_` or `NEXT_PUBLIC_`.

Then open **Deployments → latest production deployment → Redeploy**. Environment changes apply to a new deployment, not the already-running one.

Optional settings: `WAITLIST_RATE_LIMIT=20` and `WAITLIST_RATE_WINDOW_SECONDS=600` are already the defaults. On this standard Vercel deployment, leave `WAITLIST_TRUSTED_PROXY_HOPS` unset: the Astro Vercel adapter receives Vercel's sanitized client address. Vercel documents its overwrite behavior in [request headers](https://vercel.com/docs/headers/request-headers). Revisit the proxy setting if you later place another proxy in front of Vercel.

For preview deployments, use a separate Supabase development project if possible, with the same migration and Preview-scoped variables. Preview/test signups should not pollute your real launch list.

## 4. Confirm it works

1. Open [the live page](https://covalent-waitlist.vercel.app/?utm_source=linkedin).
2. Submit an email you control. The page should show its existing success state.
3. In Supabase Table Editor, confirm one row exists, with the lowercased email and `source = linkedin`.
4. Submit that address again (including different capitalization) from a fresh page load. The page should still show success, and the table must still contain only one row. The first signup's time, source and referral code stay unchanged.
5. Use the Table Editor's **Export / Export to CSV** action to download signups. You can also run the query below in SQL Editor and export its results:

```sql
select id, email, created_at, source, referral_code
from public.waitlist
order by created_at desc;
```

This is single opt-in: Supabase stores the signup, but **does not send a confirmation or welcome email**. The current promise is an email when early access opens; sending that launch announcement is a separate step.

## Campaign links

- X: `https://covalent-waitlist.vercel.app/?utm_source=x`
- LinkedIn: `https://covalent-waitlist.vercel.app/?utm_source=linkedin`
- Referral placeholder: `https://covalent-waitlist.vercel.app/?utm_source=x&ref=launch-01`

Only short letters/numbers/underscore/hyphen identifiers are accepted, up to 64 characters. Campaign names become lowercase. Bad attribution is ignored so it cannot prevent a valid signup. No cookie or local storage is needed. Attribution comes from the current page URL; a new visit without campaign parameters is `direct`. Native no-JavaScript form posts use a same-host referrer when the browser supplies one.

`referral_code` stores the incoming code only. It does not generate personal referral links, verify referrers, or award rewards yet. The API's internal `source` field (`hero`/`final`) is separate and continues driving the existing form and logo behavior.

## What protects the list

- All browser submissions pass through `/api/waitlist`; the browser receives no Supabase credentials.
- Row Level Security is enabled, with no public read or write policies. Anonymous and authenticated browser roles have no table privileges and cannot invoke the signup function. Only the server's service role can call it. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- A unique constraint plus `ON CONFLICT DO NOTHING` prevents duplicates even when requests arrive together. Emails are lowercased in both the endpoint and database. Plus tags and dots remain intact.
- An atomic database counter allows 20 valid signup attempts per client address per 10-minute window, shared across Vercel instances. The existing local limiter also covers invalid-email attempts. Limits are capped at 1,000 attempts / 86,400 seconds if overridden.
- Only an HMAC digest of the trusted client IP is persisted for throttling, not the raw address. Expired counters are removed on the next valid signup attempt; idle projects may retain expired hashes until then. Rotating the server key resets these buckets. Missing trusted addresses and database outages fail closed with a retry message.
- Database errors, credentials, email addresses and IPs are never included in application logs or public responses. Duplicate and new signups look identical publicly.

Rate limiting reduces casual abuse; it is not proof that a visitor is human. Cloudflare Turnstile is intentionally deferred until bot traffic warrants it. If added later, its token must be verified server-side before this database call.

## Troubleshooting

| Result | Check |
|---|---|
| Form says it could not add you; log says `unconfigured` | All three Production variables are present and you redeployed |
| `supabase: HTTP 401` / `403` | Secret key belongs to the project in `SUPABASE_URL`; use an `sb_secret_` key |
| `supabase: HTTP 404` | SQL migration ran in that project; Data API is enabled and exposes `public` |
| `supabase: HTTP 400` / `500` | Migration/function/table permissions match the committed SQL; inspect Supabase logs privately |
| `supabase: trusted client address unavailable` | Hosting adapter or proxy configuration is wrong; do not bypass the address check |
| HTTP 429 | Wait 10 minutes or retry from another network; shared office networks share a bucket |
| Success but no row in the expected project | Check the project URL and whether a test provider is accidentally enabled |

Never temporarily enable the fake provider on production to make errors disappear.

## Development verification

`npm test` covers the adapter, attribution, and endpoint responses; `npm run check`
checks the application types. After applying the migration to a **disposable**
PostgreSQL/Supabase database, run `supabase/tests/waitlist.sql` through `psql` with
`ON_ERROR_STOP=1` to check duplicate handling, rate windows, and browser-role denial.
The SQL test rolls back its changes; do not use a production database for tests.
